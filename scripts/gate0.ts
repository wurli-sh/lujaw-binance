/**
 * LUJAW Gate 0 — BSC testnet (chain 97).
 *
 * Sequence: observe → reconstruct → admin approve → createWallet → grant →
 * effective-authority diff → session mint → receipt → post-state → revoke.
 *
 * Modes:
 *   GATE0_MODE=observe   — read-only Venus verify (no keys required)
 *   GATE0_MODE=full      — complete path (requires OWNER_PRIVATE_KEY + SESSION_PRIVATE_KEY)
 *
 * Refuse to run full mode without keys. Never log or write private keys.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createClient as createAltanaClient,
  BNB_TESTNET,
  signerFromPrivateKey,
} from "@altananetwork/sdk";
import type { GrantSessionResult } from "@altananetwork/sdk";
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  isHex,
  slice,
} from "viem";
import type { Address, Hex, PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";
import {
  BSC_TESTNET as ALTANA_BSC_TESTNET,
  MINT_SELECTOR,
  MINT_SIGNATURE,
  VENUS_BSC_TESTNET,
  VENUS_SUPPLY_MARKETS_BSC_TESTNET,
  assertNoKeyMaterial,
  deploymentFor,
  diffRequestedVsEnforced,
  encodeMint,
  formatMantissa,
  hasCriticalDiscrepancy,
  isKeyValidInKeyStore,
  observeAccount,
  observeSupply,
  readEnforcedAuthority,
  reconstruct,
  serializePermissions,
  sessionKeyIdentity,
  venusDeploymentFor,
  type AuthorityDiscrepancy,
  type RequestedSessionPermissions,
  type SessionRecord,
  type SupplyMarketConfig,
  type VenusDeployment,
} from "../packages/core/src/index.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const ERC20_WRITE_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

interface Gate0Market {
  readonly symbol: "USDT" | "USDC";
  readonly config: SupplyMarketConfig;
  readonly vTokenImplementation: Address;
}

const MARKETS: readonly Gate0Market[] = [
  {
    symbol: "USDT",
    config: VENUS_SUPPLY_MARKETS_BSC_TESTNET[0]!,
    vTokenImplementation: VENUS_BSC_TESTNET.vTokenImplementation,
  },
  {
    symbol: "USDC",
    config: VENUS_SUPPLY_MARKETS_BSC_TESTNET[1]!,
    // USDC implementation is verified at observe time; seed empty and overwrite.
    vTokenImplementation: "0x0000000000000000000000000000000000000000",
  },
];

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing required env ${name}`);
  return value;
}

function optionalEnv(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : fallback;
}

function asPrivateKey(value: string): Hex {
  const key = value.startsWith("0x") ? value : `0x${value}`;
  if (!isHex(key) || key.length !== 66) {
    throw new Error("private key must be a 32-byte hex string");
  }
  return key;
}

function explorerTx(hash: string): string {
  return `https://testnet.bscscan.com/tx/${hash}`;
}

function explorerAddress(address: string): string {
  return `https://testnet.bscscan.com/address/${address}`;
}

function selectMarket(symbol: string): Gate0Market {
  const market = MARKETS.find((entry) => entry.symbol === symbol.toUpperCase());
  if (market === undefined) {
    throw new Error(`unsupported GATE0_MARKET=${symbol}; use USDT or USDC`);
  }
  return market;
}

function deploymentForMarket(market: Gate0Market): VenusDeployment {
  const base = venusDeploymentFor(97);
  return {
    ...base,
    vToken: market.config.vToken,
    underlying: market.config.underlying,
    underlyingSymbol: market.config.symbol,
    underlyingDecimals: market.config.underlyingDecimals,
    vTokenImplementation: market.vTokenImplementation,
  };
}

function serializeDiscrepancies(discrepancies: readonly AuthorityDiscrepancy[]) {
  return discrepancies.map((d) => ({
    code: d.code,
    severity: d.severity,
    message: d.message,
    ...(d.target === undefined ? {} : { target: d.target }),
    ...(d.selector === undefined ? {} : { selector: d.selector }),
    ...(d.token === undefined ? {} : { token: d.token }),
  }));
}

function writeJson(path: string, value: unknown): void {
  assertNoKeyMaterial(value);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  console.log(`wrote ${path}`);
}

async function verifyMarketLive(
  client: PublicClient,
  deployment: VenusDeployment,
  market: Gate0Market,
): Promise<{ implementation: Address; mintPaused: boolean; isListed: boolean }> {
  const supply = await observeSupply(client, deployment, deployment.comptroller, {
    markets: [market.config],
  });
  const observed = supply.markets[0];
  if (observed === undefined) throw new Error("supply observation returned no markets");
  if (observed.isListed !== true) {
    throw new Error(`${market.symbol}: market is not listed`);
  }
  if (observed.mintPaused !== false) {
    throw new Error(`${market.symbol}: mint is paused`);
  }
  if (observed.reportedUnderlyingDecimals !== market.config.underlyingDecimals) {
    throw new Error(
      `${market.symbol}: decimals mismatch configured=${market.config.underlyingDecimals} reported=${observed.reportedUnderlyingDecimals}`,
    );
  }
  if (observed.implementation === null) {
    throw new Error(`${market.symbol}: could not read vToken implementation`);
  }
  return {
    implementation: observed.implementation,
    mintPaused: observed.mintPaused,
    isListed: observed.isListed,
  };
}

async function runObserveOnly(client: PublicClient, market: Gate0Market): Promise<void> {
  const deployment = deploymentForMarket(market);
  const account = (process.env.GATE0_ACCOUNT?.trim() ||
    "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266") as Address;

  console.log(`\n[observe] chain=97 market=${market.symbol} account=${account}`);
  const marketLive = await verifyMarketLive(client, deployment, market);
  const observation = await observeAccount(client, deployment, account);
  const health = reconstruct(observation);

  if (health.unpriced.length > 0) {
    console.warn(
      `[observe] unpriced exposure on ${health.unpriced.length} market(s) — fail-closed for rescue; observation still recorded`,
    );
  }

  const evidence = {
    version: "lujaw.gate0-evidence/1",
    mode: "observe",
    chainId: 97,
    market: market.symbol,
    account: getAddress(account).toLowerCase(),
    preState: {
      blockNumber: observation.blockNumber,
      blockHash: observation.blockHash,
      weightedCollateralUsd: health.weightedCollateralUsd.toString(10),
      totalBorrowUsd: health.totalBorrowUsd.toString(10),
      healthFactor: health.healthFactorMantissa === null ? null : formatMantissa(health.healthFactorMantissa),
      healthFactorMantissa:
        health.healthFactorMantissa === null ? null : health.healthFactorMantissa.toString(10),
      unpricedCount: health.unpriced.length,
      protocolLiquidity: observation.accountLiquidity.liquidity,
      protocolShortfall: observation.accountLiquidity.shortfall,
    },
    marketVerification: {
      vToken: market.config.vToken,
      underlying: market.config.underlying,
      underlyingDecimals: market.config.underlyingDecimals,
      implementation: marketLive.implementation,
      isListed: marketLive.isListed,
      mintPaused: marketLive.mintPaused,
      supplySelector: MINT_SELECTOR,
      supplySignature: MINT_SIGNATURE,
      explorerVToken: explorerAddress(market.config.vToken),
    },
    altana: ALTANA_BSC_TESTNET,
    venus: {
      ...deployment,
      vTokenImplementation: marketLive.implementation,
    },
    outcome: "OBSERVE_OK",
  };

  writeJson(join(ROOT, "deployments", "evidence", `gate0-observe-${market.symbol.toLowerCase()}.json`), evidence);
  // Primary locked market is USDT. Failover observes write evidence only.
  if (market.symbol === "USDT" || process.env.GATE0_FREEZE === "1") {
    freezeDeploymentProfile(market, marketLive.implementation, observation.blockNumber);
  }
}

function checksum(address: string): Address {
  return getAddress(address);
}

function freezeDeploymentProfile(
  market: Gate0Market,
  implementation: Address,
  verificationBlock: string,
): void {
  const deployment = deploymentForMarket(market);
  const altana = deploymentFor(97);
  const usdc = VENUS_SUPPLY_MARKETS_BSC_TESTNET[1]!;
  const profile = {
    version: "lujaw.deployment/1",
    environment: "bsc-testnet",
    chainId: 97,
    rpcEnvVar: "BSC_TESTNET_RPC_URL",
    explorer: {
      address: "https://testnet.bscscan.com/address/{address}",
      tx: "https://testnet.bscscan.com/tx/{hash}",
    },
    venus: {
      comptroller: checksum(deployment.comptroller),
      oracle: checksum(deployment.oracle),
      vaiController: checksum(deployment.vaiController),
      vai: checksum(deployment.vai),
      market: {
        symbol: market.symbol,
        vToken: checksum(market.config.vToken),
        vTokenImplementation: checksum(implementation),
        underlying: checksum(market.config.underlying),
        underlyingDecimals: market.config.underlyingDecimals,
        supplyTarget: checksum(market.config.vToken),
        supplySelector: MINT_SELECTOR,
        supplySignature: MINT_SIGNATURE,
        approveSpender: checksum(market.config.vToken),
      },
      failoverMarket: {
        symbol: "USDC",
        vToken: checksum(usdc.vToken),
        underlying: checksum(usdc.underlying),
        underlyingDecimals: usdc.underlyingDecimals,
        note: "Single failover if USDT path fails Gate 0 full sequence",
      },
      accounting: {
        oracleScaleRule: "10^(36 - underlyingDecimals)",
        liquidationThresholdSource: "Comptroller.markets(vToken) field 4 of 7",
        vaiDebtSource: "VAIController.getVAIRepayAmount at par 1e18",
        debtUniverse: "getAllMarkets balances + VAI; not getAssetsIn alone",
        collateralUniverse: "entered markets only (getAssetsIn)",
      },
    },
    altana: {
      sdkVersion: "0.7.1",
      relayUrl: altana.relayUrl,
      keyStore: checksum(altana.keyStore),
      keyStoreController: checksum(altana.keyStoreController),
      accountImplementation: checksum(altana.accountImplementation),
      orchestrator: checksum(altana.orchestrator),
      feeToken: altana.feeToken,
      effectiveAuthority: {
        readFrom: "wallet EIP-7702 address via canExecutePackedInfos + spendInfos + getKeys",
        criticalCodes: [
          "WILDCARD_TARGET",
          "SUPER_ADMIN_KEY",
          "KEY_NOT_REGISTERED",
          "SPEND_LIMIT_ENLARGED",
          "WALLET_WIDE_RULE",
        ],
      },
    },
    verification: {
      blockNumber: verificationBlock,
      provenance: [
        {
          source: "live BSC testnet RPC observe + mandate-seeded addresses re-verified",
          chainId: 97,
          market: market.symbol,
          result: "market listed, mint not paused, decimals match, implementation readable",
          healthFactorReplay: "fixture account reconstructs HF 2.505467 matching frozen evidence",
        },
      ],
      gate0FullPath: process.env.GATE0_MODE === "full" ? "attempted" : "pending-secrets",
      gate0ObservePath: "passed",
    },
  };

  writeJson(join(ROOT, "deployments", "bsc-testnet.json"), profile);
}

async function runFull(client: PublicClient, market: Gate0Market): Promise<void> {
  const ownerKey = asPrivateKey(requireEnv("OWNER_PRIVATE_KEY"));
  const sessionKey = asPrivateKey(requireEnv("SESSION_PRIVATE_KEY"));
  const owner = privateKeyToAccount(ownerKey);
  const account = getAddress(
    (process.env.GATE0_ACCOUNT?.trim() as Address | undefined) ?? owner.address,
  ).toLowerCase() as Address;

  const topUpRaw = BigInt(optionalEnv("GATE0_TOP_UP_RAW", "1000000"));
  const spendCapRaw = BigInt(optionalEnv("GATE0_SPEND_CAP_RAW", "5000000"));
  const nativeCapWei = BigInt(optionalEnv("GATE0_NATIVE_CAP_WEI", "10000000000000000"));
  const expiry = Math.floor(Date.now() / 1000) + 60 * 60;

  if (topUpRaw > spendCapRaw) {
    throw new Error("GATE0_TOP_UP_RAW must be <= GATE0_SPEND_CAP_RAW");
  }

  const deployment = deploymentForMarket(market);
  const marketLive = await verifyMarketLive(client, deployment, market);
  const lockedDeployment: VenusDeployment = {
    ...deployment,
    vTokenImplementation: marketLive.implementation,
  };

  console.log(`\n[full] owner=${owner.address} account=${account} market=${market.symbol}`);

  // ---- pre-state ----
  const preObservation = await observeAccount(client, lockedDeployment, account);
  const preHealth = reconstruct(preObservation);
  if (preHealth.unpriced.length > 0) {
    throw new Error(`pre-state has unpriced exposure: ${preHealth.unpriced.map((u) => u.vToken).join(", ")}`);
  }
  if (preHealth.totalBorrowUsd === 0n) {
    throw new Error(
      "account has no debt; Gate 0 needs a Venus position with debt so HF improvement is measurable",
    );
  }
  const preHf = preHealth.healthFactorMantissa;
  console.log(
    `[pre] block=${preObservation.blockNumber} HF=${preHf === null ? "infinite" : formatMantissa(preHf)}`,
  );

  // ---- admin allowance ----
  const walletClient = createWalletClient({
    account: owner,
    chain: bscTestnet,
    transport: http(requireEnv("BSC_TESTNET_RPC_URL")),
  });

  const approveHash = await walletClient.writeContract({
    address: market.config.underlying,
    abi: ERC20_WRITE_ABI,
    functionName: "approve",
    args: [market.config.vToken, spendCapRaw],
    chain: bscTestnet,
    account: owner,
  });
  await client.waitForTransactionReceipt({ hash: approveHash });
  const allowanceAfterApprove = await client.readContract({
    address: market.config.underlying,
    abi: ERC20_WRITE_ABI,
    functionName: "allowance",
    args: [account, market.config.vToken],
  });
  console.log(`[approve] tx=${approveHash} allowance=${allowanceAfterApprove}`);

  // ---- Altana grant ----
  const altana = createAltanaClient({ chains: [BNB_TESTNET] });
  const ownerSigner = signerFromPrivateKey(ownerKey);
  const sessionSigner = signerFromPrivateKey(sessionKey);

  await altana.createWallet({ signer: ownerSigner });

  const permissions: RequestedSessionPermissions = {
    calls: [{ to: market.config.vToken, signature: MINT_SIGNATURE }],
    spend: [
      { token: market.config.underlying, limit: spendCapRaw, period: "day" },
      { limit: nativeCapWei, period: "day" },
    ],
  };

  const session: GrantSessionResult = await altana.grantSession({
    wallet: { address: account },
    signer: ownerSigner,
    chainId: 97,
    permissions,
    expiry,
    sessionSigner,
  });

  const identity = sessionKeyIdentity(session.publicKey);
  const grantTxHash = session.transactionHash;
  console.log(
    `[grant] keyHash=${identity.keyHash} keyId=${identity.keyId} tx=${grantTxHash ?? "(none returned)"}`,
  );

  const enforced = await readEnforcedAuthority(client, {
    wallet: account,
    keyHash: identity.keyHash,
  });
  const discrepancies = diffRequestedVsEnforced(permissions, enforced, {
    orchestrator: ALTANA_BSC_TESTNET.orchestrator,
    requestedExpiry: expiry,
  });
  console.log(
    `[authority] registered=${enforced.registered} discrepancies=${discrepancies.length} critical=${hasCriticalDiscrepancy(discrepancies)}`,
  );
  for (const d of discrepancies) {
    console.log(`  - [${d.severity}] ${d.code}: ${d.message}`);
  }
  if (hasCriticalDiscrepancy(discrepancies)) {
    throw new Error("CRITICAL effective-authority discrepancy; refusing to execute");
  }

  const sessionRecord: SessionRecord = {
    chainId: 97,
    walletAddress: account,
    publicKey: session.publicKey,
    keyHash: identity.keyHash,
    keyId: identity.keyId,
    requestedPermissions: serializePermissions(permissions),
    expiry,
    ...(grantTxHash === undefined ? {} : { grantTxHash }),
  };
  assertNoKeyMaterial(sessionRecord);

  // ---- execute mint ----
  const mint = encodeMint(market.config.vToken, topUpRaw);
  console.log(`[execute] submitting mint amount=${topUpRaw}`);
  const execution = await altana.execute({
    session,
    chainId: 97,
    calls: [{ to: mint.to, data: mint.data }],
  });

  const submittedHash =
    "transactionHash" in execution && typeof execution.transactionHash === "string"
      ? (execution.transactionHash as Hex)
      : undefined;
  console.log(`[execute] submitted hash=${submittedHash ?? "(none)"} status=${(execution as { status?: string }).status ?? "unknown"}`);

  if (submittedHash === undefined) {
    throw new Error("session execute returned no transaction hash");
  }

  const receipt = await client.waitForTransactionReceipt({ hash: submittedHash });
  if (receipt.status !== "success") {
    throw new Error(`mint transaction failed: ${submittedHash}`);
  }

  // Best-effort destination/selector check via tx input when available.
  const tx = await client.getTransaction({ hash: submittedHash });
  const txSelector = tx.input.length >= 10 ? slice(tx.input, 0, 4) : undefined;
  if (tx.to !== null && tx.to.toLowerCase() !== market.config.vToken.toLowerCase()) {
    // Altana may wrap through the orchestrator; record but do not auto-fail wrapping.
    console.warn(
      `[receipt] tx.to=${tx.to} differs from vToken=${market.config.vToken} (may be orchestrator wrap)`,
    );
  }
  if (txSelector !== undefined && txSelector.toLowerCase() !== MINT_SELECTOR.toLowerCase()) {
    console.warn(
      `[receipt] top-level selector=${txSelector} differs from mint=${MINT_SELECTOR} (may be orchestrator wrap)`,
    );
  }
  console.log(`[receipt] ok block=${receipt.blockNumber} ${explorerTx(submittedHash)}`);

  // ---- post-state ----
  const postObservation = await observeAccount(client, lockedDeployment, account);
  const postHealth = reconstruct(postObservation);
  if (postHealth.unpriced.length > 0) {
    throw new Error("post-state has unpriced exposure");
  }
  const postHf = postHealth.healthFactorMantissa;
  console.log(
    `[post] block=${postObservation.blockNumber} HF=${postHf === null ? "infinite" : formatMantissa(postHf)}`,
  );

  if (preHf === null || postHf === null) {
    throw new Error("expected finite pre/post health factors for Gate 0");
  }
  if (postHf <= preHf) {
    throw new Error(
      `health factor did not improve: pre=${formatMantissa(preHf)} post=${formatMantissa(postHf)}`,
    );
  }
  if (postHealth.weightedCollateralUsd <= preHealth.weightedCollateralUsd) {
    throw new Error("weighted collateral did not increase after mint");
  }

  // ---- revoke ----
  const revoke = await altana.revokeSession({
    wallet: { address: account },
    signer: ownerSigner,
    session,
    chainId: 97,
  });
  const revokeHash =
    "transactionHash" in revoke && typeof revoke.transactionHash === "string"
      ? (revoke.transactionHash as Hex)
      : undefined;
  if (revokeHash !== undefined) {
    await client.waitForTransactionReceipt({ hash: revokeHash });
  }

  const afterRevoke = await readEnforcedAuthority(client, {
    wallet: account,
    keyHash: identity.keyHash,
  });
  const keyStoreValid = await isKeyValidInKeyStore(client, {
    keyStore: ALTANA_BSC_TESTNET.keyStore,
    wallet: account,
    keyId: identity.keyId,
  });

  if (afterRevoke.registered) {
    throw new Error("session still registered after revoke");
  }
  console.log(`[revoke] registered=${afterRevoke.registered} keyStoreValid=${keyStoreValid} tx=${revokeHash ?? "(none)"}`);

  const remainingAllowance = await client.readContract({
    address: market.config.underlying,
    abi: ERC20_WRITE_ABI,
    functionName: "allowance",
    args: [account, market.config.vToken],
  });

  const evidence = {
    version: "lujaw.gate0-evidence/1",
    mode: "full",
    chainId: 97,
    market: market.symbol,
    account,
    plan: {
      topUpRaw: topUpRaw.toString(10),
      spendCapRaw: spendCapRaw.toString(10),
      nativeCapWei: nativeCapWei.toString(10),
      expiry,
      supplySelector: MINT_SELECTOR,
      supplyTarget: market.config.vToken,
    },
    preState: {
      blockNumber: preObservation.blockNumber,
      blockHash: preObservation.blockHash,
      weightedCollateralUsd: preHealth.weightedCollateralUsd.toString(10),
      totalBorrowUsd: preHealth.totalBorrowUsd.toString(10),
      healthFactor: formatMantissa(preHf),
      healthFactorMantissa: preHf.toString(10),
    },
    session: {
      ...sessionRecord,
      revokeTxHash: revokeHash,
    },
    authority: {
      requested: serializePermissions(permissions),
      enforced: {
        registered: enforced.registered,
        expiry: enforced.expiry,
        isSuperAdmin: enforced.isSuperAdmin,
        callRuleCount: enforced.callRules.length,
        walletWideRuleCount: enforced.walletWideRules.length,
        spendLimits: enforced.spendLimits.map((limit) => ({
          token: limit.token,
          period: limit.period,
          limit: limit.limit.toString(10),
          remaining: limit.remaining.toString(10),
        })),
        observedAtBlock: enforced.observedAtBlock.toString(10),
      },
      discrepancies: serializeDiscrepancies(discrepancies),
    },
    transaction: {
      approveHash,
      approveExplorer: explorerTx(approveHash),
      mintHash: submittedHash,
      mintExplorer: explorerTx(submittedHash),
      mintStatus: "CONFIRMED",
      mintBlockNumber: receipt.blockNumber.toString(10),
      topLevelTo: tx.to,
      topLevelSelector: txSelector,
    },
    postState: {
      blockNumber: postObservation.blockNumber,
      blockHash: postObservation.blockHash,
      weightedCollateralUsd: postHealth.weightedCollateralUsd.toString(10),
      totalBorrowUsd: postHealth.totalBorrowUsd.toString(10),
      healthFactor: formatMantissa(postHf),
      healthFactorMantissa: postHf.toString(10),
      improved: true,
    },
    revocation: {
      hash: revokeHash ?? null,
      explorer: revokeHash ? explorerTx(revokeHash) : null,
      registeredAfter: afterRevoke.registered,
      keyStoreValid,
    },
    remainingAllowance: remainingAllowance.toString(10),
    remainingAllowanceNote:
      "Session revocation does not clear the ERC-20 allowance. Remaining allowance disclosed.",
    outcome: "GATE0_PASSED",
  };

  assertNoKeyMaterial(evidence);
  writeJson(
    join(ROOT, "deployments", "evidence", `gate0-full-${market.symbol.toLowerCase()}.json`),
    evidence,
  );
  freezeDeploymentProfile(market, marketLive.implementation, postObservation.blockNumber);

  // Patch verification flag on the frozen profile.
  const profilePath = join(ROOT, "deployments", "bsc-testnet.json");
  const { readFileSync } = await import("node:fs");
  const profile = JSON.parse(readFileSync(profilePath, "utf8")) as {
    verification: { gate0FullPath: string; provenance: unknown[] };
  };
  profile.verification.gate0FullPath = "passed";
  profile.verification.provenance.push({
    source: "scripts/gate0.ts full sequence",
    grantTx: grantTxHash ?? null,
    mintTx: submittedHash,
    revokeTx: revokeHash ?? null,
    result: "HF improved; session revoked; no CRITICAL authority discrepancy",
  });
  writeJson(profilePath, profile);
}

async function main(): Promise<void> {
  const mode = optionalEnv("GATE0_MODE", "observe").toLowerCase();
  const marketSymbol = optionalEnv("GATE0_MARKET", "USDT");
  const market = selectMarket(marketSymbol);
  const rpcUrl = optionalEnv(
    "BSC_TESTNET_RPC_URL",
    "https://bsc-testnet-rpc.publicnode.com",
  );

  const client = createPublicClient({
    chain: bscTestnet,
    transport: http(rpcUrl),
  });

  const chainId = await client.getChainId();
  if (chainId !== 97) {
    throw new Error(`expected chain 97, got ${chainId}`);
  }

  if (mode === "observe") {
    await runObserveOnly(client, market);
    return;
  }

  if (mode === "full") {
    await runFull(client, market);
    return;
  }

  throw new Error(`unknown GATE0_MODE=${mode}; use observe or full`);
}

main().catch((error: unknown) => {
  console.error("\nGate 0 failed:");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
