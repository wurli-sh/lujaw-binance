/**
 * Strict Zod contracts for Binance Spot policy, intent, observation, preflight,
 * authorization, and episode. Money fields are decimal strings only.
 */
import { z } from "zod";
import { BINANCE_REASON_CODES } from "./reason-codes.js";

export const strictDecimalStringSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/, "must be a non-negative decimal string");

export const positiveStrictDecimalStringSchema = z
  .string()
  .regex(/^(?!0+(?:\.0+)?$)(?:0|[1-9]\d*)(?:\.\d+)?$/, "must be a positive decimal string");

export const hexHashSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

export const binanceSpotPolicySchema = z
  .object({
    version: z.literal("lujaw.binance-spot-policy/1"),
    venue: z.literal("binance"),
    product: z.literal("SPOT"),
    accountRef: z.string().min(1).max(128),
    quoteAsset: z.literal("USDT"),
    allowedSymbols: z.array(z.string().min(1)).min(1),
    allowedSides: z.array(z.enum(["BUY", "SELL"])).min(1),
    allowedOrderTypes: z.array(z.enum(["MARKET", "LIMIT"])).min(1),
    maxOrderNotional: positiveStrictDecimalStringSchema,
    minQuoteReserve: strictDecimalStringSchema,
    maxAssetConcentrationBps: z.number().int().min(1).max(10_000),
    maxEstimatedSlippageBps: z.number().int().min(1).max(500),
    maxDailyGrossNotional: positiveStrictDecimalStringSchema,
    feeBufferBps: z.number().int().min(1).max(500),
    minValuationCoverageBps: z.number().int().min(1).max(10_000),
    authorizationTtlSeconds: z.number().int().min(1).max(60),
    maxActions: z.literal(1),
    expiresAt: z.number().int().positive(),
  })
  .strict();

export type BinanceSpotPolicy = z.infer<typeof binanceSpotPolicySchema>;

export const binanceSpotOrderIntentSchema = z
  .object({
    version: z.literal("lujaw.binance-spot-intent/1"),
    symbol: z.string().min(1),
    side: z.enum(["BUY", "SELL"]),
    type: z.enum(["MARKET", "LIMIT"]),
    quoteOrderQty: positiveStrictDecimalStringSchema.optional(),
    quantity: positiveStrictDecimalStringSchema.optional(),
    limitPrice: positiveStrictDecimalStringSchema.optional(),
    requestedAt: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasQuote = value.quoteOrderQty !== undefined;
    const hasQty = value.quantity !== undefined;
    if (hasQuote === hasQty) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "exactly one of quoteOrderQty or quantity is required",
      });
    }
    if (value.type === "LIMIT" && value.limitPrice === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "LIMIT orders require limitPrice",
      });
    }
    if (value.type === "MARKET" && value.limitPrice !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "MARKET orders must not include limitPrice",
      });
    }
  });

export type BinanceSpotOrderIntent = z.infer<typeof binanceSpotOrderIntentSchema>;

export const balanceEntrySchema = z
  .object({
    asset: z.string().min(1),
    free: strictDecimalStringSchema,
    locked: strictDecimalStringSchema,
  })
  .strict();

export const orderBookLevelSchema = z
  .object({
    price: positiveStrictDecimalStringSchema,
    quantity: positiveStrictDecimalStringSchema,
  })
  .strict();

export const symbolFiltersSchema = z
  .object({
    status: z.enum(["TRADING", "BREAK", "HALT", "UNKNOWN"]),
    baseAsset: z.string().min(1),
    quoteAsset: z.literal("USDT"),
    tickSize: positiveStrictDecimalStringSchema,
    stepSize: positiveStrictDecimalStringSchema,
    minQty: strictDecimalStringSchema,
    maxQty: positiveStrictDecimalStringSchema,
    minNotional: positiveStrictDecimalStringSchema,
    marketStepSize: positiveStrictDecimalStringSchema.optional(),
    marketMinQty: strictDecimalStringSchema.optional(),
    marketMaxQty: positiveStrictDecimalStringSchema.optional(),
  })
  .strict();

export const openOrderSchema = z
  .object({
    symbol: z.string(),
    side: z.enum(["BUY", "SELL"]),
    type: z.enum(["MARKET", "LIMIT"]),
    price: strictDecimalStringSchema.nullable(),
    origQty: strictDecimalStringSchema,
    executedQty: strictDecimalStringSchema,
  })
  .strict();

