/**
 * Normalize host-supplied / fixture Binance Spot observations into core schemas.
 * Live MCP field paths must be revalidated after Phase 0 discovery refresh.
 */
import {
  attachObservationHash,
  type BinanceSpotObservation,
} from "@lujaw-binance/core";
import { z } from "zod";

const rawBalanceSchema = z.object({
  asset: z.string(),
  free: z.union([z.string(), z.number()]),
  locked: z.union([z.string(), z.number()]).optional(),
}).passthrough();

const rawFilterSchema = z.record(z.unknown());

function asDecimalString(value: string | number): string {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Number.isNaN(value)) {
      throw new Error("non-finite number rejected");
    }
    // Reject float coercion into policy path — require strings from host.
    throw new Error("balances and prices must be decimal strings, not JSON numbers");
  }
  return value;
}

export type NormalizeSpotObservationInput = {
  accountRef: string;
  observedAt: number;
  symbol: string;
  exchangeInfo: {
    status?: string;
    baseAsset: string;
    quoteAsset: string;
    filters: Array<Record<string, unknown>>;
  };
  book: {
    bids: Array<[string, string] | { price: string; quantity: string }>;
    asks: Array<[string, string] | { price: string; quantity: string }>;
  };
  balances: Array<{ asset: string; free: string; locked?: string }>;
  openOrders?: BinanceSpotObservation["openOrders"];
  dailyExecutedNotional?: string;
  dailyReservedNotional?: string;
  sources?: Partial<BinanceSpotObservation["sources"]>;
};

function pickFilter(
  filters: Array<Record<string, unknown>>,
  type: string,
): Record<string, unknown> {
  const found = filters.find((f) => f.filterType === type);
  if (!found) throw new Error(`missing filter ${type}`);
  return found;
}

function level(
  entry: [string, string] | { price: string; quantity: string },
): { price: string; quantity: string } {
  if (Array.isArray(entry)) {
    return { price: entry[0], quantity: entry[1] };
  }
  return { price: entry.price, quantity: entry.quantity };
}

export function normalizeSpotObservation(
  input: NormalizeSpotObservationInput,
): BinanceSpotObservation {
  if (input.exchangeInfo.quoteAsset !== "USDT") {
    throw new Error("only USDT-quoted symbols are supported");
  }
  const priceFilter = pickFilter(input.exchangeInfo.filters, "PRICE_FILTER");
  const lot = pickFilter(input.exchangeInfo.filters, "LOT_SIZE");
  const notional =
    input.exchangeInfo.filters.find((f) => f.filterType === "NOTIONAL" || f.filterType === "MIN_NOTIONAL") ??
    {};
  const marketLot = input.exchangeInfo.filters.find((f) => f.filterType === "MARKET_LOT_SIZE");

  const bids = input.book.bids.map(level);
  const asks = input.book.asks.map(level);
  if (bids.length === 0 || asks.length === 0) {
    throw new Error("order book must include bids and asks");
  }

  const minNotional =
    String(notional.minNotional ?? notional.notional ?? "0");
  // Binance may return MARKET_LOT_SIZE.stepSize as exactly "0.00000000".
  // That means no market-quantity increment is enforced, rather than an
  // invalid zero increment. Our canonical schema represents that as omitted.
  const marketStepSize = marketLot ? String(marketLot.stepSize) : undefined;
  const normalizedMarketStepSize =
    marketStepSize && /^0(?:\.0+)?$/.test(marketStepSize) ? undefined : marketStepSize;

  const observation: BinanceSpotObservation = {
    version: "lujaw.binance-spot-observation/1",
    accountRef: input.accountRef,
    observedAt: input.observedAt,
    sources: {
      market: input.sources?.market ?? "binance-mcp.market-data",
      account: input.sources?.account ?? "binance-mcp.account",
      book: input.sources?.book ?? "binance-mcp.book",
    },
    balances: input.balances.map((b) => ({
      asset: b.asset,
      free: asDecimalString(b.free),
      locked: asDecimalString(b.locked ?? "0"),
    })),
    symbol: input.symbol.toUpperCase(),
    filters: {
      status: (input.exchangeInfo.status as "TRADING" | "BREAK" | "HALT" | "UNKNOWN") ?? "UNKNOWN",
      baseAsset: input.exchangeInfo.baseAsset,
      quoteAsset: "USDT",
      tickSize: String(priceFilter.tickSize),
      stepSize: String(lot.stepSize),
      minQty: String(lot.minQty),
      maxQty: String(lot.maxQty),
      minNotional,
      ...(marketLot
        ? {
            marketMinQty: String(marketLot.minQty),
            marketMaxQty: String(marketLot.maxQty),
            ...(normalizedMarketStepSize ? { marketStepSize: normalizedMarketStepSize } : {}),
          }
        : {}),
    },
    bestBid: bids[0]!.price,
    bestAsk: asks[0]!.price,
    bids,
    asks,
    openOrders: input.openOrders ?? [],
    dailyExecutedNotional: input.dailyExecutedNotional ?? "0",
    dailyReservedNotional: input.dailyReservedNotional ?? "0",
  };

  void rawBalanceSchema;
  void rawFilterSchema;
  return attachObservationHash(observation);
}

/** Accept either a normalized observation or a raw bundle. */
export function coerceObservation(
  value: unknown,
  ledger?: { executed: string; reserved: string },
): BinanceSpotObservation {
  if (
    value &&
    typeof value === "object" &&
    (value as { version?: string }).version === "lujaw.binance-spot-observation/1"
  ) {
    const obs = value as BinanceSpotObservation;
    return attachObservationHash({
      ...obs,
      dailyExecutedNotional: ledger?.executed ?? obs.dailyExecutedNotional,
      dailyReservedNotional: ledger?.reserved ?? obs.dailyReservedNotional,
    });
  }
  const raw = value as NormalizeSpotObservationInput;
  return normalizeSpotObservation({
    accountRef: raw.accountRef,
    observedAt: raw.observedAt,
    symbol: raw.symbol,
    exchangeInfo: raw.exchangeInfo,
    book: raw.book,
    balances: raw.balances,
    ...(raw.openOrders ? { openOrders: raw.openOrders } : {}),
    ...(ledger?.executed || raw.dailyExecutedNotional
      ? { dailyExecutedNotional: ledger?.executed ?? raw.dailyExecutedNotional }
      : {}),
    ...(ledger?.reserved || raw.dailyReservedNotional
      ? { dailyReservedNotional: ledger?.reserved ?? raw.dailyReservedNotional }
      : {}),
    ...(raw.sources ? { sources: raw.sources } : {}),
  });
}
