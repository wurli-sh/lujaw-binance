import { describe, expect, it } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDeployment } from "../src/deployment.js";
import { validateCarePlan } from "../src/schemas/plan.js";
import { CARE_PLAN_PRESETS } from "../src/constants.js";

const here = dirname(fileURLToPath(import.meta.url));
const deployment = loadDeployment(
  join(here, "..", "..", "..", "deployments", "bsc-testnet.json"),
);

describe("Care Plan schemas", () => {
  it("accepts conservative preset against deployment", () => {
    const result = validateCarePlan(
      { preset: "conservative" },
      deployment,
      1_700_000_000,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.chainId).toBe(97);
    expect(result.plan.alertBelow).toBe(CARE_PLAN_PRESETS.conservative.alertBelow);
    expect(result.plan.interveneBelow).toBe("1.60");
    expect(result.plan.maxTopUpRaw).toBe("25000000");
    expect(result.plan.supplySelector).toBe(deployment.venus.market.supplySelector);
    expect(result.plan.market.toLowerCase()).toBe(
      deployment.venus.market.vToken.toLowerCase(),
    );
  });

  it("rejects intervene >= alert", () => {
    const result = validateCarePlan(
      {
        preset: "custom",
        alertBelow: "1.50",
        interveneBelow: "1.50",
        restoreTo: "1.80",
        maxTopUpRaw: "1000000",
        sessionDurationSeconds: 3600,
      },
      deployment,
      1_700_000_000,
    );
    expect(result.ok).toBe(false);
  });

  it("caps custom maxTopUp at 25 USDT raw", () => {
    const result = validateCarePlan(
      {
        preset: "custom",
        alertBelow: "1.55",
        interveneBelow: "1.50",
        restoreTo: "1.70",
        maxTopUpRaw: "25000001",
        sessionDurationSeconds: 3600,
      },
      deployment,
      1_700_000_000,
    );
    expect(result.ok).toBe(false);
  });
});
