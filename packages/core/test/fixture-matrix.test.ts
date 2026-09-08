/**
 * Phase 2 fixture matrix — pure policy/episode paths, no spend.
 */
import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Address, Hex } from "viem";
import { loadDeployment } from "../src/deployment.js";
import { validateCarePlan } from "../src/schemas/plan.js";
import { reconstruct } from "../src/health/accounting.js";
import { calculateTopUp } from "../src/topup.js";
import { evaluateRescue } from "../src/policy.js";
import { buildEpisode, hfToDecimalString, verifyEpisode } from "../src/episode/build.js";
import { FROZEN, VUSDC } from "./fixtures.js";
import type { EnforcedAuthority } from "../src/altana/account-reads.js";
import type { CarePlan } from "../src/schemas/plan.js";
import type { SessionPolicyState } from "../src/policy.js";

const here = dirname(fileURLToPath(import.meta.url));
const deployment = loadDeployment(
  join(here, "..", "..", "..", "deployments", "bsc-testnet.json"),
);

function basePlan(now: number): CarePlan {
  const result = validateCarePlan(
    {
      preset: "custom",
      alertBelow: "3.05",
      interveneBelow: "3.00",
      restoreTo: "4.00",
      maxTopUpRaw: "25000000",
      sessionDurationSeconds: 3600,
    },
    deployment,
    now,
  );
  if (!result.ok) throw new Error(result.message);
  return result.plan;
}

function session(overrides: Partial<SessionPolicyState> = {}): SessionPolicyState {
  const enforced: EnforcedAuthority = {
    wallet: FROZEN.account as Address,
    keyHash: ("0x" + "11".repeat(32)) as Hex,
    registered: true,
    expiry: 1_800_000_000,
    isSuperAdmin: false,
    callRules: [],
    walletWideRules: [],
    spendLimits: [],
    observedAtBlock: BigInt(FROZEN.blockNumber),
  };
  return {
    present: true,
    wallet: FROZEN.account as Address,
    expectedWallet: FROZEN.account as Address,
    expiresAt: 1_800_000_000,
    registered: true,
    tokenSpendRemaining: 25_000_000n,
    enforced,
    discrepancies: [],
    actionsConsumed: 0,
    ...overrides,
  };
}

