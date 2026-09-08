/**
 * Binance Spot policy validation, presets, and canonical hashing.
 */
import type { Hex } from "viem";
import { canonicalHash } from "../episode/canonical.js";
import { parseScaled, formatScaled } from "./decimal.js";
import {
  binanceSpotPolicySchema,
  type BinanceSpotPolicy,
} from "./schemas.js";

export const MAX_POLICY_DURATION_SECONDS = 24 * 60 * 60;
export const MAX_AUTHORIZATION_TTL_SECONDS = 60;
export const MIN_FEE_BUFFER_BPS = 10;

export type SpotPolicyDraft = {
  accountRef: string;
  allowedSymbols?: string[];
  allowedSides?: Array<"BUY" | "SELL">;
  allowedOrderTypes?: Array<"MARKET" | "LIMIT">;
  maxOrderNotional?: string;
  minQuoteReserve?: string;
  maxAssetConcentrationBps?: number;
  maxEstimatedSlippageBps?: number;
  maxDailyGrossNotional?: string;
  feeBufferBps?: number;
  minValuationCoverageBps?: number;
  authorizationTtlSeconds?: number;
  durationSeconds?: number;
  preset?: "demo" | "custom";
};

export type SpotPolicyValidationResult =
  | { ok: true; policy: BinanceSpotPolicy; policyHash: Hex; disclosures: string[] }
  | { ok: false; code: "HARD_BOUND_VIOLATION" | "DRAFT_INVALID"; message: string; disclosures: string[] };

export const DEMO_SPOT_PRESET_DEFAULTS = {
  allowedSymbols: ["BNBUSDT"] as const,
  allowedSides: ["BUY"] as const,
  allowedOrderTypes: ["MARKET"] as const,
  maxOrderNotional: "25",
  minQuoteReserve: "5",
  maxAssetConcentrationBps: 5_000,
  maxEstimatedSlippageBps: 50,
  maxDailyGrossNotional: "50",
  feeBufferBps: 20,
  minValuationCoverageBps: 9_900,
  authorizationTtlSeconds: 60,
  durationSeconds: 24 * 60 * 60,
};

