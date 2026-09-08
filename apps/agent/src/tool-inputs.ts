import { z } from "zod";
import { isAddress } from "viem";

export const emptyToolArgsSchema = z.object({}).strict();

export const accountToolArgsSchema = z.object({
  account: z.string().refine((value) => isAddress(value), "invalid EVM address").optional(),
}).strict();

export const activateToolArgsSchema = z.object({
  preset: z.enum(["conservative", "balanced"]).optional(),
  nl: z.string().min(1).optional(),
  accept: z.boolean().optional(),
  planHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
}).strict().superRefine((value, context) => {
  if ((value.preset === undefined) === (value.nl === undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "provide exactly one of preset or nl" });
  }
  if (value.accept === true && value.planHash === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "accept=true requires planHash" });
  }
});

export const policyCreateToolArgsSchema = z.object({
  preset: z.enum(["demo"]).optional(),
  accountRef: z.string().min(1).max(128).optional(),
  maxOrderNotional: z.string().optional(),
  minQuoteReserve: z.string().optional(),
  maxDailyGrossNotional: z.string().optional(),
  maxAssetConcentrationBps: z.number().int().min(1).max(10_000).optional(),
  maxEstimatedSlippageBps: z.number().int().min(1).max(500).optional(),
  accept: z.boolean().optional(),
  policyHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
}).strict().superRefine((value, context) => {
  if (value.accept === true && value.policyHash === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "accept=true requires policyHash" });
  }
});

export const orderPreflightToolArgsSchema = z.object({
  intent: z.record(z.unknown()),
  observation: z.record(z.unknown()),
}).strict();

export const orderAuthorizeToolArgsSchema = z.object({
  preflightHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  accept: z.boolean(),
}).strict();

export const episodeVerifyToolArgsSchema = z.object({
  authorizationHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  evidence: z.record(z.unknown()).optional(),
}).strict();

export function episodeExitCode(outcome: "HELD" | "BLOCKED" | "EXECUTED" | "FAILED"): number {
  if (outcome === "FAILED") return 2;
  if (outcome === "BLOCKED") return 1;
  return 0;
}

export function spotEpisodeExitCode(
  outcome: "BLOCKED" | "AUTHORIZED" | "VERIFIED" | "FAILED" | "INCONCLUSIVE",
): number {
  if (outcome === "FAILED") return 2;
  if (outcome === "BLOCKED" || outcome === "INCONCLUSIVE") return 1;
  return 0;
}