describe("Phase 2 fixture matrix", () => {
  const now = 1_700_000_000;
  const reconstruction = reconstruct(FROZEN);
  const plan = basePlan(now);
  const topUp = calculateTopUp(FROZEN, reconstruction, plan, VUSDC);

  it("HOLD when HEALTHY relative to plan", () => {
    const healthyPlan = {
      ...plan,
      alertBelow: "2.40",
      interveneBelow: "2.30",
      restoreTo: "2.60",
    };
    const decision = evaluateRescue({
      observation: FROZEN,
      reconstruction,
      plan: healthyPlan,
      topUp: calculateTopUp(FROZEN, reconstruction, healthyPlan, VUSDC),
      headBlock: BigInt(FROZEN.blockNumber),
      nowSeconds: now,
      session: session(),
      repairVToken: VUSDC,
    });
    expect(decision.kind).toBe("HOLD");
    expect(decision.reason).toBe("HEALTHY_NO_REPAIR");
  });

  it("BLOCK when observation stale", () => {
    const decision = evaluateRescue({
      observation: FROZEN,
      reconstruction,
      plan,
      topUp,
      headBlock: BigInt(FROZEN.blockNumber) + 65n,
      nowSeconds: now,
      session: session(),
      repairVToken: VUSDC,
    });
    expect(decision.kind).toBe("BLOCK");
    expect(decision.reason).toBe("OBSERVATION_STALE");
  });

  it("BLOCK when top-up exceeds plan", () => {
    const tiny = { ...plan, maxTopUpRaw: "1" };
    const decision = evaluateRescue({
      observation: FROZEN,
      reconstruction,
      plan: tiny,
      topUp,
      headBlock: BigInt(FROZEN.blockNumber),
      nowSeconds: now,
      session: session(),
      repairVToken: VUSDC,
    });
    expect(decision.kind).toBe("BLOCK");
    expect(decision.reason).toBe("TOP_UP_EXCEEDS_PLAN");
  });

  it("BLOCK when session expired", () => {
    const decision = evaluateRescue({
      observation: FROZEN,
      reconstruction,
      plan,
      topUp,
      headBlock: BigInt(FROZEN.blockNumber),
      nowSeconds: plan.sessionExpiresAt + 1,
      session: session({ expiresAt: plan.sessionExpiresAt - 10 }),
      repairVToken: VUSDC,
    });
    expect(decision.kind).toBe("BLOCK");
    expect(decision.reason).toBe("SESSION_EXPIRED");
  });

  it("BLOCK when action already consumed", () => {
    const decision = evaluateRescue({
      observation: FROZEN,
      reconstruction,
      plan,
      topUp,
      headBlock: BigInt(FROZEN.blockNumber),
      nowSeconds: now,
      session: session({ actionsConsumed: 1 }),
      repairVToken: VUSDC,
    });
    expect(decision.kind).toBe("BLOCK");
    expect(decision.reason).toBe("ACTION_ALREADY_CONSUMED");
  });

  it("BLOCK unexpected selector", () => {
    const decision = evaluateRescue({
      observation: FROZEN,
      reconstruction,
      plan,
      topUp,
      headBlock: BigInt(FROZEN.blockNumber),
      nowSeconds: now,
      session: session(),
      repairVToken: VUSDC,
      preparedTarget: VUSDC,
      preparedSelector: "0xdeadbeef",
    });
    expect(decision.kind).toBe("BLOCK");
    expect(decision.reason).toBe("UNEXPECTED_TARGET_OR_SELECTOR");
  });

  it("episode verify rejects EXECUTED without targetReached", () => {
    const episode = buildEpisode({
      createdAt: now,
      plan,
      productStatus: "AT_RISK",
      preState: {
        blockNumber: "1",
        blockHash: "0x1",
        weightedCollateralUsd: "1",
        borrowUsd: "1",
        healthFactorMantissa: "1000000000000000000",
        healthFactor: "1.000000",
      },
      calculation: {
        decision: "EXECUTE",
        topUpRaw: "1",
        unbufferedTopUpRaw: "1",
        requiredCollateralUsd: "1",
        liquidationThresholdMantissa: "1",
        priceMantissa: "1",
        bufferBps: "50",
        projectedHealthFactorMantissa: "2000000000000000000",
        projectedHealthFactor: "2.000000",
        reason: "POST_STATE_MISSED_TARGET",
      },
      session: {
        publicKeyId: "0x1",
        expiresAt: now + 1,
        validAtExecution: true,
      },
      transaction: { hash: "0xabc", status: "CONFIRMED", blockNumber: "2" },
      postState: {
        blockNumber: "2",
        blockHash: "0x2",
        healthFactorMantissa: "1100000000000000000",
        healthFactor: "1.100000",
        targetReached: false,
      },
      outcome: "EXECUTED",
    });
    const verified = verifyEpisode(episode);
    expect(verified.ok).toBe(false);
  });

  it("episode verifier reproduces a complete deterministic execution calculation", () => {
    const projected = topUp.projectedHealthFactorMantissa;
    if (projected === null) throw new Error("fixture must have projected health");
    const episode = buildEpisode({
      createdAt: now,
      plan,
      productStatus: "AT_RISK",
      preState: {
        blockNumber: FROZEN.blockNumber,
        blockHash: FROZEN.blockHash,
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
        bufferBps: "50",
        projectedHealthFactorMantissa: projected.toString(10),
        projectedHealthFactor: hfToDecimalString(projected),
        reason: "EXECUTED_TARGET_REACHED",
      },
      session: { publicKeyId: "0x1", expiresAt: now + 1, validAtExecution: true },
      transaction: { hash: "0xabc", status: "CONFIRMED", blockNumber: "2" },
      postState: {
        blockNumber: "2",
        blockHash: "0x2",
        healthFactorMantissa: projected.toString(10),
        healthFactor: hfToDecimalString(projected),
        targetReached: true,
      },
      outcome: "EXECUTED",
    });
    expect(verifyEpisode(episode)).toMatchObject({ ok: true, errors: [] });
  });
});
