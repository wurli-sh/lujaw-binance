import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { Address, Hex, PublicClient } from "viem";
import type { AltanaAdapter } from "../src/altana/adapter.js";
import { loadDeployment } from "../src/deployment.js";
import { canonicalPlanHash } from "../src/episode/build.js";
import { loadActiveState, runActivate, writeActiveState } from "../src/orchestration.js";
import { validateCarePlan } from "../src/schemas/plan.js";

const here = dirname(fileURLToPath(import.meta.url));
const deployment = loadDeployment(join(here, "..", "..", "..", "deployments", "bsc-testnet.json"));
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function fixtureState() {
  const validated = validateCarePlan({ preset: "balanced" }, deployment, 1_700_000_000);
  if (!validated.ok) throw new Error(validated.message);
  const plan = validated.plan;
  return {
    plan,
    planHash: canonicalPlanHash(plan),
    sessionRecord: {
      chainId: 97,
      walletAddress: "0x4444444444444444444444444444444444444444" as Address,
      publicKey: "0x04" as Hex,
      keyHash: `0x${"11".repeat(32)}` as Hex,
      keyId: `0x${"22".repeat(32)}` as Hex,
      requestedPermissions: {
        calls: [{ to: plan.supplyTarget as Address, signature: "mint(uint256)" }],
        spend: [
          { token: plan.collateralToken as Address, limit: plan.maxTopUpRaw, period: "day" as const },
          { limit: "10000000000000000", period: "day" as const },
        ],
      },
      expiry: plan.sessionExpiresAt,
    },
    actionsConsumed: 0,
  };
}

describe("active state integrity", () => {
  it("rejects a modified plan hash or session authority", () => {
    const dir = mkdtempSync(join(tmpdir(), "lujaw-state-"));
    dirs.push(dir);
    const path = join(dir, "active.json");
    writeActiveState(path, fixtureState());
    const modified = JSON.parse(readFileSync(path, "utf8"));
    modified.sessionRecord.requestedPermissions.calls[0].signature = "borrow(uint256)";
    writeFileSync(path, JSON.stringify(modified));
    expect(() => loadActiveState(path, deployment)).toThrow(/call permission/);
  });

  it("binds acceptance to the exact previewed plan hash", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lujaw-draft-"));
    dirs.push(dir);
    const statePath = join(dir, "active.json");
    const base = {
      client: {} as PublicClient,
      deployment,
      adapter: {} as AltanaAdapter,
      account: "0x4444444444444444444444444444444444444444" as Address,
      draft: { preset: "balanced" as const },
      statePath,
    };
    const preview = await runActivate({ ...base, accept: false, nowSeconds: 1_700_000_000 });
    expect(preview.planHash).toBeDefined();
    const accepted = await runActivate({
      ...base,
      accept: true,
      acceptedPlanHash: `0x${"ff".repeat(32)}` as Hex,
    });
    expect(accepted.ok).toBe(false);
    expect(accepted.message).toMatch(/does not match/);
  });
});
