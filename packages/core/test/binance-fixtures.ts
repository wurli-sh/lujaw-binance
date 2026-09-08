/**
 * Shared synthetic observation builders for Binance Spot core tests.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  attachObservationHash,
  type BinanceSpotObservation,
  type BinanceSpotOrderIntent,
  type BinanceSpotPolicy,
  validateSpotPolicy,
} from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../..");

export function loadMcpFixture<T = unknown>(name: string): T {
  return JSON.parse(
    readFileSync(join(repoRoot, "fixtures/binance-mcp", name), "utf8"),
  ) as T;
}

export function demoPolicy(
  overrides: Partial<{
    accountRef: string;
    maxOrderNotional: string;
    minQuoteReserve: string;
    maxDailyGrossNotional: string;
    maxAssetConcentrationBps: number;
    maxEstimatedSlippageBps: number;
    expiresAt: number;
  }> = {},
  nowSeconds = 1_700_000_000,
): BinanceSpotPolicy {
  const result = validateSpotPolicy(
    {
      accountRef: overrides.accountRef ?? "agentic-subaccount-redacted",
      preset: "demo",
      maxOrderNotional: overrides.maxOrderNotional,
      minQuoteReserve: overrides.minQuoteReserve,
      maxDailyGrossNotional: overrides.maxDailyGrossNotional,
      maxAssetConcentrationBps: overrides.maxAssetConcentrationBps,
      maxEstimatedSlippageBps: overrides.maxEstimatedSlippageBps,
    },
    nowSeconds,
  );
  if (!result.ok) throw new Error(result.message);
  if (overrides.expiresAt) {
    return { ...result.policy, expiresAt: overrides.expiresAt };
  }
  return result.policy;
}

export function baseObservation(
  overrides: Partial<BinanceSpotObservation> = {},
  observedAt = 1_700_000_000_000,
): BinanceSpotObservation {
  const exchange = loadMcpFixture<{
    status: string;
    baseAsset: string;
    quoteAsset: string;
    filters: Array<Record<string, string>>;
  }>("exchange-info-bnbusdt.json");
  const book = loadMcpFixture<{
    bids: string[][];
    asks: string[][];
  }>("book-bnbusdt.json");
  const account = loadMcpFixture<{
    accountRef: string;
    balances: Array<{ asset: string; free: string; locked: string }>;
    openOrders: [];
  }>("account.redacted.json");

  const priceFilter = exchange.filters.find((f) => f.filterType === "PRICE_FILTER")!;
  const lot = exchange.filters.find((f) => f.filterType === "LOT_SIZE")!;
  const marketLot = exchange.filters.find((f) => f.filterType === "MARKET_LOT_SIZE")!;
  const notional = exchange.filters.find((f) => f.filterType === "NOTIONAL")!;

  const observation: BinanceSpotObservation = {
    version: "lujaw.binance-spot-observation/1",
    accountRef: account.accountRef,
    observedAt,
    sources: {
      market: "fixture.exchange-info",
      account: "fixture.account",
      book: "fixture.book",
    },
    balances: account.balances,
    symbol: "BNBUSDT",
    filters: {
      status: "TRADING",
      baseAsset: exchange.baseAsset,
      quoteAsset: "USDT",
      tickSize: priceFilter.tickSize!,
      stepSize: lot.stepSize!,
      minQty: lot.minQty!,
      maxQty: lot.maxQty!,
      minNotional: notional.minNotional!,
      marketStepSize: marketLot.stepSize,
      marketMinQty: marketLot.minQty,
      marketMaxQty: marketLot.maxQty,
    },
    bestBid: book.bids[0]![0]!,
    bestAsk: book.asks[0]![0]!,
    bids: book.bids.map(([price, quantity]) => ({ price: price!, quantity: quantity! })),
    asks: book.asks.map(([price, quantity]) => ({ price: price!, quantity: quantity! })),
    openOrders: [],
    dailyExecutedNotional: "0",
    dailyReservedNotional: "0",
    ...overrides,
  };
  return attachObservationHash(observation);
}

export function marketBuyIntent(quoteOrderQty: string, requestedAt = 1_700_000_000): BinanceSpotOrderIntent {
  return {
    version: "lujaw.binance-spot-intent/1",
    symbol: "BNBUSDT",
    side: "BUY",
    type: "MARKET",
    quoteOrderQty,
    requestedAt,
  };
}
