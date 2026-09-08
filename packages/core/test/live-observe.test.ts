import { describe, expect, it } from "vitest";
import { createPublicClient, http } from "viem";
import { bscTestnet } from "viem/chains";
import { VENUS_BSC_TESTNET, observeAccount, reconstruct, formatMantissa } from "../src/index.js";

/**
 * Opt-in live read. Skipped unless LUJAW_LIVE=1.
 * Does not spend funds or require keys.
 */
describe("live Venus observe (opt-in)", () => {
  const enabled = process.env.LUJAW_LIVE === "1";

  it.skipIf(!enabled)("reconstructs the fixture account on current head", async () => {
    const client = createPublicClient({
      chain: bscTestnet,
      transport: http(process.env.BSC_TESTNET_RPC_URL ?? "https://bsc-testnet-rpc.publicnode.com"),
    });
    const account = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
    const observation = await observeAccount(client, VENUS_BSC_TESTNET, account);
    const health = reconstruct(observation);
    expect(health.unpriced).toHaveLength(0);
    expect(health.totalBorrowUsd).toBeGreaterThan(0n);
    expect(health.healthFactorMantissa).not.toBeNull();
    expect(formatMantissa(health.healthFactorMantissa!)).toMatch(/^2\./);
  }, 60_000);
});
