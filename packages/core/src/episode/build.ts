/**
 * Episode schema, builder, and local verifier.
 */
import type { Hex } from "viem";
import { z } from "zod";
import { formatMantissa } from "../health/scale.js";
import {
  episodeOutcomeSchema,
  productStatusSchema,
  reasonCodeSchema,
  rawAmountStringSchema,
  decimalStringSchema,
} from "../schemas/common.js";
import type { CarePlan } from "../schemas/plan.js";
import { carePlanSchema } from "../schemas/plan.js";
import { parseThresholdToMantissa } from "../health/thresholds.js";
import { BPS_DENOMINATOR, TOP_UP_BUFFER_BPS } from "../constants.js";
import { MANTISSA, applyWeight, fromUsd, toUsd } from "../health/scale.js";
import { canonicalHash, canonicalStringify } from "./canonical.js";

const positiveRawAmountStringSchema = z.string().regex(/^[1-9]\d*$/, "must be a positive integer decimal string");

export const episodeSchema = z.object({
  version: z.literal("lujaw.episode/1"),
  episodeId: z.string(),
  createdAt: z.number().int().nonnegative(),
  productStatus: productStatusSchema,
  plan: z.object({
    hash: z.string(),
    value: carePlanSchema.nullable(),
    preset: z.enum(["conservative", "balanced", "custom"]).nullable(),
    interveneBelow: decimalStringSchema,
    alertBelow: decimalStringSchema,
    restoreTo: decimalStringSchema,
    maxTopUpRaw: rawAmountStringSchema,
  }).strict(),
  preState: z.object({
    blockNumber: rawAmountStringSchema,
    blockHash: z.string(),
    weightedCollateralUsd: rawAmountStringSchema,
    borrowUsd: rawAmountStringSchema,
    healthFactorMantissa: rawAmountStringSchema.nullable(),
    healthFactor: decimalStringSchema.nullable(),
  }),
  calculation: z.object({
    decision: z.enum(["EXECUTE", "HOLD", "BLOCK"]),
    topUpRaw: rawAmountStringSchema,
    unbufferedTopUpRaw: rawAmountStringSchema.nullable(),
    requiredCollateralUsd: rawAmountStringSchema.nullable(),
    liquidationThresholdMantissa: positiveRawAmountStringSchema.nullable(),
    priceMantissa: positiveRawAmountStringSchema.nullable(),
    bufferBps: positiveRawAmountStringSchema.nullable(),
    projectedHealthFactorMantissa: rawAmountStringSchema.nullable(),
    projectedHealthFactor: decimalStringSchema.nullable(),
    reason: reasonCodeSchema,
  }),
  session: z
    .object({
      publicKeyId: z.string(),
      expiresAt: z.number().int(),
      validAtExecution: z.boolean(),
    })
    .nullable(),
  transaction: z
    .object({
      hash: z.string(),
      status: z.enum(["SUBMITTED", "CONFIRMED", "FAILED"]),
      blockNumber: rawAmountStringSchema.nullable(),
    })
    .nullable(),
  postState: z
    .object({
      blockNumber: rawAmountStringSchema,
      blockHash: z.string(),
      healthFactorMantissa: rawAmountStringSchema.nullable(),
      healthFactor: decimalStringSchema.nullable(),
      targetReached: z.boolean(),
    })
    .nullable(),
  outcome: episodeOutcomeSchema,
  explorer: z
    .object({
      grantTx: z.string().nullable().optional(),
      mintTx: z.string().nullable().optional(),
      revokeTx: z.string().nullable().optional(),
    })
    .optional(),
}).strict();

export type Episode = z.infer<typeof episodeSchema>;

export function canonicalPlanHash(plan: CarePlan): Hex {
  return canonicalHash({
    version: plan.version,
    chainId: plan.chainId,
    protocol: plan.protocol,
    market: plan.market.toLowerCase(),
    collateralToken: plan.collateralToken.toLowerCase(),
    supplyTarget: plan.supplyTarget.toLowerCase(),
    supplySelector: plan.supplySelector.toLowerCase(),
    alertBelow: plan.alertBelow,
    interveneBelow: plan.interveneBelow,
    restoreTo: plan.restoreTo,
    maxTopUpRaw: plan.maxTopUpRaw,
    maxActions: plan.maxActions,
    sessionExpiresAt: plan.sessionExpiresAt,
    preset: plan.preset ?? null,
  });
}

