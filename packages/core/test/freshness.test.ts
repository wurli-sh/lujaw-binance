import { describe, expect, it } from "vitest";
import { isObservationFresh } from "../src/freshness.js";
import { evaluateRescue } from "../src/policy.js";
import { reconstruct } from "../src/health/accounting.js";
import { calculateTopUp } from "../src/topup.js";
import { validateCarePlan } from "../src/schemas/plan.js";
import { loadDeployment } from "../src/deployment.js";
import { FROZEN, VUSDC } from "./fixtures.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Address, Hex } from "viem";

const here = dirname(fileURLToPath(import.meta.url));
const deployment = loadDeployment(
  join(here, "..", "..", "..", "deployments", "bsc-testnet.json"),
);

describe("freshness + pin mismatch", () => {
  it("age gate at 64 blocks", () => {
    const obs = 100n;
    expect(isObservationFresh(obs, 164n, 64n)).toBe(true);
    expect(isObservationFresh(obs, 165n, 64n)).toBe(false);
  });

  it("blocks rescue on hash mismatch even when age is fresh", () => {
    const now = 1_700_000_000;
    const planResult = validateCarePlan(
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
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) return;
    const reconstruction = reconstruct(FROZEN);
    const topUp = calculateTopUp(FROZEN, reconstruction, planResult.plan, VUSDC);
    const decision = evaluateRescue({
      observation: FROZEN,
      reconstruction,
      plan: planResult.plan,
      topUp,
      headBlock: BigInt(FROZEN.blockNumber),
      nowSeconds: now,
      observationPinValid: false,
      session: {
        present: true,
        wallet: FROZEN.account as Address,
        expectedWallet: FROZEN.account as Address,
        expiresAt: 1_800_000_000,
        registered: true,
        tokenSpendRemaining: 25_000_000n,
        enforced: {
          wallet: FROZEN.account as Address,
          keyHash: ("0x" + "11".repeat(32)) as Hex,
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
    expect(decision.reason).toBe("OBSERVATION_STALE");
  });
});
