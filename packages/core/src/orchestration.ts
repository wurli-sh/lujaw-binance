/**
 * Shared command orchestration for check / activate / rescue / revoke.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Address, Hex, PublicClient } from "viem";
import { getAddress, isAddress, isHex } from "viem";
import { z } from "zod";
import { assertNoKeyMaterial } from "./altana/session-record.js";
import type { SessionRecord } from "./altana/session-record.js";
import { deserializePermissions } from "./altana/session-record.js";
import { readEnforcedAuthority } from "./altana/account-reads.js";
import { diffRequestedVsEnforced } from "./altana/effective-authority.js";
import { BSC_TESTNET as ALTANA_DEPLOYMENT } from "./altana/constants.js";
import type { AltanaAdapter } from "./altana/adapter.js";
import type { GrantSessionResult } from "@altananetwork/sdk";
import {
  explorerTxUrl,
  venusDeploymentFromProfile,
  type DeploymentProfile,
} from "./deployment.js";
import { draftCarePlan, type DraftCarePlanInput } from "./draft/agentrouter.js";
import {
  buildEpisode,
  canonicalPlanHash,
  hfToDecimalString,
  type Episode,
} from "./episode/build.js";
import { assessObservationFreshness } from "./freshness.js";
import { reconstruct } from "./health/accounting.js";
import { assessProductStatus } from "./health/status.js";
import { parseThresholdToMantissa } from "./health/thresholds.js";
import { evaluateRescue, type SessionPolicyState } from "./policy.js";
import { carePlanSchema, type CarePlan } from "./schemas/plan.js";
import { calculateTopUp } from "./topup.js";
import { encodeMint } from "./venus/mint.js";
import { observeAccount } from "./venus/reads.js";
import { DEFAULT_NATIVE_FEE_CAP_WEI, TOP_UP_BUFFER_BPS } from "./constants.js";
import { MINT_SIGNATURE } from "./venus/abis.js";

export interface ActiveState {
  plan: CarePlan;
  planHash: Hex;
  sessionRecord: SessionRecord;
  /** Secret-bearing SDK session kept only in memory — never written by writeActiveState. */
  session?: GrantSessionResult;
  actionsConsumed: number;
  approveTxHash?: Hex;
}

const addressSchema = z.string().refine(isAddress, "invalid address");
const hex32Schema = z.string().refine((value) => isHex(value) && value.length === 66, "invalid bytes32");
const sessionRecordSchema = z.object({
  chainId: z.literal(97),
  walletAddress: addressSchema,
  publicKey: z.string().refine(isHex, "invalid public key"),
  keyHash: hex32Schema,
  keyId: hex32Schema,
  requestedPermissions: z.object({
    calls: z.array(z.object({ to: addressSchema.optional(), signature: z.string().optional() }).strict()),
    spend: z.array(z.object({
      limit: z.string().regex(/^\d+$/),
      period: z.enum(["minute", "hour", "day", "week", "month", "year"]),
      token: addressSchema.optional(),
    }).strict()),
  }).strict(),
  expiry: z.number().int().positive(),
  grantTxHash: hex32Schema.optional(),
  revokeTxHash: hex32Schema.optional(),
  revokedAt: z.number().int().nonnegative().optional(),
}).strict();

const storedActiveStateSchema = z.object({
  plan: carePlanSchema,
  planHash: hex32Schema,
  sessionRecord: sessionRecordSchema,
  actionsConsumed: z.number().int().min(0).max(1),
  approveTxHash: hex32Schema.optional(),
}).strict();

function assertPlanMatchesDeployment(plan: CarePlan, deployment: DeploymentProfile): void {
  const market = deployment.venus.market;
  const mismatched =
    plan.chainId !== deployment.chainId ||
    plan.market.toLowerCase() !== market.vToken.toLowerCase() ||
    plan.collateralToken.toLowerCase() !== market.underlying.toLowerCase() ||
    plan.supplyTarget.toLowerCase() !== market.supplyTarget.toLowerCase() ||
    plan.supplySelector.toLowerCase() !== market.supplySelector.toLowerCase();
  if (mismatched) throw new Error("active Care Plan does not match the locked deployment profile");
}

