/**
 * Frozen Phase 2 policy constants. Do not change without re-running Gate 0
 * validity review for the locked BSC testnet USDT path.
 */

/** Max age of a pinned observation vs chain head (BSC ~0.45s/block ≈ 29s). */
export const MAX_OBSERVATION_AGE_BLOCKS = 64n;

/** Extra top-up after upward rounding, in basis points of the unbuffered raw amount. */
export const TOP_UP_BUFFER_BPS = 50n;

/** Basis-point denominator. */
export const BPS_DENOMINATOR = 10_000n;

/** Native relay-fee spend cap for Altana sessions (0.01 tBNB). */
export const DEFAULT_NATIVE_FEE_CAP_WEI = 10n ** 16n;

/** Absolute ceiling for custom/NL max top-up (25 USDT at 6 decimals). */
export const MAX_TOP_UP_RAW = 25_000_000n;

/** Balanced preset max top-up (15 USDT @ 6 decimals). */
export const BALANCED_MAX_TOP_UP_RAW = 15_000_000n;

/** Session lifetime ceiling for activate (seconds). */
export const MAX_SESSION_DURATION_SECONDS = 24 * 60 * 60;

/** AgentRouter model used for schema-constrained Care Plan drafting. */
export const DEFAULT_AGENT_ROUTER_MODEL = "deepseek-v4-flash" as const;
export const DEFAULT_AGENT_ROUTER_BASE_URL = "https://agentrouter.org/v1" as const;

export type CarePlanPresetName = "conservative" | "balanced" | "custom";

export interface CarePlanPreset {
  readonly name: CarePlanPresetName;
  readonly alertBelow: string;
  readonly interveneBelow: string;
  readonly restoreTo: string;
  readonly maxTopUpRaw: string;
  readonly sessionDurationSeconds: number;
}

/**
 * Presets change thresholds and budgets only. Protocol scope always comes from
 * the deployment profile. alertBelow = interveneBelow + 0.05.
 */
export const CARE_PLAN_PRESETS: Readonly<Record<"conservative" | "balanced", CarePlanPreset>> = {
  conservative: {
    name: "conservative",
    alertBelow: "1.65",
    interveneBelow: "1.60",
    restoreTo: "1.80",
    maxTopUpRaw: MAX_TOP_UP_RAW.toString(10),
    sessionDurationSeconds: MAX_SESSION_DURATION_SECONDS,
  },
  balanced: {
    name: "balanced",
    alertBelow: "1.50",
    interveneBelow: "1.45",
    restoreTo: "1.65",
    maxTopUpRaw: BALANCED_MAX_TOP_UP_RAW.toString(10),
    sessionDurationSeconds: MAX_SESSION_DURATION_SECONDS,
  },
};
