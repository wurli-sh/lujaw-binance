import { z } from "zod";

export const emptyToolArgsSchema = z.object({}).strict();

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

export function episodeExitCode(outcome: "HELD" | "BLOCKED" | "EXECUTED" | "FAILED"): number {
  if (outcome === "FAILED") return 2;
  if (outcome === "BLOCKED") return 1;
  return 0;
}
