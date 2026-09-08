/**
 * Altana lifecycle adapter for LUJAW. Wraps SDK grant/execute/revoke and
 * keeps secret-bearing session handles out of persistence.
 */
import {
  createClient as createAltanaClient,
  BNB_TESTNET,
  signerFromPrivateKey,
} from "@altananetwork/sdk";
import type { GrantSessionResult } from "@altananetwork/sdk";
import {
  createWalletClient,
  http,
  slice,
  toFunctionSelector,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { bscTestnet } from "viem/chains";
import {
  diffRequestedVsEnforced,
  hasCriticalDiscrepancy,
  type RequestedSessionPermissions,
} from "./effective-authority.js";
import { readEnforcedAuthority, isKeyValidInKeyStore } from "./account-reads.js";
import {
  assertNoKeyMaterial,
  deserializePermissions,
  serializePermissions,
  type SessionRecord,
} from "./session-record.js";
import { sessionKeyIdentity } from "./key-identity.js";
import { BSC_TESTNET as ALTANA_DEPLOYMENT } from "./constants.js";
import { DEFAULT_NATIVE_FEE_CAP_WEI } from "../constants.js";
import type { DeploymentProfile } from "../deployment.js";
import { MINT_SELECTOR, MINT_SIGNATURE as MINT_SIG } from "../venus/abis.js";
import { verifyMintReceiptEffects } from "../venus/mint.js";

export interface AltanaAdapterConfig {
  rpcUrl: string;
  /** Required only for owner-authorized activate/revoke operations. */
  ownerPrivateKey?: Hex;
  publicClient: PublicClient;
  deployment: DeploymentProfile;
}

export interface GrantInput {
  wallet: Address;
  collateralToken: Address;
  vToken: Address;
  tokenSpendCapRaw: bigint;
  nativeCapWei?: bigint;
  expiry: number;
  /** Optional; if omitted a fresh ephemeral session key is generated. */
  sessionPrivateKey?: Hex;
}

export interface GrantResult {
  session: GrantSessionResult;
  record: SessionRecord;
  discrepancies: ReturnType<typeof diffRequestedVsEnforced>;
  critical: boolean;
}

const ERC20_ABI = [
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
] as const;

export function createAltanaAdapter(config: AltanaAdapterConfig) {
  const altana = createAltanaClient({ chains: [BNB_TESTNET] });
  const ownerAccount = config.ownerPrivateKey
    ? privateKeyToAccount(config.ownerPrivateKey)
    : null;
  const ownerSigner = config.ownerPrivateKey
    ? signerFromPrivateKey(config.ownerPrivateKey)
    : null;
  const walletClient = ownerAccount
    ? createWalletClient({
        account: ownerAccount,
        chain: bscTestnet,
        transport: http(config.rpcUrl),
      })
    : null;

  function requireOwner() {
    if (ownerAccount === null || ownerSigner === null || walletClient === null) {
      throw new Error("OWNER_PRIVATE_KEY is required for this owner-authorized operation");
    }
    return { ownerAccount, ownerSigner, walletClient };
  }

  async function ensureWallet(): Promise<void> {
    const { ownerSigner } = requireOwner();
    await altana.createWallet({ signer: ownerSigner });
  }

  async function adminApprove(spender: Address, amount: bigint): Promise<Hex> {
    const { ownerAccount, walletClient } = requireOwner();
    const underlying = config.deployment.venus.market.underlying;
    const hash = await walletClient.writeContract({
      address: underlying,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [spender, amount],
      chain: bscTestnet,
      account: ownerAccount,
    });
    const receipt = await config.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`ERC-20 approval reverted: ${hash}`);
    const allowance = await readAllowance(ownerAccount.address, spender);
    if (allowance < amount) {
      throw new Error(`ERC-20 allowance ${allowance} is below requested bound ${amount}`);
    }
    return hash;
  }

  async function readAllowance(owner: Address, spender: Address): Promise<bigint> {
    return config.publicClient.readContract({
      address: config.deployment.venus.market.underlying,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [owner, spender],
    });
  }

  async function grantSession(input: GrantInput): Promise<GrantResult> {
    const { ownerSigner } = requireOwner();
    await ensureWallet();
    const sessionPrivateKey = input.sessionPrivateKey ?? generatePrivateKey();
    const sessionSigner = signerFromPrivateKey(sessionPrivateKey);

    const permissions: RequestedSessionPermissions = {
      calls: [{ to: input.vToken, signature: MINT_SIG }],
      spend: [
        { token: input.collateralToken, limit: input.tokenSpendCapRaw, period: "day" },
        { limit: input.nativeCapWei ?? DEFAULT_NATIVE_FEE_CAP_WEI, period: "day" },
      ],
    };

    const session = await altana.grantSession({
      wallet: { address: input.wallet },
      signer: ownerSigner,
      chainId: 97,
      permissions,
      expiry: input.expiry,
      sessionSigner,
    });

    const identity = sessionKeyIdentity(session.publicKey);
    const enforced = await readEnforcedAuthority(config.publicClient, {
      wallet: input.wallet,
      keyHash: identity.keyHash,
    });
    const discrepancies = diffRequestedVsEnforced(permissions, enforced, {
      orchestrator: ALTANA_DEPLOYMENT.orchestrator,
      requestedExpiry: input.expiry,
    });

    const record: SessionRecord = {
      chainId: 97,
      walletAddress: input.wallet,
      publicKey: session.publicKey,
      keyHash: identity.keyHash,
      keyId: identity.keyId,
      requestedPermissions: serializePermissions(permissions),
      expiry: input.expiry,
      ...(session.transactionHash ? { grantTxHash: session.transactionHash } : {}),
    };
    assertNoKeyMaterial(record);

    return {
      session,
      record,
      discrepancies,
      critical: hasCriticalDiscrepancy(discrepancies),
    };
  }

  /** Rebuild a live SDK session from public state plus an externally-held key. */
  function restoreSession(record: SessionRecord, sessionPrivateKey: Hex): GrantSessionResult {
    const signer = signerFromPrivateKey(sessionPrivateKey);
    if (signer.publicKey.toLowerCase() !== record.publicKey.toLowerCase()) {
      throw new Error("SESSION_PRIVATE_KEY does not match the active session public key");
    }
    return {
      walletAddress: record.walletAddress,
      signer,
      publicKey: record.publicKey,
      permissions: deserializePermissions(record.requestedPermissions),
      expiry: record.expiry,
      ...(record.grantTxHash ? { transactionHash: record.grantTxHash } : {}),
    };
  }

  async function executeMint(
    session: GrantSessionResult,
    vToken: Address,
    data: Hex,
  ): Promise<{
    hash: Hex;
    status: "SUBMITTED" | "CONFIRMED" | "FAILED";
    blockNumber: bigint | null;
  }> {
    const execution = await altana.execute({
      session,
      chainId: 97,
      calls: [{ to: vToken, data }],
    });
    const hash =
      "transactionHash" in execution && typeof execution.transactionHash === "string"
        ? (execution.transactionHash as Hex)
        : undefined;
    if (hash === undefined) {
      throw new Error("session execute returned no transaction hash");
    }
    let receipt;
    try {
      receipt = await config.publicClient.waitForTransactionReceipt({ hash });
    } catch {
      return { hash, status: "SUBMITTED", blockNumber: null };
    }
    return {
      hash,
      status: receipt.status === "success" ? "CONFIRMED" : "FAILED",
      blockNumber: receipt.blockNumber,
    };
  }

  async function revokeSession(
    wallet: Address,
    sessionOrPublicKey: GrantSessionResult | Hex,
  ): Promise<{ hash: Hex | null; registeredAfter: boolean; keyStoreValid: boolean }> {
    const { ownerSigner } = requireOwner();
    const revoke = await altana.revokeSession({
      wallet: { address: wallet },
      signer: ownerSigner,
      session: sessionOrPublicKey,
      chainId: 97,
    });
    const hash =
      "transactionHash" in revoke && typeof revoke.transactionHash === "string"
        ? (revoke.transactionHash as Hex)
        : null;
    if (hash) {
      const receipt = await config.publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`session revocation reverted: ${hash}`);
    }
    const publicKey = typeof sessionOrPublicKey === "string"
      ? sessionOrPublicKey
      : sessionOrPublicKey.publicKey;
    const identity = sessionKeyIdentity(publicKey);
    const after = await readEnforcedAuthority(config.publicClient, {
      wallet,
      keyHash: identity.keyHash,
    });
    const keyStoreValid = await isKeyValidInKeyStore(config.publicClient, {
      keyStore: ALTANA_DEPLOYMENT.keyStore,
      wallet,
      keyId: identity.keyId,
    });
    return { hash, registeredAfter: after.registered, keyStoreValid };
  }

  /**
   * Attribute both the transaction envelope and the exact Venus/underlying effects.
   */
  async function verifyReceiptAttribution(
    txHash: Hex,
    expected: {
      vToken: Address;
      underlying: Address;
      wallet: Address;
      amountRaw: bigint;
    },
  ): Promise<{
    ok: boolean;
    topLevelTo: Address | null;
    wrappedByOrchestrator: boolean;
    message: string;
  }> {
    const tx = await config.publicClient.getTransaction({ hash: txHash });
    const receipt = await config.publicClient.getTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") throw new Error("mint receipt reverted");
    const orchestrator = ALTANA_DEPLOYMENT.orchestrator.toLowerCase();
    const to = tx.to;
    const wrapped = to !== null && to.toLowerCase() === orchestrator;
    const direct = to !== null && to.toLowerCase() === expected.vToken.toLowerCase();
    const selector = tx.input.length >= 10 ? slice(tx.input, 0, 4).toLowerCase() : null;
    if (!wrapped && !direct) {
      throw new Error(`unexpected mint transaction destination ${to}`);
    }
    const expectedSelector = wrapped ? toFunctionSelector("execute(bytes)") : MINT_SELECTOR;
    if (selector !== expectedSelector.toLowerCase()) {
      throw new Error(`unexpected mint transaction selector ${selector}`);
    }
    verifyMintReceiptEffects(receipt.logs, {
      vToken: expected.vToken,
      underlying: expected.underlying,
      minter: expected.wallet,
      amountRaw: expected.amountRaw,
    });
    return {
      ok: true,
      topLevelTo: to,
      wrappedByOrchestrator: wrapped,
      message: wrapped
        ? "transaction and mint effects attributed through Altana orchestrator"
        : "transaction and mint effects attributed directly to vToken",
    };
  }

  return {
    ownerAddress: ownerAccount?.address ?? null,
    ensureWallet,
    adminApprove,
    readAllowance,
    grantSession,
    restoreSession,
    executeMint,
    revokeSession,
    verifyReceiptAttribution,
  };
}

export type AltanaAdapter = ReturnType<typeof createAltanaAdapter>;