function assertStateConsistency(state: {
  plan: CarePlan;
  planHash: string;
  sessionRecord: SessionRecord;
  actionsConsumed: number;
}): void {
  if (canonicalPlanHash(state.plan) !== state.planHash) {
    throw new Error("active state planHash does not match its canonical Care Plan");
  }
  const record = state.sessionRecord;
  if (record.expiry !== state.plan.sessionExpiresAt) {
    throw new Error("session expiry does not match the active Care Plan");
  }
  const calls = record.requestedPermissions.calls;
  if (calls.length !== 1 ||
      calls[0]?.to?.toLowerCase() !== state.plan.supplyTarget.toLowerCase() ||
      calls[0]?.signature !== MINT_SIGNATURE) {
    throw new Error("session call permission does not match the active Care Plan");
  }
  const token = record.requestedPermissions.spend.find((entry) => entry.token !== undefined);
  const native = record.requestedPermissions.spend.find((entry) => entry.token === undefined);
  if (record.requestedPermissions.spend.length !== 2 ||
      token?.token?.toLowerCase() !== state.plan.collateralToken.toLowerCase() ||
      token.limit !== state.plan.maxTopUpRaw || token.period !== "day" ||
      native?.limit !== DEFAULT_NATIVE_FEE_CAP_WEI.toString(10) || native.period !== "day") {
    throw new Error("session spend permissions do not match the active Care Plan");
  }
}

export function writeActiveState(path: string, state: Omit<ActiveState, "session"> & {
  sessionRecord: SessionRecord;
}): void {
  const payload = {
    plan: state.plan,
    planHash: state.planHash,
    sessionRecord: state.sessionRecord,
    actionsConsumed: state.actionsConsumed,
    ...(state.approveTxHash ? { approveTxHash: state.approveTxHash } : {}),
  };
  const parsed = storedActiveStateSchema.parse(payload);
  assertStateConsistency(parsed as typeof parsed & { sessionRecord: SessionRecord });
  assertNoKeyMaterial(payload);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

export function loadActiveState(
  path: string,
  deployment?: DeploymentProfile,
  expectedAccount?: Address,
): Omit<ActiveState, "session"> {
  if (!existsSync(path)) {
    throw new Error(`no active state at ${path}; run activate first`);
  }
  const raw = storedActiveStateSchema.parse(JSON.parse(readFileSync(path, "utf8")) as unknown);
  assertNoKeyMaterial(raw);
  assertStateConsistency(raw as typeof raw & { sessionRecord: SessionRecord });
  if (deployment) assertPlanMatchesDeployment(raw.plan, deployment);
  if (expectedAccount && raw.sessionRecord.walletAddress.toLowerCase() !== expectedAccount.toLowerCase()) {
    throw new Error("active session wallet does not match the selected account");
  }
  return raw as Omit<ActiveState, "session">;
}

function pendingPlanPath(statePath: string): string {
  return `${statePath}.draft`;
}

function writePendingPlan(statePath: string, plan: CarePlan): Hex {
  const hash = canonicalPlanHash(plan);
  const path = pendingPlanPath(statePath);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ plan, planHash: hash }, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
  return hash;
}

function loadAcceptedPlan(
  statePath: string,
  acceptedHash: Hex,
  deployment: DeploymentProfile,
  nowSeconds: number,
): CarePlan {
  const path = pendingPlanPath(statePath);
  if (!existsSync(path)) throw new Error("no pending Care Plan; preview activate before accepting");
  const parsed = z.object({ plan: carePlanSchema, planHash: hex32Schema }).strict().parse(
    JSON.parse(readFileSync(path, "utf8")) as unknown,
  );
  const actualHash = canonicalPlanHash(parsed.plan);
  if (parsed.planHash !== actualHash || acceptedHash.toLowerCase() !== actualHash.toLowerCase()) {
    throw new Error("accepted plan hash does not match the displayed pending Care Plan");
  }
  assertPlanMatchesDeployment(parsed.plan, deployment);
  if (parsed.plan.sessionExpiresAt <= nowSeconds ||
      parsed.plan.sessionExpiresAt - nowSeconds > 24 * 60 * 60) {
    throw new Error("pending Care Plan expiry is no longer valid; preview a new plan");
  }
  return parsed.plan;
}