export interface BuildEpisodeInput {
  createdAt: number;
  plan: CarePlan | null;
  productStatus: Episode["productStatus"];
  preState: Episode["preState"];
  calculation: Episode["calculation"];
  session: Episode["session"];
  transaction: Episode["transaction"];
  postState: Episode["postState"];
  outcome: Episode["outcome"];
  explorer?: Episode["explorer"];
}

export function buildEpisode(input: BuildEpisodeInput): Episode {
  const planHash = input.plan ? canonicalPlanHash(input.plan) : ("0x" + "00".repeat(32));
  const planSection = {
    hash: planHash,
    value: input.plan,
    preset: (input.plan?.preset ?? null) as Episode["plan"]["preset"],
    interveneBelow: input.plan?.interveneBelow ?? "0",
    alertBelow: input.plan?.alertBelow ?? "0",
    restoreTo: input.plan?.restoreTo ?? "0",
    maxTopUpRaw: input.plan?.maxTopUpRaw ?? "0",
  };

  const withoutId = {
    version: "lujaw.episode/1" as const,
    createdAt: input.createdAt,
    productStatus: input.productStatus,
    plan: planSection,
    preState: input.preState,
    calculation: input.calculation,
    session: input.session,
    transaction: input.transaction,
    postState: input.postState,
    outcome: input.outcome,
    ...(input.explorer === undefined ? {} : { explorer: input.explorer }),
  };

  const episodeId = canonicalHash(withoutId);
  const episode = { ...withoutId, episodeId };
  return episodeSchema.parse(episode);
}