export function validateSpotPolicy(
  draft: SpotPolicyDraft,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): SpotPolicyValidationResult {
  const disclosures: string[] = [
    "quoteAsset locked to USDT",
    "maxActions locked to 1",
    `authorizationTtlSeconds max ${MAX_AUTHORIZATION_TTL_SECONDS}`,
    `policy duration max ${MAX_POLICY_DURATION_SECONDS}s`,
    `feeBufferBps min ${MIN_FEE_BUFFER_BPS}`,
  ];

  const preset = draft.preset === "demo" || draft.preset === undefined
    ? DEMO_SPOT_PRESET_DEFAULTS
    : null;

  const durationSeconds = draft.durationSeconds ?? preset?.durationSeconds ?? MAX_POLICY_DURATION_SECONDS;
  if (durationSeconds > MAX_POLICY_DURATION_SECONDS || durationSeconds < 1) {
    return {
      ok: false,
      code: "HARD_BOUND_VIOLATION",
      message: `durationSeconds must be 1..${MAX_POLICY_DURATION_SECONDS}`,
      disclosures,
    };
  }

  const ttl = draft.authorizationTtlSeconds ?? preset?.authorizationTtlSeconds ?? MAX_AUTHORIZATION_TTL_SECONDS;
  if (ttl > MAX_AUTHORIZATION_TTL_SECONDS || ttl < 1) {
    return {
      ok: false,
      code: "HARD_BOUND_VIOLATION",
      message: `authorizationTtlSeconds must be 1..${MAX_AUTHORIZATION_TTL_SECONDS}`,
      disclosures,
    };
  }

  const feeBufferBps = draft.feeBufferBps ?? preset?.feeBufferBps ?? MIN_FEE_BUFFER_BPS;
  if (feeBufferBps < MIN_FEE_BUFFER_BPS) {
    return {
      ok: false,
      code: "HARD_BOUND_VIOLATION",
      message: `feeBufferBps must be >= ${MIN_FEE_BUFFER_BPS}`,
      disclosures,
    };
  }

  const candidate = {
    version: "lujaw.binance-spot-policy/1" as const,
    venue: "binance" as const,
    product: "SPOT" as const,
    accountRef: draft.accountRef,
    quoteAsset: "USDT" as const,
    allowedSymbols: [...(draft.allowedSymbols ?? preset?.allowedSymbols ?? ["BNBUSDT"])],
    allowedSides: [...(draft.allowedSides ?? preset?.allowedSides ?? ["BUY"])] as Array<"BUY" | "SELL">,
    allowedOrderTypes: [...(draft.allowedOrderTypes ?? preset?.allowedOrderTypes ?? ["MARKET"])] as Array<"MARKET" | "LIMIT">,
    maxOrderNotional: draft.maxOrderNotional ?? preset?.maxOrderNotional ?? "25",
    minQuoteReserve: draft.minQuoteReserve ?? preset?.minQuoteReserve ?? "5",
    maxAssetConcentrationBps:
      draft.maxAssetConcentrationBps ?? preset?.maxAssetConcentrationBps ?? 5_000,
    maxEstimatedSlippageBps:
      draft.maxEstimatedSlippageBps ?? preset?.maxEstimatedSlippageBps ?? 50,
    maxDailyGrossNotional:
      draft.maxDailyGrossNotional ?? preset?.maxDailyGrossNotional ?? "50",
    feeBufferBps,
    minValuationCoverageBps:
      draft.minValuationCoverageBps ?? preset?.minValuationCoverageBps ?? 9_900,
    authorizationTtlSeconds: ttl,
    maxActions: 1 as const,
    expiresAt: nowSeconds + durationSeconds,
  };

  // Normalize decimal formatting.
  try {
    candidate.maxOrderNotional = formatScaled(parseScaled(candidate.maxOrderNotional));
    candidate.minQuoteReserve = formatScaled(parseScaled(candidate.minQuoteReserve));
    candidate.maxDailyGrossNotional = formatScaled(parseScaled(candidate.maxDailyGrossNotional));
  } catch (error) {
    return {
      ok: false,
      code: "DRAFT_INVALID",
      message: error instanceof Error ? error.message : String(error),
      disclosures,
    };
  }

  const parsed = binanceSpotPolicySchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      code: "DRAFT_INVALID",
      message: parsed.error.issues.map((i) => i.message).join("; "),
      disclosures,
    };
  }

  const policyHash = canonicalSpotPolicyHash(parsed.data);
  return { ok: true, policy: parsed.data, policyHash, disclosures };
}

export function canonicalSpotPolicyHash(policy: BinanceSpotPolicy): Hex {
  return canonicalHash({
    version: policy.version,
    venue: policy.venue,
    product: policy.product,
    accountRef: policy.accountRef,
    quoteAsset: policy.quoteAsset,
    allowedSymbols: [...policy.allowedSymbols].map((s) => s.toUpperCase()).sort(),
    allowedSides: [...policy.allowedSides].sort(),
    allowedOrderTypes: [...policy.allowedOrderTypes].sort(),
    maxOrderNotional: policy.maxOrderNotional,
    minQuoteReserve: policy.minQuoteReserve,
    maxAssetConcentrationBps: policy.maxAssetConcentrationBps,
    maxEstimatedSlippageBps: policy.maxEstimatedSlippageBps,
    maxDailyGrossNotional: policy.maxDailyGrossNotional,
    feeBufferBps: policy.feeBufferBps,
    minValuationCoverageBps: policy.minValuationCoverageBps,
    authorizationTtlSeconds: policy.authorizationTtlSeconds,
    maxActions: policy.maxActions,
    expiresAt: policy.expiresAt,
  });
}

export function isPolicyActive(policy: BinanceSpotPolicy, nowSeconds: number): boolean {
  return nowSeconds < policy.expiresAt;
}
