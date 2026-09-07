/**
 * Exact Venus `mint(uint256)` calldata for the locked supply path.
 *
 * Target is the vToken; the session never receives `approve` authority.
 * Admin creates a bounded ERC-20 allowance to the vToken separately.
 */
import { encodeFunctionData } from "viem";
import type { Address, Hex } from "viem";
import { MINT_SELECTOR, MINT_SIGNATURE, VTOKEN_ABI } from "./abis.js";

export interface MintCall {
  readonly to: Address;
  readonly data: Hex;
  readonly selector: typeof MINT_SELECTOR;
  readonly signature: typeof MINT_SIGNATURE;
  readonly amountRaw: bigint;
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
