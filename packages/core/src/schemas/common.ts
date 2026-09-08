/**
 * Shared reason codes and product/outcome vocabularies.
 */
import { z } from "zod";

export const productStatusSchema = z.enum(["HEALTHY", "WATCH", "AT_RISK", "INCONCLUSIVE"]);
export type ProductStatus = z.infer<typeof productStatusSchema>;

export const episodeOutcomeSchema = z.enum(["HELD", "BLOCKED", "EXECUTED", "FAILED"]);
export type EpisodeOutcome = z.infer<typeof episodeOutcomeSchema>;

export const reasonCodeSchema = z.enum([
  "HEALTHY_NO_REPAIR",
  "WATCH_NO_REPAIR",
  "CHECK_ONLY_AT_RISK",
  "BELOW_INTERVENTION_THRESHOLD",
  "TOP_UP_ZERO",
  "TOP_UP_EXCEEDS_PLAN",
  "TOP_UP_EXCEEDS_SESSION",
  "OBSERVATION_STALE",
  "OBSERVATION_INCONCLUSIVE",
  "REPAIR_MARKET_NOT_ENTERED",
  "SESSION_MISSING",
  "SESSION_EXPIRED",
  "SESSION_REVOKED",
  "SESSION_WRONG_WALLET",
  "AUTHORITY_CRITICAL_DISCREPANCY",
  "UNEXPECTED_TARGET_OR_SELECTOR",
  "ACTION_ALREADY_CONSUMED",
  "PROJECTED_TARGET_NOT_REACHED",
  "RECEIPT_REVERTED",
  "TRANSACTION_UNRESOLVED",
  "RECEIPT_ATTRIBUTION_FAILED",
  "POST_STATE_INCONCLUSIVE",
  "POST_STATE_MISSED_TARGET",
  "EXECUTED_TARGET_REACHED",
  "DRAFT_INVALID",
  "DRAFT_NEEDS_FOLLOW_UP",
  "AGENT_ROUTER_KEY_MISSING",
]);
export type ReasonCode = z.infer<typeof reasonCodeSchema>;

export const decimalStringSchema = z
  .string()
  .regex(/^\d+(\.\d+)?$/, "must be a non-negative decimal string");

export const positiveDecimalStringSchema = z
  .string()
  .regex(/^(?!0+(\.0+)?$)\d+(\.\d+)?$/, "must be a positive decimal string");

export const rawAmountStringSchema = z.string().regex(/^\d+$/, "must be an integer decimal string");
