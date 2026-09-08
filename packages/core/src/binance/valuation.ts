/**
 * Portfolio valuation, reserve, concentration, and coverage checks.
 */
import {
  addScaled,
  applyBpsUp,
  cmpScaled,
  formatScaled,
  mulScaled,
  parseScaled,
  subScaled,
} from "./decimal.js";
import type { BinanceSpotObservation, BinanceSpotPolicy } from "./schemas.js";

export type ValuationResult =
  | {
      ok: true;
      totalReportedScaled: bigint;
      totalValuedScaled: bigint;
      coverageBps: number;
      quoteFreeScaled: bigint;
      baseFreeScaled: bigint;
      baseValueBidScaled: bigint;
      usdtValueScaled: bigint;
    }
  | { ok: false; reason: "OBSERVATION_INCOMPLETE" | "INVALID_DECIMAL" | "VALUATION_COVERAGE_LOW"; detail: string };

function findBalance(observation: BinanceSpotObservation, asset: string) {
  return observation.balances.find((b) => b.asset === asset);
}

/**
 * Value USDT at 1. Value base at best bid. Fail closed if material non-USDT /
 * non-base assets appear without prices.
 */
export function valuePortfolio(observation: BinanceSpotObservation, policy: BinanceSpotPolicy): ValuationResult {
  try {
    const baseAsset = observation.filters.baseAsset;
    const quoteAsset = policy.quoteAsset;
    let totalReported = 0n;
    let totalValued = 0n;
    let quoteFree = 0n;
    let baseFree = 0n;
    let usdtValue = 0n;
    let baseValueBid = 0n;
    const bestBid = parseScaled(observation.bestBid);

    for (const bal of observation.balances) {
      const free = parseScaled(bal.free);
      const locked = parseScaled(bal.locked);
      const total = addScaled(free, locked);
      if (total === 0n) continue;
      totalReported = addScaled(totalReported, total);

      if (bal.asset === quoteAsset) {
        // USDT valued 1:1 — but free/locked are in USDT units; add as-is.
        totalValued = addScaled(totalValued, total);
        usdtValue = addScaled(usdtValue, total);
        quoteFree = free;
      } else if (bal.asset === baseAsset) {
        const value = mulScaled(total, bestBid);
        totalValued = addScaled(totalValued, value);
        baseValueBid = value;
        baseFree = free;
        // reported total for coverage denominator: use quote-equivalent for base
        // Spec: coverage = valued / total reported assets.
        // For mixed units we convert base to quote for both sides.
        totalReported = subScaled(totalReported, total);
        totalReported = addScaled(totalReported, value);
      } else {
        return {
          ok: false,
          reason: "OBSERVATION_INCOMPLETE",
          detail: `unpriced asset ${bal.asset}`,
        };
      }
    }

    if (totalReported === 0n) {
      return {
        ok: true,
        totalReportedScaled: 0n,
        totalValuedScaled: 0n,
        coverageBps: 10_000,
        quoteFreeScaled: quoteFree,
        baseFreeScaled: baseFree,
        baseValueBidScaled: baseValueBid,
        usdtValueScaled: usdtValue,
      };
    }

    const coverageBps = Number((totalValued * 10_000n) / totalReported);
    if (coverageBps < policy.minValuationCoverageBps) {
      return {
        ok: false,
        reason: "VALUATION_COVERAGE_LOW",
        detail: `coverage ${coverageBps} < ${policy.minValuationCoverageBps}`,
      };
    }

    return {
      ok: true,
      totalReportedScaled: totalReported,
      totalValuedScaled: totalValued,
      coverageBps,
      quoteFreeScaled: quoteFree,
      baseFreeScaled: baseFree,
      baseValueBidScaled: baseValueBid,
      usdtValueScaled: usdtValue,
    };
  } catch (error) {
    return {
      ok: false,
      reason: "INVALID_DECIMAL",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export function spendableQuoteAfterReserve(
  quoteFreeScaled: bigint,
  policy: BinanceSpotPolicy,
): { ok: true; spendable: bigint; feeBuffer: bigint } | { ok: false; reason: "MIN_RESERVE_BINDING" | "INSUFFICIENT_BALANCE" } {
  const reserve = parseScaled(policy.minQuoteReserve);
  if (cmpScaled(quoteFreeScaled, reserve) <= 0) {
    return { ok: false, reason: "MIN_RESERVE_BINDING" };
  }
  const afterReserve = subScaled(quoteFreeScaled, reserve);
  // Fee buffer reserved from spendable (ceil).
  const feeBuffer = applyBpsUp(afterReserve, policy.feeBufferBps);
  if (cmpScaled(afterReserve, feeBuffer) <= 0) {
    return { ok: false, reason: "INSUFFICIENT_BALANCE" };
  }
  return { ok: true, spendable: subScaled(afterReserve, feeBuffer), feeBuffer };
}

/**
 * Post-buy concentration of base (valued at conservative bid/fill) as bps of
 * total portfolio value after trade.
 */
export function concentrationAfterBuyBps(input: {
  currentBaseValueBid: bigint;
  currentUsdtValue: bigint;
  buyNotional: bigint;
  estimatedBaseAcquiredValueAtBid: bigint;
}): number {
  const postBase = addScaled(input.currentBaseValueBid, input.estimatedBaseAcquiredValueAtBid);
  const postUsdt = input.currentUsdtValue > input.buyNotional
    ? subScaled(input.currentUsdtValue, input.buyNotional)
    : 0n;
  const postTotal = addScaled(postBase, postUsdt);
  if (postTotal === 0n) return 0;
  return Number((postBase * 10_000n) / postTotal);
}

export function maxBuyForConcentration(input: {
  currentBaseValueBid: bigint;
  currentUsdtValue: bigint;
  maxConcentrationBps: number;
  /** Approximate: acquired base valued at bid ≈ notional * bid/ask; use notional as conservative upper value. */
}): bigint {
  // Solve for N such that (base + N) / (total) <= maxBps/10000
  // postBase = base + N (value), postUsdt = usdt - N, postTotal = base + usdt
  // (base + N) / (base + usdt) <= c
  // base + N <= c * total
  // N <= c*total - base
  const total = addScaled(input.currentBaseValueBid, input.currentUsdtValue);
  const cap = (total * BigInt(input.maxConcentrationBps)) / 10_000n;
  if (cap <= input.currentBaseValueBid) return 0n;
  return subScaled(cap, input.currentBaseValueBid);
}

export function formatValuationCoverage(coverageBps: number): string {
  return formatScaled(parseScaled(String(coverageBps)));
}

export function balanceFree(observation: BinanceSpotObservation, asset: string): bigint {
  const bal = findBalance(observation, asset);
  return bal ? parseScaled(bal.free) : 0n;
}
