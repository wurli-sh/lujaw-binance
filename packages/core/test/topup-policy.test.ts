import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { reconstruct } from "../src/health/accounting.js";
import { assessProductStatus } from "../src/health/status.js";
import { calculateTopUp } from "../src/topup.js";
import { evaluateRescue } from "../src/policy.js";
import { isObservationFresh } from "../src/freshness.js";
import { validateCarePlan } from "../src/schemas/plan.js";
import { loadDeployment } from "../src/deployment.js";
import { FROZEN, VUSDC } from "./fixtures.js";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const deployment = loadDeployment(
  join(here, "..", "..", "..", "deployments", "bsc-testnet.json"),
);

function planAt(now: number) {
  const result = validateCarePlan(
    {
      preset: "custom",
      alertBelow: "3.00",
      interveneBelow: "2.80",
      restoreTo: "3.20",
      maxTopUpRaw: "25000000",
      sessionDurationSeconds: 3600,
    },
    deployment,
    now,
  );
  if (!result.ok) throw new Error(result.message);
  return result.plan;
}

describe("status + top-up + policy", () => {
  it("maps HF bands", () => {
    const reconstruction = reconstruct(FROZEN);
    // frozen HF ≈ 2.505467
    expect(assessProductStatus(reconstruction, "2.40", "2.30").status).toBe("HEALTHY");
    expect(assessProductStatus(reconstruction, "2.60", "2.40").status).toBe("WATCH");
    expect(assessProductStatus(reconstruction, "2.70", "2.60").status).toBe("AT_RISK");
    expect(assessProductStatus(reconstruction, "2.40", "2.30", { stale: true }).status).toBe(
      "INCONCLUSIVE",
    );
  });

  it("applies 50 bps buffer and min +1 raw", () => {
    const reconstruction = reconstruct(FROZEN);
    const plan = planAt(1_700_000_000);
    // Force AT_RISK-scale restore so unbuffered > 0 against frozen HF ~2.50
    const highRestore = {
      ...plan,
      restoreTo: "4.00",
      interveneBelow: "3.00",
      alertBelow: "3.05",
    };
    const topUp = calculateTopUp(FROZEN, reconstruction, highRestore, VUSDC);
    expect(topUp.repairMarketEntered).toBe(true);
    expect(topUp.unbufferedRaw).toBeGreaterThan(0n);
    expect(topUp.bufferedRaw).toBeGreaterThanOrEqual(topUp.unbufferedRaw + 1n);
    const expected =
      (topUp.unbufferedRaw * 10050n + 9999n) / 10000n;
    const flooredMin = topUp.unbufferedRaw + 1n;
    expect(topUp.bufferedRaw).toBe(expected > flooredMin ? expected : flooredMin);
  });

  it("blocks when repair market not entered", () => {
    const reconstruction = reconstruct(FROZEN);
    const plan = planAt(1_700_000_000);
    const highRestore = {
      ...plan,
      restoreTo: "4.00",
      interveneBelow: "3.00",
      alertBelow: "3.05",
    };
    const topUp = calculateTopUp(FROZEN, reconstruction, highRestore, VUSDC);
    const notEntered = { ...topUp, repairMarketEntered: false };
    const decision = evaluateRescue({
      observation: FROZEN,
      reconstruction,
      plan: highRestore,
      topUp: notEntered,
      headBlock: BigInt(FROZEN.blockNumber),
      nowSeconds: 1_700_000_000,
      session: {
        present: true,
        wallet: FROZEN.account as Address,
        expectedWallet: FROZEN.account as Address,
        expiresAt: 1_800_000_000,
        registered: true,
        tokenSpendRemaining: 25_000_000n,
        enforced: {
          wallet: FROZEN.account as Address,
          keyHash: ("0x" + "11".repeat(32)) as `0x${string}`,
          registered: true,
          expiry: 1_800_000_000,
          isSuperAdmin: false,
          callRules: [],
          walletWideRules: [],
          spendLimits: [],
          observedAtBlock: BigInt(FROZEN.blockNumber),
        },
        discrepancies: [],
        actionsConsumed: 0,
      },
      repairVToken: VUSDC,
    });
    expect(decision.kind).toBe("BLOCK");
    expect(decision.reason).toBe("REPAIR_MARKET_NOT_ENTERED");
  });

  it("holds a healthy position without requiring repair readiness", () => {
    const reconstruction = reconstruct(FROZEN);
    const plan = planAt(1_700_000_000);
    const healthyPlan = { ...plan, alertBelow: "2.40", interveneBelow: "2.30", restoreTo: "2.60" };
    const topUp = calculateTopUp(FROZEN, reconstruction, healthyPlan, VUSDC);
    const decision = evaluateRescue({
      observation: FROZEN,
      reconstruction,
      plan: healthyPlan,
      topUp: { ...topUp, repairMarketEntered: false },
      headBlock: BigInt(FROZEN.blockNumber),
      nowSeconds: 1_700_000_000,
      session: {
        present: false,
        wallet: FROZEN.account as Address,
        expectedWallet: FROZEN.account as Address,
        expiresAt: 0,
        registered: false,
        tokenSpendRemaining: null,
        enforced: null,
        discrepancies: [],
        actionsConsumed: 1,
      },
      repairVToken: VUSDC,
    });
    expect(decision.kind).toBe("HOLD");
    expect(decision.reason).toBe("HEALTHY_NO_REPAIR");
  });

  it("freshness rejects head - obs > 64", () => {
    const obs = BigInt(FROZEN.blockNumber);
    expect(isObservationFresh(obs, obs + 64n, 64n)).toBe(true);
    expect(isObservationFresh(obs, obs + 65n, 64n)).toBe(false);
  });
});
