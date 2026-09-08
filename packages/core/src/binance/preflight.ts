/**
 * Deterministic Binance Spot preflight decision engine.
 */
import type { Hex } from "viem";
import { canonicalHash } from "../episode/canonical.js";
import {
  addScaled,
  cmpScaled,
  formatScaled,
  minScaled,
  mulScaled,
  parseScaled,
  subScaled,
} from "./decimal.js";
import { normalizeMarketBuyQuote } from "./filters.js";
import { maxQuoteWithinSlippage, walkAsksForQuote } from "./orderbook.js";
import { canonicalSpotPolicyHash, isPolicyActive } from "./policy.js";
import type { BinanceReasonCode } from "./reason-codes.js";
import {
  binanceSpotObservationSchema,
  binanceSpotOrderIntentSchema,
  type BinanceSpotObservation,
  type BinanceSpotOrderIntent,
  type BinanceSpotPolicy,
  type BinanceSpotPreflight,
} from "./schemas.js";
import {
  concentrationAfterBuyBps,
  maxBuyForConcentration,
  spendableQuoteAfterReserve,
  valuePortfolio,
} from "./valuation.js";

export const DEFAULT_MARKET_FRESHNESS_MS = 5_000;
export const DEFAULT_PREFLIGHT_TTL_SECONDS = 60;

export type PreflightInput = {
  policy: BinanceSpotPolicy;
  observation: BinanceSpotObservation;
  intent: BinanceSpotOrderIntent;
  nowMs?: number;
  marketFreshnessMs?: number;
  preflightTtlSeconds?: number;
};

function hashObservation(observation: BinanceSpotObservation): Hex {
  const { observationHash: _omit, ...rest } = observation;
  return canonicalHash(rest);
}

function hashPreflightBody(body: Omit<BinanceSpotPreflight, "preflightHash">): Hex {
  return canonicalHash(body);
}

export function attachObservationHash(observation: BinanceSpotObservation): BinanceSpotObservation {
  const observationHash = hashObservation(observation);
  return { ...observation, observationHash };
}

