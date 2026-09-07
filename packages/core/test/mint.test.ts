import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeFunctionData, padHex, slice } from "viem";
import { MINT_BEHALF_SELECTOR, MINT_SELECTOR, MINT_SIGNATURE, VTOKEN_ABI } from "../src/venus/abis.js";
import {
  ERC20_TRANSFER_EVENT_TOPIC,
  VENUS_MINT_EVENT_TOPIC,
  encodeMint,
  verifyMintReceiptEffects,
} from "../src/venus/mint.js";

const VUSDT = "0xb7526572ffe56ab9d7489838bf2e18e3323b441a" as const;
const USDT = "0xa11c8d9dc9b66e209ef60f0c8d969d3cd988782c" as const;
const WALLET = "0x658d1744c94c743e7f759be8a2943a044cbc440b" as const;

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

describe("verifyMintReceiptEffects", () => {
  const amount = 1_000_000n;
  const logs = [
    {
      address: USDT,
      topics: [
        ERC20_TRANSFER_EVENT_TOPIC,
        padHex(WALLET, { size: 32 }),
        padHex(VUSDT, { size: 32 }),
      ],
      data: encodeAbiParameters([{ type: "uint256" }], [amount]),
      logIndex: 3,
    },
    {
      address: VUSDT,
      topics: [VENUS_MINT_EVENT_TOPIC],
      data: encodeAbiParameters(
        [
          { type: "address" },
          { type: "uint256" },
          { type: "uint256" },
          { type: "uint256" },
        ],
        [WALLET, amount, 4_980_663_521n, 403_433_745_274n],
      ),
      logIndex: 4,
    },
  ] as const;

  it("binds a wrapped receipt to the expected vToken, wallet, and amount", () => {
    expect(
      verifyMintReceiptEffects(logs, {
        vToken: VUSDT,
        underlying: USDT,
        minter: WALLET,
        amountRaw: amount,
      }),
    ).toEqual({
      vToken: VUSDT,
      underlying: USDT,
      minter: WALLET,
      mintAmountRaw: "1000000",
      mintTokensRaw: "4980663521",
      vTokenBalanceAfterRaw: "403433745274",
      mintLogIndex: 4,
      transferLogIndex: 3,
    });
  });

  it("fails when the emitted mint amount differs", () => {
    expect(() =>
      verifyMintReceiptEffects(logs, {
        vToken: VUSDT,
        underlying: USDT,
        minter: WALLET,
        amountRaw: amount + 1n,
      }),
    ).toThrow(/does not match submitted amount/);
  });

  it("fails without the matching underlying transfer", () => {
    expect(() =>
      verifyMintReceiptEffects(logs.slice(1), {
        vToken: VUSDT,
        underlying: USDT,
        minter: WALLET,
        amountRaw: amount,
      }),
    ).toThrow(/underlying transfer/);
  });
});
