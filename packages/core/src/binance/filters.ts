/**
 * Binance Spot exchange filter validation and conservative rounding.
 */
import {
  cmpScaled,
  formatScaled,
  mulScaled,
  parseScaled,
  roundDownToStep,
  roundUpToStep,
} from "./decimal.js";
import type { BinanceSpotOrderIntent } from "./schemas.js";
import type { symbolFiltersSchema } from "./schemas.js";
import type { z } from "zod";

export type SymbolFilters = z.infer<typeof symbolFiltersSchema>;

export type FilterResult =
  | { ok: true; quantity: string | null; quoteOrderQty: string | null; limitPrice: string | null }
  | { ok: false; reason: "FILTER_VIOLATION" | "INVALID_DECIMAL" | "BELOW_MIN_NOTIONAL"; detail: string };

/**
 * Normalize a market buy sized by quoteOrderQty: round quote down is not a
 * Binance filter; quantity derived from book is rounded down to step.
 * For quote-sized market buys we validate quote against minNotional and leave
 * quantity null (exchange decides).
 */
export function normalizeMarketBuyQuote(
  quoteOrderQty: string,
  filters: SymbolFilters,
): FilterResult {
  try {
    const quote = parseScaled(quoteOrderQty);
    const minNotional = parseScaled(filters.minNotional);
    if (cmpScaled(quote, minNotional) < 0) {
      return { ok: false, reason: "BELOW_MIN_NOTIONAL", detail: "quote below minNotional" };
    }
    // Quote amounts are not stepped by LOT_SIZE; keep exact parsed formatting.
    return {
      ok: true,
      quantity: null,
      quoteOrderQty: formatScaled(quote),
      limitPrice: null,
    };
  } catch (error) {
    return {
      ok: false,
      reason: "INVALID_DECIMAL",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export function normalizeLimitBuy(
  quantity: string,
  limitPrice: string,
  filters: SymbolFilters,
): FilterResult {
  try {
    const step = parseScaled(filters.stepSize);
    const tick = parseScaled(filters.tickSize);
    const minQty = parseScaled(filters.minQty);
    const maxQty = parseScaled(filters.maxQty);
    const minNotional = parseScaled(filters.minNotional);

    let qty = roundDownToStep(parseScaled(quantity), step);
    // Conservative: round price up for buys (worse for taker).
    let price = roundUpToStep(parseScaled(limitPrice), tick);

    if (cmpScaled(qty, minQty) < 0) {
      return { ok: false, reason: "FILTER_VIOLATION", detail: "quantity below minQty" };
    }
    if (cmpScaled(qty, maxQty) > 0) {
      qty = roundDownToStep(maxQty, step);
    }
    const notional = mulScaled(qty, price);
    if (cmpScaled(notional, minNotional) < 0) {
      return { ok: false, reason: "BELOW_MIN_NOTIONAL", detail: "notional below minNotional" };
    }
    return {
      ok: true,
      quantity: formatScaled(qty),
      quoteOrderQty: null,
      limitPrice: formatScaled(price),
    };
  } catch (error) {
    return {
      ok: false,
      reason: "INVALID_DECIMAL",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export function clampQuoteToMax(
  quoteOrderQty: string,
  maxQuote: string,
  filters: SymbolFilters,
): FilterResult {
  try {
    const quote = parseScaled(quoteOrderQty);
    const max = parseScaled(maxQuote);
    const clamped = quote < max ? quote : max;
    return normalizeMarketBuyQuote(formatScaled(clamped), filters);
  } catch (error) {
    return {
      ok: false,
      reason: "INVALID_DECIMAL",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export function assertIntentPassesFilters(
  intent: BinanceSpotOrderIntent,
  filters: SymbolFilters,
): FilterResult {
  if (intent.type === "MARKET" && intent.side === "BUY" && intent.quoteOrderQty) {
    return normalizeMarketBuyQuote(intent.quoteOrderQty, filters);
  }
  if (intent.type === "LIMIT" && intent.quantity && intent.limitPrice) {
    return normalizeLimitBuy(intent.quantity, intent.limitPrice, filters);
  }
  return {
    ok: false,
    reason: "FILTER_VIOLATION",
    detail: "unsupported sizing mode for filter normalization",
  };
}