export function runSpotPreflight(input: PreflightInput): BinanceSpotPreflight {
  const nowMs = input.nowMs ?? Date.now();
  const nowSeconds = Math.floor(nowMs / 1000);
  const freshnessMs = input.marketFreshnessMs ?? DEFAULT_MARKET_FRESHNESS_MS;
  const ttl = input.preflightTtlSeconds ?? DEFAULT_PREFLIGHT_TTL_SECONDS;
  const reasons: BinanceReasonCode[] = [];

  const policyHash = canonicalSpotPolicyHash(input.policy);
  let observation = input.observation;
  const obsParse = binanceSpotObservationSchema.safeParse(observation);
  const intentParse = binanceSpotOrderIntentSchema.safeParse(input.intent);

  const emptyCalcs = {
    requestedNotional: "0",
    authorizedNotional: "0",
    dailyRemaining: "0",
    quoteReserveAfter: null as string | null,
    concentrationAfterBps: null as number | null,
    estimatedSlippageBps: null as number | null,
    valuationCoverageBps: 0,
  };

  const finish = (
    decision: BinanceSpotPreflight["decision"],
    calcs: typeof emptyCalcs,
    authorizedOrder: BinanceSpotOrderIntent | null,
  ): BinanceSpotPreflight => {
    observation = attachObservationHash(observation);
    const body: Omit<BinanceSpotPreflight, "preflightHash"> = {
      version: "lujaw.binance-spot-preflight/1",
      policyHash,
      observationHash: observation.observationHash!,
      decision,
      requestedOrder: input.intent,
      authorizedOrder,
      calculations: calcs,
      reasons: [...reasons],
      expiresAt: nowSeconds + ttl,
    };
    return { ...body, preflightHash: hashPreflightBody(body) };
  };

  if (!obsParse.success || !intentParse.success) {
    reasons.push("OBSERVATION_INCOMPLETE");
    return finish("INCONCLUSIVE", emptyCalcs, null);
  }
  observation = obsParse.data;
  const intent = intentParse.data;

  if (!isPolicyActive(input.policy, nowSeconds)) {
    reasons.push("POLICY_EXPIRED");
    return finish("BLOCK", emptyCalcs, null);
  }
  if (observation.accountRef !== input.policy.accountRef) {
    reasons.push("ACCOUNT_MISMATCH");
    return finish("BLOCK", emptyCalcs, null);
  }
  if (input.policy.product !== "SPOT") {
    reasons.push("PRODUCT_NOT_ALLOWED");
    return finish("BLOCK", emptyCalcs, null);
  }
  if (input.policy.quoteAsset !== "USDT" || observation.filters.quoteAsset !== "USDT") {
    reasons.push("QUOTE_ASSET_NOT_ALLOWED");
    return finish("BLOCK", emptyCalcs, null);
  }
  if (!input.policy.allowedSymbols.map((s) => s.toUpperCase()).includes(intent.symbol.toUpperCase())) {
    reasons.push("SYMBOL_NOT_ALLOWED");
    return finish("BLOCK", emptyCalcs, null);
  }
  if (observation.symbol.toUpperCase() !== intent.symbol.toUpperCase()) {
    reasons.push("OBSERVATION_INCOMPLETE");
    return finish("INCONCLUSIVE", emptyCalcs, null);
  }
  if (!input.policy.allowedSides.includes(intent.side)) {
    reasons.push("SIDE_NOT_ALLOWED");
    return finish("BLOCK", emptyCalcs, null);
  }
  if (!input.policy.allowedOrderTypes.includes(intent.type)) {
    reasons.push("ORDER_TYPE_NOT_ALLOWED");
    return finish("BLOCK", emptyCalcs, null);
  }
  if (observation.filters.status !== "TRADING") {
    reasons.push("SYMBOL_NOT_TRADING");
    return finish("BLOCK", emptyCalcs, null);
  }
  if (nowMs - observation.observedAt > freshnessMs || observation.observedAt > nowMs + 1_000) {
    reasons.push("OBSERVATION_STALE");
    return finish("INCONCLUSIVE", emptyCalcs, null);
  }

  // Demo path: MARKET BUY with quoteOrderQty only.
  if (!(intent.side === "BUY" && intent.type === "MARKET" && intent.quoteOrderQty && !intent.quantity)) {
    reasons.push("SIZING_MODE_INVALID");
    return finish("BLOCK", emptyCalcs, null);
  }

  let requestedNotional: bigint;
  try {
    requestedNotional = parseScaled(intent.quoteOrderQty);
  } catch {
    reasons.push("INVALID_DECIMAL");
    return finish("INCONCLUSIVE", emptyCalcs, null);
  }

  const valuation = valuePortfolio(observation, input.policy);
  if (!valuation.ok) {
    reasons.push(valuation.reason);
    return finish(
      valuation.reason === "VALUATION_COVERAGE_LOW" ? "BLOCK" : "INCONCLUSIVE",
      { ...emptyCalcs, requestedNotional: formatScaled(requestedNotional) },
      null,
    );
  }

  const spendable = spendableQuoteAfterReserve(valuation.quoteFreeScaled, input.policy);
  if (!spendable.ok) {
    reasons.push(spendable.reason);
    return finish("BLOCK", {
      ...emptyCalcs,
      requestedNotional: formatScaled(requestedNotional),
      valuationCoverageBps: valuation.coverageBps,
    }, null);
  }

  const dailyExecuted = parseScaled(observation.dailyExecutedNotional);
  const dailyReserved = parseScaled(observation.dailyReservedNotional);
  const dailyLimit = parseScaled(input.policy.maxDailyGrossNotional);
  const dailyUsed = addScaled(dailyExecuted, dailyReserved);
  const dailyRemaining = dailyUsed >= dailyLimit ? 0n : subScaled(dailyLimit, dailyUsed);
  const maxOrder = parseScaled(input.policy.maxOrderNotional);

  let maxSafe = minScaled(
    requestedNotional,
    maxOrder,
    dailyRemaining,
    spendable.spendable,
  );

  const concHeadroom = maxBuyForConcentration({
    currentBaseValueBid: valuation.baseValueBidScaled,
    currentUsdtValue: valuation.usdtValueScaled,
    maxConcentrationBps: input.policy.maxAssetConcentrationBps,
  });
  maxSafe = minScaled(maxSafe, concHeadroom);

  // Track which constraints bind when reduced or blocked.
  if (cmpScaled(maxSafe, requestedNotional) < 0) {
    if (cmpScaled(maxOrder, requestedNotional) < 0) {
      reasons.push("MAX_ORDER_NOTIONAL_BINDING");
    }
    if (cmpScaled(dailyRemaining, requestedNotional) < 0) {
      reasons.push("DAILY_BUDGET_BINDING");
    }
    if (cmpScaled(spendable.spendable, requestedNotional) < 0) {
      reasons.push("MIN_RESERVE_BINDING");
    }
    if (cmpScaled(concHeadroom, requestedNotional) < 0) {
      reasons.push("CONCENTRATION_BINDING");
    }
  }

  if (maxSafe <= 0n) {
    if (reasons.length === 0) reasons.push("INSUFFICIENT_BALANCE");
    return finish("BLOCK", {
      requestedNotional: formatScaled(requestedNotional),
      authorizedNotional: "0",
      dailyRemaining: formatScaled(dailyRemaining),
      quoteReserveAfter: formatScaled(valuation.quoteFreeScaled),
      concentrationAfterBps: null,
      estimatedSlippageBps: null,
      valuationCoverageBps: valuation.coverageBps,
    }, null);
  }

  const slip = maxQuoteWithinSlippage(
    observation.asks,
    formatScaled(maxSafe),
    input.policy.maxEstimatedSlippageBps,
  );
  if (!slip.ok || !slip.maxCompliantQuote) {
    reasons.push(slip.ok === false && slip.reason === "INVALID_DECIMAL" ? "INVALID_DECIMAL" : "INSUFFICIENT_BOOK_DEPTH");
    return finish("INCONCLUSIVE", {
      requestedNotional: formatScaled(requestedNotional),
      authorizedNotional: "0",
      dailyRemaining: formatScaled(dailyRemaining),
      quoteReserveAfter: null,
      concentrationAfterBps: null,
      estimatedSlippageBps: null,
      valuationCoverageBps: valuation.coverageBps,
    }, null);
  }
  if (cmpScaled(parseScaled(slip.maxCompliantQuote), requestedNotional) < 0) {
    reasons.push("SLIPPAGE_BINDING");
  }
  maxSafe = minScaled(maxSafe, parseScaled(slip.maxCompliantQuote));

  if (maxSafe <= 0n) {
    if (!reasons.includes("SLIPPAGE_BINDING")) reasons.push("SLIPPAGE_BINDING");
    return finish("BLOCK", {
      requestedNotional: formatScaled(requestedNotional),
      authorizedNotional: "0",
      dailyRemaining: formatScaled(dailyRemaining),
      quoteReserveAfter: formatScaled(valuation.quoteFreeScaled),
      concentrationAfterBps: null,
      estimatedSlippageBps: null,
      valuationCoverageBps: valuation.coverageBps,
    }, null);
  }

  const normalized = normalizeMarketBuyQuote(formatScaled(maxSafe), observation.filters);
  if (!normalized.ok) {
    reasons.push(normalized.reason);
    return finish(normalized.reason === "BELOW_MIN_NOTIONAL" ? "BLOCK" : "INCONCLUSIVE", {
      requestedNotional: formatScaled(requestedNotional),
      authorizedNotional: "0",
      dailyRemaining: formatScaled(dailyRemaining),
      quoteReserveAfter: null,
      concentrationAfterBps: null,
      estimatedSlippageBps: null,
      valuationCoverageBps: valuation.coverageBps,
    }, null);
  }

  const authorizedNotional = parseScaled(normalized.quoteOrderQty!);
  if (cmpScaled(authorizedNotional, parseScaled(observation.filters.minNotional)) < 0) {
    reasons.push("BELOW_MIN_NOTIONAL");
    return finish("BLOCK", {
      requestedNotional: formatScaled(requestedNotional),
      authorizedNotional: "0",
      dailyRemaining: formatScaled(dailyRemaining),
      quoteReserveAfter: null,
      concentrationAfterBps: null,
      estimatedSlippageBps: null,
      valuationCoverageBps: valuation.coverageBps,
    }, null);
  }

  const walk = walkAsksForQuote(observation.asks, formatScaled(authorizedNotional));
  if (!walk.ok) {
    reasons.push("INSUFFICIENT_BOOK_DEPTH");
    return finish("INCONCLUSIVE", {
      requestedNotional: formatScaled(requestedNotional),
      authorizedNotional: "0",
      dailyRemaining: formatScaled(dailyRemaining),
      quoteReserveAfter: null,
      concentrationAfterBps: null,
      estimatedSlippageBps: null,
      valuationCoverageBps: valuation.coverageBps,
    }, null);
  }

  const estimatedBaseAtBid = mulScaled(parseScaled(walk.filledBase), parseScaled(observation.bestBid));
  const concAfter = concentrationAfterBuyBps({
    currentBaseValueBid: valuation.baseValueBidScaled,
    currentUsdtValue: valuation.usdtValueScaled,
    buyNotional: authorizedNotional,
    estimatedBaseAcquiredValueAtBid: estimatedBaseAtBid,
  });
  if (concAfter > input.policy.maxAssetConcentrationBps) {
    reasons.push("CONCENTRATION_BINDING");
    return finish("BLOCK", {
      requestedNotional: formatScaled(requestedNotional),
      authorizedNotional: "0",
      dailyRemaining: formatScaled(dailyRemaining),
      quoteReserveAfter: null,
      concentrationAfterBps: concAfter,
      estimatedSlippageBps: walk.slippageBps,
      valuationCoverageBps: valuation.coverageBps,
    }, null);
  }

  const authorizedOrder: BinanceSpotOrderIntent = {
    version: "lujaw.binance-spot-intent/1",
    symbol: intent.symbol.toUpperCase(),
    side: "BUY",
    type: "MARKET",
    quoteOrderQty: normalized.quoteOrderQty!,
    requestedAt: intent.requestedAt,
  };

  const quoteReserveAfter = formatScaled(
    subScaled(valuation.quoteFreeScaled, authorizedNotional),
  );

  const calcs = {
    requestedNotional: formatScaled(requestedNotional),
    authorizedNotional: formatScaled(authorizedNotional),
    dailyRemaining: formatScaled(dailyRemaining),
    quoteReserveAfter,
    concentrationAfterBps: concAfter,
    estimatedSlippageBps: walk.slippageBps,
    valuationCoverageBps: valuation.coverageBps,
  };

  const decision =
    cmpScaled(authorizedNotional, requestedNotional) === 0 ? "ALLOW" : "REDUCE";
  if (decision === "ALLOW" && reasons.length === 0) {
    // no binding reasons
  }
  return finish(decision, calcs, authorizedOrder);
}
