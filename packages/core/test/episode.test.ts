import { describe, expect, it } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDeployment } from "../src/deployment.js";
import { validateCarePlan } from "../src/schemas/plan.js";
import {
  buildEpisode,
  verifyEpisode,
  canonicalPlanHash,
} from "../src/episode/build.js";
import { canonicalHash } from "../src/episode/canonical.js";

const here = dirname(fileURLToPath(import.meta.url));
const deployment = loadDeployment(
  join(here, "..", "..", "..", "deployments", "bsc-testnet.json"),
);

describe("episode builder", () => {
  it("hashes plans deterministically", () => {
    const a = validateCarePlan({ preset: "balanced" }, deployment, 1_700_000_000);
    const b = validateCarePlan({ preset: "balanced" }, deployment, 1_700_000_000);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(canonicalPlanHash(a.plan)).toBe(canonicalPlanHash(b.plan));
  });

  it("maps check AT_RISK to HELD + CHECK_ONLY_AT_RISK with null tx", () => {
    const validated = validateCarePlan({ preset: "conservative" }, deployment, 1_700_000_000);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const episode = buildEpisode({
      createdAt: 1_700_000_000,
      plan: validated.plan,
      productStatus: "AT_RISK",
      preState: {
        blockNumber: "1",
        blockHash: "0xabc",
        weightedCollateralUsd: "1",
        borrowUsd: "1",
        healthFactorMantissa: "1000000000000000000",
        healthFactor: "1.000000",
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
        reason: "CHECK_ONLY_AT_RISK",
      },
      session: null,
      transaction: null,
      postState: null,
      outcome: "HELD",
    });
    expect(episode.outcome).toBe("HELD");
    expect(episode.calculation.reason).toBe("CHECK_ONLY_AT_RISK");
    expect(episode.transaction).toBeNull();
    expect(episode.postState).toBeNull();
    const verified = verifyEpisode(episode);
    expect(verified.ok).toBe(true);
  });

  it("rejects a changed embedded plan even when the episode hash is recomputed", () => {
    const validated = validateCarePlan({ preset: "balanced" }, deployment, 1_700_000_000);
    if (!validated.ok) throw new Error(validated.message);
    const episode = buildEpisode({
      createdAt: 1_700_000_000,
      plan: validated.plan,
      productStatus: "HEALTHY",
      preState: { blockNumber: "1", blockHash: "0xabc", weightedCollateralUsd: "2", borrowUsd: "1", healthFactorMantissa: "2000000000000000000", healthFactor: "2.000000" },
      calculation: { decision: "HOLD", topUpRaw: "0", unbufferedTopUpRaw: null, requiredCollateralUsd: null, liquidationThresholdMantissa: null, priceMantissa: null, bufferBps: null, projectedHealthFactorMantissa: null, projectedHealthFactor: null, reason: "HEALTHY_NO_REPAIR" },
      session: null,
      transaction: null,
      postState: null,
      outcome: "HELD",
    });
    const changed = structuredClone(episode);
    changed.plan.value!.restoreTo = "9.99";
    const { episodeId: _old, ...payload } = changed;
    changed.episodeId = canonicalHash(payload);
    expect(verifyEpisode(changed).ok).toBe(false);
  });
});
