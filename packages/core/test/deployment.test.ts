import { describe, expect, it } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDeployment, venusDeploymentFromProfile } from "../src/deployment.js";
import {
  BALANCED_MAX_TOP_UP_RAW,
  DEFAULT_NATIVE_FEE_CAP_WEI,
  MAX_OBSERVATION_AGE_BLOCKS,
  MAX_TOP_UP_RAW,
  TOP_UP_BUFFER_BPS,
} from "../src/constants.js";

const here = dirname(fileURLToPath(import.meta.url));
const deploymentPath = join(here, "..", "..", "..", "deployments", "bsc-testnet.json");

describe("Phase 2 constants + deployment", () => {
  it("freezes freshness, buffer, native cap, and max top-up", () => {
    expect(MAX_OBSERVATION_AGE_BLOCKS).toBe(64n);
    expect(TOP_UP_BUFFER_BPS).toBe(50n);
    expect(DEFAULT_NATIVE_FEE_CAP_WEI).toBe(10n ** 16n);
    expect(MAX_TOP_UP_RAW).toBe(25_000_000n);
    expect(BALANCED_MAX_TOP_UP_RAW).toBe(15_000_000n);
  });

  it("loads bsc-testnet deployment with chain 97 USDT 6dp", () => {
    const profile = loadDeployment(deploymentPath);
    expect(profile.chainId).toBe(97);
    expect(profile.venus.market.symbol).toBe("USDT");
    expect(profile.venus.market.underlyingDecimals).toBe(6);
    expect(profile.venus.market.supplySelector).toBe("0xa0712d68");
    expect(profile.verification.gate0FullPath).toBe("passed");
    const venus = venusDeploymentFromProfile(profile);
    expect(venus.nativeVToken).toBeTruthy();
    expect(venus.underlyingDecimals).toBe(6);
  });
});
