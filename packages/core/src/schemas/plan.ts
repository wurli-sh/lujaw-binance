/**
 * Care Plan schemas and validation against the locked deployment profile.
 */
import { getAddress, isHex } from "viem";
import type { Address, Hex } from "viem";
import { z } from "zod";
import {
  CARE_PLAN_PRESETS,
  MAX_SESSION_DURATION_SECONDS,
  MAX_TOP_UP_RAW,
  type CarePlanPresetName,
} from "../constants.js";
import type { DeploymentProfile } from "../deployment.js";
import { parseThresholdToMantissa } from "../health/thresholds.js";
import {
  positiveDecimalStringSchema,
  rawAmountStringSchema,
} from "./common.js";

export const carePlanSchema = z.object({
  version: z.literal("lujaw.plan/1"),
  chainId: z.literal(97),
  protocol: z.literal("venus"),
  market: z.string(),
  collateralToken: z.string(),
  supplyTarget: z.string(),
  supplySelector: z.string(),
  alertBelow: positiveDecimalStringSchema,
  interveneBelow: positiveDecimalStringSchema,
  restoreTo: positiveDecimalStringSchema,
  maxTopUpRaw: rawAmountStringSchema,
  maxActions: z.literal(1),
  sessionExpiresAt: z.number().int().positive(),
  preset: z.enum(["conservative", "balanced", "custom"]).optional(),
});

export type CarePlan = z.infer<typeof carePlanSchema>;

export interface CarePlanDraft {
  readonly alertBelow?: string;
  readonly interveneBelow?: string;
  readonly restoreTo?: string;
  readonly maxTopUpRaw?: string;
  readonly sessionDurationSeconds?: number;
  readonly preset?: CarePlanPresetName;
  readonly followUpQuestion?: string;
  readonly naturalLanguage?: string;
}

export type CarePlanValidationError = {
  readonly ok: false;
  readonly code: "DRAFT_INVALID" | "DRAFT_NEEDS_FOLLOW_UP";
  readonly message: string;
  readonly followUpQuestion?: string;
};

export type CarePlanValidationSuccess = {
  readonly ok: true;
  readonly plan: CarePlan;
};

export type CarePlanValidationResult = CarePlanValidationSuccess | CarePlanValidationError;

function normalizeAddress(value: string): Address {
  return getAddress(value);
}

export function validateCarePlan(
  draft: CarePlanDraft,
  deployment: DeploymentProfile,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): CarePlanValidationResult {
  let alertBelow = draft.alertBelow;
  let interveneBelow = draft.interveneBelow;
  let restoreTo = draft.restoreTo;
  let maxTopUpRaw = draft.maxTopUpRaw;
  let sessionDurationSeconds = draft.sessionDurationSeconds;
  let preset = draft.preset;

  if (preset === "conservative" || preset === "balanced") {
    const locked = CARE_PLAN_PRESETS[preset];
    alertBelow = locked.alertBelow;
    interveneBelow = locked.interveneBelow;
    restoreTo = locked.restoreTo;
    maxTopUpRaw = locked.maxTopUpRaw;
    sessionDurationSeconds = locked.sessionDurationSeconds;
  }

  if (
    alertBelow === undefined ||
    interveneBelow === undefined ||
    restoreTo === undefined ||
    maxTopUpRaw === undefined ||
    sessionDurationSeconds === undefined
  ) {
    return {
      ok: false,
      code: "DRAFT_NEEDS_FOLLOW_UP",
      message: "Care Plan is missing required threshold, budget, or duration fields",
      followUpQuestion:
        draft.followUpQuestion ??
        "Provide interveneBelow, restoreTo, max top-up in USDT, and session duration (hours), or choose conservative/balanced.",
    };
  }

  if (sessionDurationSeconds <= 0 || sessionDurationSeconds > MAX_SESSION_DURATION_SECONDS) {
    return {
      ok: false,
      code: "DRAFT_INVALID",
      message: `session duration must be in (0, ${MAX_SESSION_DURATION_SECONDS}] seconds`,
    };
  }

  let maxTopUp: bigint;
  try {
    maxTopUp = BigInt(maxTopUpRaw);
  } catch {
    return { ok: false, code: "DRAFT_INVALID", message: "maxTopUpRaw must be an integer string" };
  }
  if (maxTopUp <= 0n || maxTopUp > MAX_TOP_UP_RAW) {
    return {
      ok: false,
      code: "DRAFT_INVALID",
      message: `maxTopUpRaw must be in (0, ${MAX_TOP_UP_RAW.toString(10)}]`,
    };
  }

  let intervene: bigint;
  let alert: bigint;
  let restore: bigint;
  try {
    intervene = parseThresholdToMantissa(interveneBelow);
    alert = parseThresholdToMantissa(alertBelow);
    restore = parseThresholdToMantissa(restoreTo);
  } catch (error) {
    return {
      ok: false,
      code: "DRAFT_INVALID",
      message: error instanceof Error ? error.message : "invalid threshold",
    };
  }

  if (!(intervene < alert)) {
    return {
      ok: false,
      code: "DRAFT_INVALID",
      message: "interveneBelow must be strictly less than alertBelow",
    };
  }
  if (!(restore > intervene)) {
    return {
      ok: false,
      code: "DRAFT_INVALID",
      message: "restoreTo must be strictly greater than interveneBelow",
    };
  }

  const market = deployment.venus.market;
  const sessionExpiresAt = nowSeconds + sessionDurationSeconds;
  const candidate = {
    version: "lujaw.plan/1" as const,
    chainId: 97 as const,
    protocol: "venus" as const,
    market: normalizeAddress(market.vToken),
    collateralToken: normalizeAddress(market.underlying),
    supplyTarget: normalizeAddress(market.supplyTarget),
    supplySelector: market.supplySelector.toLowerCase(),
    alertBelow,
    interveneBelow,
    restoreTo,
    maxTopUpRaw: maxTopUp.toString(10),
    maxActions: 1 as const,
    sessionExpiresAt,
    ...(preset === undefined ? {} : { preset }),
  };

  const parsed = carePlanSchema.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, code: "DRAFT_INVALID", message: parsed.error.message };
  }

  if (!isHex(parsed.data.supplySelector) || parsed.data.supplySelector.length !== 10) {
    return { ok: false, code: "DRAFT_INVALID", message: "invalid supplySelector" };
  }

  return { ok: true, plan: parsed.data as CarePlan & { supplySelector: Hex } };
}
