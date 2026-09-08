/**
 * Deterministic order-book walk and slippage estimation.
 */
import {
  addScaled,
  cmpScaled,
  divScaledDown,
  formatScaled,
  mulScaled,
  parseScaled,
  slippageBpsFromPrices,
  subScaled,
} from "./decimal.js";
import type { orderBookLevelSchema } from "./schemas.js";
import type { z } from "zod";

export type BookLevel = z.infer<typeof orderBookLevelSchema>;

export type DepthWalkResult =
  | {
      ok: true;
      filledQuote: string;
      filledBase: string;
      vwap: string;
      slippageBps: number;
      levelsUsed: number;
    }
  | {
      ok: false;
      reason: "INSUFFICIENT_BOOK_DEPTH" | "INVALID_DECIMAL";
      detail: string;
    };

/**
 * Walk the ask side until `quoteAmount` is filled (market buy).
 * Slippage is vs best ask.
 */
export function walkAsksForQuote(
  asks: readonly BookLevel[],
  quoteAmount: string,
): DepthWalkResult {
  try {
    if (asks.length === 0) {
      return { ok: false, reason: "INSUFFICIENT_BOOK_DEPTH", detail: "empty asks" };
    }
    const target = parseScaled(quoteAmount);
    if (target <= 0n) {
      return { ok: false, reason: "INVALID_DECIMAL", detail: "quote amount must be positive" };
    }
    const bestAsk = parseScaled(asks[0]!.price);
    let remainingQuote = target;
    let filledBase = 0n;
    let spentQuote = 0n;
    let levelsUsed = 0;

    for (const level of asks) {
      const price = parseScaled(level.price);
      const qty = parseScaled(level.quantity);
      if (price <= 0n || qty <= 0n) {
        return { ok: false, reason: "INVALID_DECIMAL", detail: "non-positive book level" };
      }
      const levelNotional = mulScaled(price, qty);
      levelsUsed += 1;
      if (cmpScaled(levelNotional, remainingQuote) >= 0) {
        const takeBase = divScaledDown(remainingQuote, price);
        filledBase = addScaled(filledBase, takeBase);
        spentQuote = addScaled(spentQuote, remainingQuote);
        remainingQuote = 0n;
        break;
      }
      filledBase = addScaled(filledBase, qty);
      spentQuote = addScaled(spentQuote, levelNotional);
      remainingQuote = subScaled(remainingQuote, levelNotional);
    }

    if (remainingQuote > 0n) {
      return {
        ok: false,
        reason: "INSUFFICIENT_BOOK_DEPTH",
        detail: `unfilled quote ${formatScaled(remainingQuote)}`,
      };
    }
    if (filledBase <= 0n) {
      return { ok: false, reason: "INSUFFICIENT_BOOK_DEPTH", detail: "zero base filled" };
    }
    const vwap = divScaledDown(spentQuote, filledBase);
    return {
      ok: true,
      filledQuote: formatScaled(spentQuote),
      filledBase: formatScaled(filledBase),
      vwap: formatScaled(vwap),
      slippageBps: slippageBpsFromPrices(vwap, bestAsk),
      levelsUsed,
    };
  } catch (error) {
    return {
      ok: false,
      reason: "INVALID_DECIMAL",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Maximum quote that can be spent while keeping estimated slippage ≤ maxBps.
 * Binary search on quote amount using the ask walk.
 */
export function maxQuoteWithinSlippage(
  asks: readonly BookLevel[],
  maxQuote: string,
  maxSlippageBps: number,
): DepthWalkResult & { maxCompliantQuote?: string } {
  try {
    const hi0 = parseScaled(maxQuote);
    if (hi0 <= 0n) {
      return { ok: false, reason: "INVALID_DECIMAL", detail: "max quote must be positive" };
    }
    const full = walkAsksForQuote(asks, formatScaled(hi0));
    if (full.ok && full.slippageBps <= maxSlippageBps) {
      return { ...full, maxCompliantQuote: formatScaled(hi0) };
    }
    if (!full.ok && full.reason === "INVALID_DECIMAL") return full;

    let lo = 0n;
    let hi = hi0;
    let best = 0n;
    let bestWalk: DepthWalkResult | null = null;
    for (let i = 0; i < 64; i++) {
      if (lo > hi) break;
      const mid = (lo + hi) / 2n;
      if (mid === 0n) {
        lo = 1n;
        continue;
      }
      const walk = walkAsksForQuote(asks, formatScaled(mid));
      if (walk.ok && walk.slippageBps <= maxSlippageBps) {
        best = mid;
        bestWalk = walk;
        lo = mid + 1n;
      } else {
        hi = mid - 1n;
      }
    }
    if (best === 0n || !bestWalk || !bestWalk.ok) {
      return {
        ok: false,
        reason: "INSUFFICIENT_BOOK_DEPTH",
        detail: "no quote amount satisfies slippage",
      };
    }
    return { ...bestWalk, maxCompliantQuote: formatScaled(best) };
  } catch (error) {
    return {
      ok: false,
      reason: "INVALID_DECIMAL",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
