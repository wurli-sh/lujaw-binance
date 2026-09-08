/**
 * Exact Venus `mint(uint256)` calldata for the locked supply path.
 *
 * Target is the vToken; the session never receives `approve` authority.
 * Admin creates a bounded ERC-20 allowance to the vToken separately.
 */
import { decodeAbiParameters, encodeFunctionData, getAddress, sliceHex, toEventSelector } from "viem";
import type { Address, Hex } from "viem";
import { MINT_SELECTOR, MINT_SIGNATURE, VTOKEN_ABI } from "./abis.js";

export interface MintCall {
  readonly to: Address;
  readonly data: Hex;
  readonly selector: typeof MINT_SELECTOR;
  readonly signature: typeof MINT_SIGNATURE;
  readonly amountRaw: bigint;
}

/** Venus testnet emits the post-mint account balance as a fourth field. */
export const VENUS_MINT_EVENT_TOPIC = toEventSelector(
  "Mint(address,uint256,uint256,uint256)",
);
export const ERC20_TRANSFER_EVENT_TOPIC = toEventSelector(
  "Transfer(address,address,uint256)",
);

export interface MintReceiptLog {
  readonly address: Address;
  readonly topics: readonly Hex[];
  readonly data: Hex;
  readonly logIndex?: number | null;
}

export interface VerifiedMintReceiptEffects {
  readonly vToken: Address;
  readonly underlying: Address;
  readonly minter: Address;
  readonly mintAmountRaw: string;
  readonly mintTokensRaw: string;
  readonly vTokenBalanceAfterRaw: string;
  readonly mintLogIndex: number | null;
  readonly transferLogIndex: number | null;
}

function topicAddress(topic: Hex): Address {
  if (topic.length !== 66) throw new Error(`expected 32-byte address topic, received ${topic}`);
  return getAddress(sliceHex(topic, 12, 32)).toLowerCase() as Address;
}

/**
 * Verify that a successful wrapped receipt actually produced the one expected
 * Venus mint and the corresponding underlying transfer.
 *
 * The relay transaction targets Altana's Orchestrator, so `transaction.to`
 * cannot attribute the inner action. These two contract-emitted events bind
 * the effect to the locked vToken, underlying token, wallet, and exact amount.
 */
export function verifyMintReceiptEffects(
  logs: readonly MintReceiptLog[],
  expected: {
    readonly vToken: Address;
    readonly underlying: Address;
    readonly minter: Address;
    readonly amountRaw: bigint;
  },
): VerifiedMintReceiptEffects {
  const vToken = expected.vToken.toLowerCase() as Address;
  const underlying = expected.underlying.toLowerCase() as Address;
  const minter = expected.minter.toLowerCase() as Address;

  const mintLogs = logs.filter(
    (log) =>
      log.address.toLowerCase() === vToken &&
      log.topics[0]?.toLowerCase() === VENUS_MINT_EVENT_TOPIC.toLowerCase(),
  );
  if (mintLogs.length !== 1) {
    throw new Error(`expected exactly one Mint event from ${vToken}, found ${mintLogs.length}`);
  }

  const mintLog = mintLogs[0]!;
  const [eventMinter, mintAmount, mintTokens, vTokenBalanceAfter] = decodeAbiParameters(
    [
      { type: "address" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
    ],
    mintLog.data,
  );
  if (eventMinter.toLowerCase() !== minter) {
    throw new Error(`Mint event minter ${eventMinter} does not match wallet ${minter}`);
  }
  if (mintAmount !== expected.amountRaw) {
    throw new Error(
      `Mint event amount ${mintAmount} does not match submitted amount ${expected.amountRaw}`,
    );
  }

  const transferLogs = logs.filter(
    (log) =>
      log.address.toLowerCase() === underlying &&
      log.topics[0]?.toLowerCase() === ERC20_TRANSFER_EVENT_TOPIC.toLowerCase(),
  );
  const matchingTransfers = transferLogs.filter((log) => {
    if (log.topics.length < 3) return false;
    const [amount] = decodeAbiParameters([{ type: "uint256" }], log.data);
    return (
      topicAddress(log.topics[1]!) === minter &&
      topicAddress(log.topics[2]!) === vToken &&
      amount === expected.amountRaw
    );
  });
  if (matchingTransfers.length !== 1) {
    throw new Error(
      `expected exactly one underlying transfer from ${minter} to ${vToken} for ${expected.amountRaw}, found ${matchingTransfers.length}`,
    );
  }

  const transferLog = matchingTransfers[0]!;
  return {
    vToken,
    underlying,
    minter,
    mintAmountRaw: mintAmount.toString(10),
    mintTokensRaw: mintTokens.toString(10),
    vTokenBalanceAfterRaw: vTokenBalanceAfter.toString(10),
    mintLogIndex: mintLog.logIndex ?? null,
    transferLogIndex: transferLog.logIndex ?? null,
  };
}

/** Build the exact supply call for a verified vToken market. */
export function encodeMint(vToken: Address, amountRaw: bigint): MintCall {
  if (amountRaw <= 0n) {
    throw new Error(`mint amount must be positive, received ${amountRaw}`);
  }
  const data = encodeFunctionData({
    abi: VTOKEN_ABI,
    functionName: "mint",
    args: [amountRaw],
  });
  if (!data.toLowerCase().startsWith(MINT_SELECTOR.toLowerCase())) {
    throw new Error(`encoded mint calldata does not start with ${MINT_SELECTOR}`);
  }
  return {
    to: vToken,
    data,
    selector: MINT_SELECTOR,
    signature: MINT_SIGNATURE,
    amountRaw,
  };
}
