import { describe, expect, it } from "vitest";
import { encodeFunctionData, slice } from "viem";
import { MINT_BEHALF_SELECTOR, MINT_SELECTOR, MINT_SIGNATURE, VTOKEN_ABI } from "../src/venus/abis.js";
import { encodeMint } from "../src/venus/mint.js";

const VUSDT = "0xb7526572ffe56ab9d7489838bf2e18e3323b441a" as const;

describe("encodeMint", () => {
  it("targets the vToken with mint(uint256) selector 0xa0712d68", () => {
    const amount = 1_000_000n;
    const call = encodeMint(VUSDT, amount);
    expect(call.to).toBe(VUSDT);
    expect(call.selector).toBe(MINT_SELECTOR);
    expect(call.signature).toBe(MINT_SIGNATURE);
    expect(slice(call.data, 0, 4)).toBe(MINT_SELECTOR);
    expect(call.amountRaw).toBe(amount);
  });

  it("matches encodeFunctionData for mint", () => {
    const amount = 500_000_000n;
    const call = encodeMint(VUSDT, amount);
    const expected = encodeFunctionData({
      abi: VTOKEN_ABI,
      functionName: "mint",
      args: [amount],
    });
    expect(call.data).toBe(expected);
  });

  it("never uses mintBehalf", () => {
    const call = encodeMint(VUSDT, 1n);
    expect(slice(call.data, 0, 4)).not.toBe(MINT_BEHALF_SELECTOR);
  });

  it("rejects a non-positive amount", () => {
    expect(() => encodeMint(VUSDT, 0n)).toThrow(/positive/);
  });
});