export function verifyEpisode(episode: unknown): {
  ok: boolean;
  errors: string[];
  episode?: Episode;
} {
  const parsed = episodeSchema.safeParse(episode);
  if (!parsed.success) {
    return { ok: false, errors: [parsed.error.message] };
  }
  const value = parsed.data;
  const { episodeId, ...rest } = value;
  const expectedId = canonicalHash(rest);
  const errors: string[] = [];
  if (episodeId !== expectedId) {
    errors.push("episodeId does not match canonical payload hash");
  }
  const zeroPlanHash = "0x" + "00".repeat(32);
  if (value.plan.value === null) {
    if (value.plan.hash !== zeroPlanHash) errors.push("null plan must use the zero plan hash");
  } else {
    const expectedPlanHash = canonicalPlanHash(value.plan.value);
    if (value.plan.hash !== expectedPlanHash) {
      errors.push("plan.hash does not match the canonical embedded Care Plan");
    }
    for (const field of ["preset", "interveneBelow", "alertBelow", "restoreTo", "maxTopUpRaw"] as const) {
      const expected = value.plan.value[field] ?? null;
      if (value.plan[field] !== expected) errors.push(`plan.${field} does not match plan.value`);
    }
  }
  if (value.outcome === "EXECUTED") {
    if (value.transaction?.status !== "CONFIRMED") {
      errors.push("EXECUTED requires CONFIRMED transaction");
    }
    if (value.postState?.targetReached !== true) {
      errors.push("EXECUTED requires postState.targetReached");
    }
  }
  if (value.outcome === "HELD" || value.outcome === "BLOCKED") {
    if (value.transaction !== null) errors.push(`${value.outcome} requires a null transaction`);
    if (value.postState !== null) errors.push(`${value.outcome} requires a null postState`);
  }
  if (value.calculation.decision === "EXECUTE") {
    if (BigInt(value.calculation.topUpRaw) <= 0n) {
      errors.push("EXECUTE requires a positive topUpRaw");
    }
  } else if (value.calculation.topUpRaw !== "0") {
    errors.push(`${value.calculation.decision} requires topUpRaw=0`);
  }
  if (value.calculation.unbufferedTopUpRaw !== null &&
      BigInt(value.calculation.unbufferedTopUpRaw) > BigInt(value.calculation.topUpRaw)) {
    errors.push("buffered topUpRaw cannot be below unbufferedTopUpRaw");
  }
  const weighted = BigInt(value.preState.weightedCollateralUsd);
  const borrow = BigInt(value.preState.borrowUsd);
  const expectedPreMantissa = borrow === 0n ? null : (weighted * MANTISSA) / borrow;
  if (value.preState.healthFactorMantissa !== (expectedPreMantissa?.toString(10) ?? null) ||
      value.preState.healthFactor !== hfToDecimalString(expectedPreMantissa)) {
    errors.push("preState.healthFactor does not match weighted collateral and borrow totals");
  }
  if (value.calculation.decision === "EXECUTE" && value.plan.value !== null) {
    const { liquidationThresholdMantissa, priceMantissa, bufferBps, requiredCollateralUsd, unbufferedTopUpRaw } = value.calculation;
    if (liquidationThresholdMantissa === null || priceMantissa === null || bufferBps === null ||
        requiredCollateralUsd === null || unbufferedTopUpRaw === null) {
      errors.push("EXECUTE requires complete deterministic calculation inputs");
    } else {
      const lambda = BigInt(liquidationThresholdMantissa);
      const price = BigInt(priceMantissa);
      const restore = parseThresholdToMantissa(value.plan.value.restoreTo);
      const targetWeighted = (restore * borrow + MANTISSA - 1n) / MANTISSA;
      const deficit = targetWeighted > weighted ? targetWeighted - weighted : 0n;
      const expectedRequired = deficit === 0n ? 0n : (deficit * MANTISSA + lambda - 1n) / lambda;
      const expectedUnbuffered = expectedRequired === 0n ? 0n : fromUsd(expectedRequired, price);
      let expectedBuffered = expectedUnbuffered;
      if (expectedUnbuffered > 0n) {
        expectedBuffered = (expectedUnbuffered * (BPS_DENOMINATOR + BigInt(bufferBps)) + BPS_DENOMINATOR - 1n) / BPS_DENOMINATOR;
        if (expectedBuffered < expectedUnbuffered + 1n) expectedBuffered = expectedUnbuffered + 1n;
      }
      const projected = borrow === 0n ? null :
        ((weighted + applyWeight(toUsd(expectedBuffered, price), lambda)) * MANTISSA) / borrow;
      if (BigInt(requiredCollateralUsd) !== expectedRequired || BigInt(unbufferedTopUpRaw) !== expectedUnbuffered ||
          BigInt(value.calculation.topUpRaw) !== expectedBuffered || BigInt(bufferBps) !== TOP_UP_BUFFER_BPS ||
          value.calculation.projectedHealthFactorMantissa !== (projected?.toString(10) ?? null) ||
          value.calculation.projectedHealthFactor !== hfToDecimalString(projected)) {
        errors.push("calculation fields do not reproduce the deterministic top-up");
      }
    }
  }
  if (value.postState !== null && value.plan.value !== null && value.postState.healthFactorMantissa !== null) {
    const reached = BigInt(value.postState.healthFactorMantissa) >=
      parseThresholdToMantissa(value.plan.value.restoreTo);
    if (value.postState.targetReached !== reached) {
      errors.push("postState.targetReached does not match healthFactor and restoreTo");
    }
    if (value.postState.healthFactor !== hfToDecimalString(BigInt(value.postState.healthFactorMantissa))) {
      errors.push("postState healthFactor display does not match its mantissa");
    }
  } else if (value.postState !== null &&
      (value.postState.healthFactor !== null || value.postState.targetReached)) {
    errors.push("postState without a health-factor mantissa cannot claim health or target recovery");
  }
  return errors.length === 0
    ? { ok: true, errors: [], episode: value }
    : { ok: false, errors };
}

export function hfToDecimalString(mantissa: bigint | null): string | null {
  if (mantissa === null) return null;
  return formatMantissa(mantissa);
}

export { canonicalStringify };
