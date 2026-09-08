import { describe, expect, it } from "vitest";

/**
 * Opt-in live end-to-end: activate → rescue → revoke on funded testnet owner.
 * Skipped unless LUJAW_LIVE=1 and OWNER_PRIVATE_KEY + BSC_TESTNET_RPC_URL are set.
 */
const live = process.env.LUJAW_LIVE === "1";

describe.skipIf(!live)("live activate→rescue→revoke", () => {
  it("runs funded path when LUJAW_LIVE=1", async () => {
    const { createRuntime, cmdActivate, cmdCheck, cmdRescue, cmdRevoke } = await import(
      "../src/runtime.js"
    );
    const runtime = createRuntime();
    const check = await cmdCheck(runtime);
    expect(check.episode.version).toBe("lujaw.episode/1");

    const preview = await cmdActivate(runtime, {
      draft: { preset: "balanced" },
      accept: false,
    });
    expect(preview.planHash).toBeDefined();
    const activated = await cmdActivate(runtime, {
      draft: { preset: "balanced" },
      accept: true,
      acceptedPlanHash: preview.planHash!,
    });
    expect(activated.ok).toBe(true);
    expect(runtime.liveSession).not.toBeNull();

    const rescue = await cmdRescue(runtime);
    expect(["HELD", "BLOCKED", "EXECUTED", "FAILED"]).toContain(rescue.episode.outcome);

    const revoked = await cmdRevoke(runtime);
    expect(revoked.ok).toBe(true);
  }, 300_000);
});
