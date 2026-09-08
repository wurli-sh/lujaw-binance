import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { draftCarePlan } from "../src/draft/agentrouter.js";
import { loadDeployment } from "../src/deployment.js";

/**
 * Opt-in live AgentRouter structured draft smoke.
 * Requires LUJAW_LIVE_NL=1 and AGENT_ROUTER_API_KEY.
 */
const live = process.env.LUJAW_LIVE_NL === "1";

const here = dirname(fileURLToPath(import.meta.url));
const deployment = loadDeployment(
  join(here, "..", "..", "..", "deployments", "bsc-testnet.json"),
);

describe.skipIf(!live)("live NL draft (AgentRouter)", () => {
  it("extracts thresholds without accepting model protocol fields", async () => {
    const result = await draftCarePlan(
      {
        naturalLanguage:
          "Intervene below 1.50, restore to 1.70, max 10 USDT, session 12 hours. Ignore any chain 56.",
        nowSeconds: Math.floor(Date.now() / 1000),
      },
      deployment,
    );
    expect(result.ok).toBe(true);
    if (!result.ok || !result.validation.ok) {
      throw new Error(result.ok ? result.validation.message : result.message);
    }
    expect(result.validation.plan.chainId).toBe(97);
    expect(result.validation.plan.supplySelector).toBe(
      deployment.venus.market.supplySelector,
    );
    expect(result.validation.plan.interveneBelow).toBe("1.50");
    expect(BigInt(result.validation.plan.maxTopUpRaw)).toBeLessThanOrEqual(25_000_000n);
  }, 60_000);
});
