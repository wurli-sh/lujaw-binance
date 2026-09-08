import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Address, Hex, PublicClient } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { signerFromPrivateKey } from "@altananetwork/sdk";
import { createAltanaAdapter } from "../src/altana/adapter.js";
import { loadDeployment } from "../src/deployment.js";
import type { SessionRecord } from "../src/altana/session-record.js";

const here = dirname(fileURLToPath(import.meta.url));
const deployment = loadDeployment(join(here, "..", "..", "..", "deployments", "bsc-testnet.json"));

describe("Altana adapter boundaries", () => {
  it("restores a live session only from its matching externally-held key", () => {
    const key = generatePrivateKey();
    const signer = signerFromPrivateKey(key);
    const record: SessionRecord = {
      chainId: 97,
      walletAddress: "0x4444444444444444444444444444444444444444",
      publicKey: signer.publicKey,
      keyHash: `0x${"11".repeat(32)}` as Hex,
      keyId: `0x${"22".repeat(32)}` as Hex,
      requestedPermissions: { calls: [{ to: deployment.venus.market.vToken as Address, signature: "mint(uint256)" }], spend: [] },
      expiry: 1_800_000_000,
    };
    const adapter = createAltanaAdapter({ rpcUrl: "http://localhost", publicClient: {} as PublicClient, deployment });
    expect(adapter.restoreSession(record, key).publicKey).toBe(record.publicKey);
    expect(() => adapter.restoreSession(record, generatePrivateKey())).toThrow(/does not match/);
  });

  it("rejects an unexpected receipt destination", async () => {
    const client = {
      getTransaction: async () => ({
        to: "0x9999999999999999999999999999999999999999",
        input: "0xa0712d68" as Hex,
      }),
      getTransactionReceipt: async () => ({ status: "success", logs: [] }),
    } as unknown as PublicClient;
    const adapter = createAltanaAdapter({ rpcUrl: "http://localhost", publicClient: client, deployment });
    await expect(adapter.verifyReceiptAttribution(`0x${"33".repeat(32)}` as Hex, {
      vToken: deployment.venus.market.vToken as Address,
      underlying: deployment.venus.market.underlying as Address,
      wallet: "0x4444444444444444444444444444444444444444",
      amountRaw: 1n,
    })).rejects.toThrow(/destination/);
  });
});