export function writeEpisodeFile(episodesDir: string, episode: Episode): string {
  assertNoKeyMaterial(episode);
  mkdirSync(episodesDir, { recursive: true });
  const path = join(episodesDir, `${episode.episodeId}.json`);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(episode, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
  return path;
}

export async function runCheck(input: {
  client: PublicClient;
  deployment: DeploymentProfile;
  account: Address;
  plan?: CarePlan | null;
  episodesDir: string;
}): Promise<{ episode: Episode; path: string; human: string }> {
  const venus = venusDeploymentFromProfile(input.deployment);
  const observation = await observeAccount(input.client, venus, input.account);
  const reconstruction = reconstruct(observation);
  const head = await input.client.getBlockNumber();
  const plan = input.plan;
  const alert = plan?.alertBelow ?? "1.65";
  const intervene = plan?.interveneBelow ?? "1.60";
  const freshness = await assessObservationFreshness(input.client, observation, head);
  const status = assessProductStatus(reconstruction, alert, intervene, {
    stale: !freshness.fresh,
  });

  let outcome: Episode["outcome"] = "HELD";
  let reason: Episode["calculation"]["reason"] = "HEALTHY_NO_REPAIR";
  if (!freshness.fresh) {
    outcome = "BLOCKED";
    reason = "OBSERVATION_STALE";
  } else if (status.status === "INCONCLUSIVE") {
    outcome = "BLOCKED";
    reason = "OBSERVATION_INCONCLUSIVE";
  } else if (status.status === "WATCH") {
    reason = "WATCH_NO_REPAIR";
  } else if (status.status === "AT_RISK") {
    reason = "CHECK_ONLY_AT_RISK";
  } else {
    reason = "HEALTHY_NO_REPAIR";
  }

  const episode = buildEpisode({
    createdAt: Math.floor(Date.now() / 1000),
    plan: plan ?? null,
    productStatus: status.status,
    preState: {
      blockNumber: observation.blockNumber,
      blockHash: observation.blockHash,
      weightedCollateralUsd: reconstruction.weightedCollateralUsd.toString(10),
      borrowUsd: reconstruction.totalBorrowUsd.toString(10),
      healthFactorMantissa: reconstruction.healthFactorMantissa?.toString(10) ?? null,
      healthFactor: hfToDecimalString(reconstruction.healthFactorMantissa),
    },
    calculation: {
      decision: outcome === "BLOCKED" ? "BLOCK" : "HOLD",
      topUpRaw: "0",
      unbufferedTopUpRaw: null,
      requiredCollateralUsd: null,
      liquidationThresholdMantissa: null,
      priceMantissa: null,
      bufferBps: null,
      projectedHealthFactorMantissa: null,
      projectedHealthFactor: null,
      reason,
    },
    session: null,
    transaction: null,
    postState: null,
    outcome,
  });

  const path = writeEpisodeFile(input.episodesDir, episode);
  const human = [
    `check ${status.status}`,
    `block ${observation.blockNumber}`,
    `HF ${episode.preState.healthFactor ?? "infinite"}`,
    `outcome ${outcome} (${reason})`,
    `episode ${path}`,
  ].join("\n");
  return { episode, path, human };
}

export async function runActivate(input: {
  client: PublicClient;
  deployment: DeploymentProfile;
  adapter: AltanaAdapter;
  account: Address;
  draft: DraftCarePlanInput;
  accept: boolean;
  acceptedPlanHash?: Hex;
  statePath: string;
  nowSeconds?: number;
  sessionPrivateKey?: Hex;
  /** Receives the secret-bearing session in memory; never serialized in the result. */
  onSession?: (session: GrantSessionResult) => void;
}): Promise<{
  ok: boolean;
  message: string;
  plan?: CarePlan;
  planHash?: Hex;
  sessionRecord?: SessionRecord;
}> {
  if (!input.accept) {
    const drafted = await draftCarePlan(
      input.nowSeconds === undefined ? input.draft : { ...input.draft, nowSeconds: input.nowSeconds },
      input.deployment,
    );
    if (!drafted.ok) return { ok: false, message: `${drafted.code}: ${drafted.message}` };
    if (!drafted.validation.ok) {
      return { ok: false, message: `${drafted.validation.code}: ${drafted.validation.message}` };
    }
    const plan = drafted.validation.plan;
    const planHash = writePendingPlan(input.statePath, plan);
    return {
      ok: true,
      message: `draft ready; accept exactly plan ${planHash}. Activation includes a wallet-admin ERC-20 allowance to the verified Venus spender; that allowance survives session revocation. plan=${JSON.stringify(plan, null, 2)}`,
      plan,
      planHash,
    };
  }
  if (input.acceptedPlanHash === undefined) {
    return { ok: false, message: "acceptance requires the displayed planHash" };
  }
  let plan: CarePlan;
  try {
    plan = loadAcceptedPlan(
      input.statePath,
      input.acceptedPlanHash,
      input.deployment,
      input.nowSeconds ?? Math.floor(Date.now() / 1000),
    );
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
  const planHash = canonicalPlanHash(plan);

  const market = input.deployment.venus.market;
  const grant = await input.adapter.grantSession({
    wallet: getAddress(input.account),
    collateralToken: market.underlying,
    vToken: market.vToken,
    tokenSpendCapRaw: BigInt(plan.maxTopUpRaw),
    expiry: plan.sessionExpiresAt,
    ...(input.sessionPrivateKey ? { sessionPrivateKey: input.sessionPrivateKey } : {}),
  });

  if (grant.critical) {
    let revokeConfirmed = false;
    let revokeHash: Hex | null = null;
    try {
      const revoked = await input.adapter.revokeSession(getAddress(input.account), grant.session);
      revokeHash = revoked.hash;
      revokeConfirmed = !revoked.registeredAfter && !revoked.keyStoreValid;
    } catch {
      // Surface the CRITICAL block and preserve enough state for an explicit retry.
    }
    const sessionRecord: SessionRecord = {
      ...grant.record,
      ...(revokeHash ? { revokeTxHash: revokeHash } : {}),
      ...(revokeConfirmed ? { revokedAt: Math.floor(Date.now() / 1000) } : {}),
    };
    writeActiveState(input.statePath, {
      plan,
      planHash,
      sessionRecord,
      actionsConsumed: 0,
    });
    if (!revokeConfirmed) input.onSession?.(grant.session);
    return {
      ok: false,
      message: `activation blocked: CRITICAL authority discrepancy: ${grant.discrepancies
        .filter((d) => d.severity === "CRITICAL")
        .map((d) => d.code)
        .join(", ")}. No ERC-20 allowance was created; compensating revoke ${revokeConfirmed ? "confirmed" : "requires retry"}.`,
      plan,
      planHash,
      sessionRecord,
    };
  }

  let approveHash: Hex;
  try {
    approveHash = await input.adapter.adminApprove(
      market.approveSpender,
      BigInt(plan.maxTopUpRaw),
    );
  } catch (error) {
    let revokeConfirmed = false;
    let revokeHash: Hex | null = null;
    try {
      const revoked = await input.adapter.revokeSession(getAddress(input.account), grant.session);
      revokeHash = revoked.hash;
      revokeConfirmed = !revoked.registeredAfter && !revoked.keyStoreValid;
    } catch {
      // Preserve the approval error, but never claim the compensating revoke succeeded.
    }
    const sessionRecord: SessionRecord = {
      ...grant.record,
      ...(revokeHash ? { revokeTxHash: revokeHash } : {}),
      ...(revokeConfirmed ? { revokedAt: Math.floor(Date.now() / 1000) } : {}),
    };
    writeActiveState(input.statePath, {
      plan,
      planHash,
      sessionRecord,
      actionsConsumed: 0,
    });
    if (!revokeConfirmed) input.onSession?.(grant.session);
    return {
      ok: false,
      message: `activation approval failed after grant; compensating revoke ${revokeConfirmed ? "confirmed" : "was not confirmed"}: ${error instanceof Error ? error.message : String(error)}`,
      plan,
      planHash,
      sessionRecord,
    };
  }

  writeActiveState(input.statePath, {
    plan,
    planHash,
    sessionRecord: grant.record,
    actionsConsumed: 0,
    approveTxHash: approveHash,
  });
  input.onSession?.(grant.session);

  return {
    ok: true,
    message: `activated plan ${planHash}; grant ${grant.record.grantTxHash ?? "(no hash)"}; approve ${approveHash}. Keep the matching session key in the approved external keystore for rescue/revoke. The bounded ERC-20 allowance survives session revocation.`,
    plan,
    planHash,
    sessionRecord: grant.record,
  };
}

export async function runRescue(input: {
  client: PublicClient;
  deployment: DeploymentProfile;
  adapter: AltanaAdapter;
  account: Address;
  state: ActiveState;
  statePath: string;
  episodesDir: string;
  /** Secret-bearing session restored from the approved runtime keystore. */
  liveSession?: GrantSessionResult;
}): Promise<{ episode: Episode; path: string; human: string }> {
  const venus = venusDeploymentFromProfile(input.deployment);
  const observation = await observeAccount(input.client, venus, input.account);
  const reconstruction = reconstruct(observation);
  const head = await input.client.getBlockNumber();
  const freshness = await assessObservationFreshness(input.client, observation, head);
  const status = assessProductStatus(
    reconstruction,
    input.state.plan.alertBelow,
    input.state.plan.interveneBelow,
    { stale: !freshness.fresh },
  );

  const blockBeforePolicy = (reason: "OBSERVATION_STALE" | "OBSERVATION_INCONCLUSIVE" | "SESSION_MISSING") => {
    const episode = buildEpisode({
      createdAt: Math.floor(Date.now() / 1000),
      plan: input.state.plan,
      productStatus: status.status,
      preState: {
        blockNumber: observation.blockNumber,
        blockHash: observation.blockHash,
        weightedCollateralUsd: reconstruction.weightedCollateralUsd.toString(10),
        borrowUsd: reconstruction.totalBorrowUsd.toString(10),
        healthFactorMantissa: reconstruction.healthFactorMantissa?.toString(10) ?? null,
        healthFactor: hfToDecimalString(reconstruction.healthFactorMantissa),
      },
      calculation: {
        decision: "BLOCK",
        topUpRaw: "0",
        unbufferedTopUpRaw: null,
        requiredCollateralUsd: null,
        liquidationThresholdMantissa: null,
        priceMantissa: null,
        bufferBps: null,
        projectedHealthFactorMantissa: null,
        projectedHealthFactor: null,
        reason,
      },
      session: input.liveSession ? {
        publicKeyId: input.state.sessionRecord.keyId,
        expiresAt: input.state.sessionRecord.expiry,
        validAtExecution: false,
      } : null,
      transaction: null,
      postState: null,
      outcome: "BLOCKED",
    });
    const path = writeEpisodeFile(input.episodesDir, episode);
    return { episode, path, human: `rescue BLOCKED: ${reason}` };
  };

  if (!freshness.fresh) return blockBeforePolicy("OBSERVATION_STALE");
  if (reconstruction.unpriced.length > 0 || status.status === "INCONCLUSIVE") {
    return blockBeforePolicy("OBSERVATION_INCONCLUSIVE");
  }
  if (status.status === "HEALTHY" || status.status === "WATCH") {
    const reason = status.status === "HEALTHY" ? "HEALTHY_NO_REPAIR" : "WATCH_NO_REPAIR";
    const episode = buildEpisode({
      createdAt: Math.floor(Date.now() / 1000),
      plan: input.state.plan,
      productStatus: status.status,
      preState: {
        blockNumber: observation.blockNumber,
        blockHash: observation.blockHash,
        weightedCollateralUsd: reconstruction.weightedCollateralUsd.toString(10),
        borrowUsd: reconstruction.totalBorrowUsd.toString(10),
        healthFactorMantissa: reconstruction.healthFactorMantissa?.toString(10) ?? null,
        healthFactor: hfToDecimalString(reconstruction.healthFactorMantissa),
      },
      calculation: {
        decision: "HOLD",
        topUpRaw: "0",
        unbufferedTopUpRaw: null,
        requiredCollateralUsd: null,
        liquidationThresholdMantissa: null,
        priceMantissa: null,
        bufferBps: null,
        projectedHealthFactorMantissa: null,
        projectedHealthFactor: null,
        reason,
      },
      session: null,
      transaction: null,
      postState: null,
      outcome: "HELD",
    });
    const path = writeEpisodeFile(input.episodesDir, episode);
    return { episode, path, human: `rescue HELD: ${reason}` };
  }
  if (!input.liveSession) return blockBeforePolicy("SESSION_MISSING");

  let topUp;
  try {
    topUp = calculateTopUp(
      observation,
      reconstruction,
      input.state.plan,
      input.deployment.venus.market.vToken,
    );
  } catch {
    return blockBeforePolicy("OBSERVATION_INCONCLUSIVE");
  }

  const identityKeyHash = input.state.sessionRecord.keyHash;
  const enforced = await readEnforcedAuthority(input.client, {
    wallet: input.account,
    keyHash: identityKeyHash,
  });
  const permissions = deserializePermissions(input.state.sessionRecord.requestedPermissions);
  const discrepancies = diffRequestedVsEnforced(permissions, enforced, {
    orchestrator: ALTANA_DEPLOYMENT.orchestrator,
    requestedExpiry: input.state.sessionRecord.expiry,
  });
  const usdtLimit = enforced.spendLimits.find(
    (limit) =>
      limit.token.toLowerCase() === input.deployment.venus.market.underlying.toLowerCase(),
  );

  const sessionState: SessionPolicyState = {
    present: true,
    wallet: input.state.sessionRecord.walletAddress,
    expectedWallet: input.account,
    expiresAt: input.state.sessionRecord.expiry,
    registered: enforced.registered && input.state.sessionRecord.revokedAt === undefined,
    tokenSpendRemaining: usdtLimit?.remaining ?? null,
    enforced,
    discrepancies,
    actionsConsumed: input.state.actionsConsumed,
  };

  const mintPreview = topUp.bufferedRaw > 0n
    ? encodeMint(input.deployment.venus.market.vToken, topUp.bufferedRaw)
    : null;

  const decision = evaluateRescue({
    observation,
    reconstruction,
    plan: input.state.plan,
    topUp,
    headBlock: head,
    nowSeconds: Math.floor(Date.now() / 1000),
    session: sessionState,
    repairVToken: input.deployment.venus.market.vToken,
    ...(freshness.reason === "hash_mismatch" ? { observationPinValid: false } : {}),
    ...(mintPreview
      ? { preparedTarget: mintPreview.to, preparedSelector: mintPreview.selector }
      : {}),
  });

  if (decision.kind !== "EXECUTE" || mintPreview === null) {
    const outcome = decision.kind === "HOLD" ? "HELD" : "BLOCKED";
    const episode = buildEpisode({
      createdAt: Math.floor(Date.now() / 1000),
      plan: input.state.plan,
      productStatus: status.status,
      preState: {
        blockNumber: observation.blockNumber,
        blockHash: observation.blockHash,
        weightedCollateralUsd: reconstruction.weightedCollateralUsd.toString(10),
        borrowUsd: reconstruction.totalBorrowUsd.toString(10),
        healthFactorMantissa: reconstruction.healthFactorMantissa?.toString(10) ?? null,
        healthFactor: hfToDecimalString(reconstruction.healthFactorMantissa),
      },
      calculation: {
        decision: decision.kind === "HOLD" ? "HOLD" : "BLOCK",
        topUpRaw: "0",
        unbufferedTopUpRaw: topUp.unbufferedRaw.toString(10),
        requiredCollateralUsd: topUp.requiredCollateralUsd.toString(10),
        liquidationThresholdMantissa: topUp.liquidationThresholdMantissa.toString(10),
        priceMantissa: topUp.priceMantissa.toString(10),
        bufferBps: null,
        projectedHealthFactorMantissa: topUp.projectedHealthFactorMantissa?.toString(10) ?? null,
        projectedHealthFactor: hfToDecimalString(topUp.projectedHealthFactorMantissa),
        reason: decision.reason,
      },
      session: {
        publicKeyId: input.state.sessionRecord.keyId,
        expiresAt: input.state.sessionRecord.expiry,
        validAtExecution: sessionState.registered,
      },
      transaction: null,
      postState: null,
      outcome,
    });
    const path = writeEpisodeFile(input.episodesDir, episode);
    return { episode, path, human: `rescue ${outcome}: ${decision.message}` };
  }

  const executionEpisode = (details: {
    reason: Episode["calculation"]["reason"];
    transaction: Episode["transaction"];
    postState?: Episode["postState"];
    outcome?: "EXECUTED" | "FAILED";
  }) => {
    const episode = buildEpisode({
      createdAt: Math.floor(Date.now() / 1000),
      plan: input.state.plan,
      productStatus: status.status,
      preState: {
        blockNumber: observation.blockNumber,
        blockHash: observation.blockHash,
        weightedCollateralUsd: reconstruction.weightedCollateralUsd.toString(10),
        borrowUsd: reconstruction.totalBorrowUsd.toString(10),
        healthFactorMantissa: reconstruction.healthFactorMantissa?.toString(10) ?? null,
        healthFactor: hfToDecimalString(reconstruction.healthFactorMantissa),
      },
      calculation: {
        decision: "EXECUTE",
        topUpRaw: topUp.bufferedRaw.toString(10),
        unbufferedTopUpRaw: topUp.unbufferedRaw.toString(10),
        requiredCollateralUsd: topUp.requiredCollateralUsd.toString(10),
        liquidationThresholdMantissa: topUp.liquidationThresholdMantissa.toString(10),
        priceMantissa: topUp.priceMantissa.toString(10),
        bufferBps: TOP_UP_BUFFER_BPS.toString(10),
        projectedHealthFactorMantissa: topUp.projectedHealthFactorMantissa?.toString(10) ?? null,
        projectedHealthFactor: hfToDecimalString(topUp.projectedHealthFactorMantissa),
        reason: details.reason,
      },
      session: {
        publicKeyId: input.state.sessionRecord.keyId,
        expiresAt: input.state.sessionRecord.expiry,
        validAtExecution: true,
      },
      transaction: details.transaction,
      postState: details.postState ?? null,
      outcome: details.outcome ?? "FAILED",
      ...(details.transaction
        ? { explorer: {
            mintTx: explorerTxUrl(input.deployment, details.transaction.hash),
            grantTx: input.state.sessionRecord.grantTxHash
              ? explorerTxUrl(input.deployment, input.state.sessionRecord.grantTxHash)
              : null,
          } }
        : {}),
    });
    const path = writeEpisodeFile(input.episodesDir, episode);
    return {
      episode,
      path,
      human: `rescue ${episode.outcome}: ${details.reason}${details.transaction ? ` tx=${details.transaction.hash}` : ""}`,
    };
  };

  let executed: Awaited<ReturnType<AltanaAdapter["executeMint"]>>;
  try {
    executed = await input.adapter.executeMint(
      input.liveSession,
      mintPreview.to,
      mintPreview.data,
    );
  } catch {
    return executionEpisode({ reason: "TRANSACTION_UNRESOLVED", transaction: null });
  }

  // A returned transaction hash proves the one authorized action was submitted.
  // Consume it before any later receipt or post-state operation can fail.
  input.state.actionsConsumed += 1;
  writeActiveState(input.statePath, {
    plan: input.state.plan,
    planHash: input.state.planHash,
    sessionRecord: input.state.sessionRecord,
    actionsConsumed: input.state.actionsConsumed,
    ...(input.state.approveTxHash ? { approveTxHash: input.state.approveTxHash } : {}),
  });

  const transaction: NonNullable<Episode["transaction"]> = {
    hash: executed.hash,
    status: executed.status,
    blockNumber: executed.blockNumber?.toString(10) ?? null,
  };
  if (executed.status === "SUBMITTED") {
    return executionEpisode({ reason: "TRANSACTION_UNRESOLVED", transaction });
  }
  if (executed.status === "FAILED") {
    return executionEpisode({ reason: "RECEIPT_REVERTED", transaction });
  }

  try {
    await input.adapter.verifyReceiptAttribution(executed.hash, {
      vToken: input.deployment.venus.market.vToken,
      underlying: input.deployment.venus.market.underlying,
      wallet: input.account,
      amountRaw: topUp.bufferedRaw,
    });
  } catch {
    return executionEpisode({ reason: "RECEIPT_ATTRIBUTION_FAILED", transaction });
  }

  let postObservation;
  try {
    postObservation = await observeAccount(input.client, venus, input.account);
  } catch {
    return executionEpisode({ reason: "POST_STATE_INCONCLUSIVE", transaction });
  }
  const postReconstruction = reconstruct(postObservation);
  let postFreshness;
  try {
    const postHead = await input.client.getBlockNumber();
    postFreshness = await assessObservationFreshness(input.client, postObservation, postHead);
  } catch {
    return executionEpisode({ reason: "POST_STATE_INCONCLUSIVE", transaction });
  }
  const postComplete = postReconstruction.unpriced.length === 0 && postFreshness.fresh;
  const restore = parseThresholdToMantissa(input.state.plan.restoreTo);
  const postHf = postComplete ? postReconstruction.healthFactorMantissa : null;
  const targetReached = postHf !== null && postHf >= restore;
  const postState: NonNullable<Episode["postState"]> = {
    blockNumber: postObservation.blockNumber,
    blockHash: postObservation.blockHash,
    healthFactorMantissa: postHf?.toString(10) ?? null,
    healthFactor: hfToDecimalString(postHf),
    targetReached,
  };
  if (!postComplete) {
    return executionEpisode({ reason: "POST_STATE_INCONCLUSIVE", transaction, postState });
  }
  return executionEpisode({
    reason: targetReached ? "EXECUTED_TARGET_REACHED" : "POST_STATE_MISSED_TARGET",
    transaction: {
      hash: executed.hash,
      status: "CONFIRMED",
      blockNumber: executed.blockNumber?.toString(10) ?? null,
    },
    postState,
    outcome: targetReached ? "EXECUTED" : "FAILED",
  });
}

export async function runRevoke(input: {
  adapter: AltanaAdapter;
  account: Address;
  deployment: DeploymentProfile;
  state: Omit<ActiveState, "session">;
  statePath: string;
}): Promise<{ ok: boolean; message: string; revokeHash: Hex | null; remainingAllowance: bigint }> {
  const result = await input.adapter.revokeSession(
    input.account,
    input.state.sessionRecord.publicKey,
  );
  const remaining = await input.adapter.readAllowance(
    input.account,
    input.deployment.venus.market.approveSpender,
  );
  if (result.registeredAfter || result.keyStoreValid) {
    return {
      ok: false,
      message: "revoke submitted but session still registered on-chain",
      revokeHash: result.hash,
      remainingAllowance: remaining,
    };
  }
  const revokedAt = Math.floor(Date.now() / 1000);
  writeActiveState(input.statePath, {
    ...input.state,
    sessionRecord: {
      ...input.state.sessionRecord,
      ...(result.hash ? { revokeTxHash: result.hash } : {}),
      revokedAt,
    },
  });
  return {
    ok: true,
    message: `session revoked. remaining ERC-20 allowance to vToken spender: ${remaining.toString(10)} (revocation does not clear allowance).`,
    revokeHash: result.hash,
    remainingAllowance: remaining,
  };
}