export const binanceSpotObservationSchema = z
  .object({
    version: z.literal("lujaw.binance-spot-observation/1"),
    accountRef: z.string().min(1),
    observedAt: z.number().int().nonnegative(),
    sources: z.object({
      market: z.string().min(1),
      account: z.string().min(1),
      book: z.string().min(1),
    }).strict(),
    balances: z.array(balanceEntrySchema),
    symbol: z.string().min(1),
    filters: symbolFiltersSchema,
    bestBid: positiveStrictDecimalStringSchema,
    bestAsk: positiveStrictDecimalStringSchema,
    bids: z.array(orderBookLevelSchema).min(1),
    asks: z.array(orderBookLevelSchema).min(1),
    openOrders: z.array(openOrderSchema),
    dailyExecutedNotional: strictDecimalStringSchema,
    dailyReservedNotional: strictDecimalStringSchema,
    observationHash: hexHashSchema.optional(),
  })
  .strict();

export type BinanceSpotObservation = z.infer<typeof binanceSpotObservationSchema>;

export const binanceSpotPreflightSchema = z
  .object({
    version: z.literal("lujaw.binance-spot-preflight/1"),
    preflightHash: hexHashSchema,
    policyHash: hexHashSchema,
    observationHash: hexHashSchema,
    decision: z.enum(["ALLOW", "REDUCE", "BLOCK", "INCONCLUSIVE"]),
    requestedOrder: binanceSpotOrderIntentSchema,
    authorizedOrder: binanceSpotOrderIntentSchema.nullable(),
    calculations: z
      .object({
        requestedNotional: strictDecimalStringSchema,
        authorizedNotional: strictDecimalStringSchema,
        dailyRemaining: strictDecimalStringSchema,
        quoteReserveAfter: strictDecimalStringSchema.nullable(),
        concentrationAfterBps: z.number().int().nullable(),
        estimatedSlippageBps: z.number().int().nullable(),
        valuationCoverageBps: z.number().int(),
      })
      .strict(),
    reasons: z.array(z.enum(BINANCE_REASON_CODES)),
    expiresAt: z.number().int().positive(),
  })
  .strict();

export type BinanceSpotPreflight = z.infer<typeof binanceSpotPreflightSchema>;

export const binanceSpotAuthorizationSchema = z
  .object({
    version: z.literal("lujaw.binance-spot-authorization/1"),
    authorizationHash: hexHashSchema,
    policyHash: hexHashSchema,
    preflightHash: hexHashSchema,
    accountRef: z.string().min(1),
    authorizedOrder: binanceSpotOrderIntentSchema,
    nonce: z.string().min(1),
    maxActions: z.literal(1),
    createdAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
    state: z.enum(["RESERVED", "REPORTED", "VERIFIED", "FAILED", "EXPIRED"]),
    reservedNotional: positiveStrictDecimalStringSchema,
  })
  .strict();

export type BinanceSpotAuthorization = z.infer<typeof binanceSpotAuthorizationSchema>;

export const binanceFillSchema = z
  .object({
    price: positiveStrictDecimalStringSchema,
    qty: positiveStrictDecimalStringSchema,
    commission: strictDecimalStringSchema,
    commissionAsset: z.string().min(1),
  })
  .strict();

export const binanceExecutionEvidenceSchema = z
  .object({
    orderId: z.union([z.string(), z.number()]).nullable(),
    clientOrderId: z.string().nullable(),
    status: z.enum([
      "NEW",
      "PARTIALLY_FILLED",
      "FILLED",
      "CANCELED",
      "REJECTED",
      "EXPIRED",
      "PENDING",
      "UNKNOWN",
    ]),
    executedQty: strictDecimalStringSchema,
    cumulativeQuoteQty: strictDecimalStringSchema,
    fills: z.array(binanceFillSchema),
    preBalances: z.array(balanceEntrySchema),
    postBalances: z.array(balanceEntrySchema),
    hostAttested: z.literal(false),
  })
  .strict();

export type BinanceExecutionEvidence = z.infer<typeof binanceExecutionEvidenceSchema>;

export const binanceSpotEpisodeSchema = z
  .object({
    version: z.literal("lujaw.binance-spot-episode/1"),
    episodeId: hexHashSchema,
    createdAt: z.number().int().nonnegative(),
    policyHash: hexHashSchema,
    observationHash: hexHashSchema,
    preflightHash: hexHashSchema,
    authorizationHash: hexHashSchema.nullable(),
    requestedOrder: binanceSpotOrderIntentSchema,
    authorizedOrder: binanceSpotOrderIntentSchema.nullable(),
    decision: z.enum(["ALLOW", "REDUCE", "BLOCK", "INCONCLUSIVE"]),
    reasons: z.array(z.enum(BINANCE_REASON_CODES)),
    exactHashAccepted: z.boolean(),
    evidence: binanceExecutionEvidenceSchema.nullable(),
    compliance: z.record(z.boolean()),
    outcome: z.enum(["BLOCKED", "AUTHORIZED", "VERIFIED", "FAILED", "INCONCLUSIVE"]),
    limitations: z.array(z.string()),
  })
  .strict();

export type BinanceSpotEpisode = z.infer<typeof binanceSpotEpisodeSchema>;
