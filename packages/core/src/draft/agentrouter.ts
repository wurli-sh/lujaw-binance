/**
 * Care Plan drafting: presets (offline) + AgentRouter schema-constrained output.
 */
import { z } from "zod";
import {
  CARE_PLAN_PRESETS,
  DEFAULT_AGENT_ROUTER_BASE_URL,
  DEFAULT_AGENT_ROUTER_MODEL,
  MAX_TOP_UP_RAW,
} from "../constants.js";
import type { DeploymentProfile } from "../deployment.js";
import {
  validateCarePlan,
  type CarePlanDraft,
  type CarePlanValidationResult,
} from "../schemas/plan.js";

const nlExtractSchema = z.object({
  interveneBelow: z.string().nullable().optional(),
  alertBelow: z.string().nullable().optional(),
  restoreTo: z.string().nullable().optional(),
  maxTopUpUsdt: z.string().nullable().optional(),
  sessionHours: z.string().nullable().optional(),
  followUpQuestion: z.string().nullable().optional(),
});

export type AgentRouterChatClient = {
  chat: {
    completions: {
      create: (body: {
        model: string;
        temperature?: number;
        max_tokens?: number;
        response_format?: unknown;
        messages: Array<{ role: string; content: string }>;
      }) => Promise<{ choices: Array<{ message?: { content?: string | null } }> }>;
    };
  };
};

export type DraftCarePlanInput = {
  preset?: "conservative" | "balanced" | "custom";
  naturalLanguage?: string;
  /** Explicit custom fields (offline; no LLM). */
  alertBelow?: string;
  interveneBelow?: string;
  restoreTo?: string;
  maxTopUpRaw?: string;
  sessionDurationSeconds?: number;
  /** Injected AgentRouter chat-completions client for tests. */
  agentRouterApiKey?: string;
  agentRouterBaseUrl?: string;
  agentRouterModel?: string;
  agentRouterClient?: AgentRouterChatClient;
  nowSeconds?: number;
};

export type DraftCarePlanResult =
  | { ok: true; draft: CarePlanDraft; validation: CarePlanValidationResult }
  | {
      ok: false;
      code: "AGENT_ROUTER_KEY_MISSING" | "DRAFT_INVALID" | "DRAFT_NEEDS_FOLLOW_UP";
      message: string;
      followUpQuestion?: string;
      draft?: CarePlanDraft;
    };

function decimalToScaledInteger(value: string, decimals: number, field: string): bigint {
  if (!/^(?!0+(?:\.0+)?$)\d+(?:\.\d+)?$/.test(value)) {
    throw new Error(`${field} must be a positive decimal string`);
  }
  const [whole = "0", fraction = ""] = value.split(".");
  if (fraction.length > decimals) {
    throw new Error(`${field} supports at most ${decimals} decimal places`);
  }
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
}

function usdtToRaw(usdt: string): string {
  return decimalToScaledInteger(usdt, 6, "maxTopUpUsdt").toString(10);
}

function hoursToSeconds(hours: string): number {
  const millionths = decimalToScaledInteger(hours, 6, "sessionHours");
  const secondsNumerator = millionths * 3600n;
  if (secondsNumerator % 1_000_000n !== 0n) {
    throw new Error("sessionHours must resolve to a whole number of seconds");
  }
  const seconds = secondsNumerator / 1_000_000n;
  if (seconds > 86_400n) throw new Error("sessionHours must be no more than 24");
  return Number(seconds);
}

function resolveApiKey(input: DraftCarePlanInput): string | undefined {
  return input.agentRouterApiKey ?? process.env.AGENT_ROUTER_API_KEY;
}

function resolveBaseUrl(input: DraftCarePlanInput): string {
  const raw =
    input.agentRouterBaseUrl ?? process.env.AGENT_ROUTER_BASE_URL ?? DEFAULT_AGENT_ROUTER_BASE_URL;
  return raw.replace(/\/$/, "");
}

function resolveModel(input: DraftCarePlanInput): string {
  return (
    input.agentRouterModel ??
    process.env.AGENT_ROUTER_MODEL ??
    DEFAULT_AGENT_ROUTER_MODEL
  );
}

/**
 * Minimal AgentRouter chat-completions client.
 */
export function createAgentRouterClient(options: {
  apiKey: string;
  baseUrl?: string;
}): AgentRouterChatClient {
  const baseUrl = (options.baseUrl ?? DEFAULT_AGENT_ROUTER_BASE_URL).replace(/\/$/, "");
  return {
    chat: {
      completions: {
        async create(body) {
          const res = await fetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${options.apiKey}`,
              "Content-Type": "application/json",
              Accept: "application/json",
              "HTTP-Referer": "https://github.com/lujaw-binance",
              "X-Title": "LUJAW",
            },
            body: JSON.stringify(body),
          });
          const text = await res.text();
          let json: unknown;
          try {
            json = JSON.parse(text) as unknown;
          } catch {
            throw new Error(
              `AgentRouter returned non-JSON (${res.status}): ${text.slice(0, 200)}`,
            );
          }
          if (!res.ok) {
            const message =
              typeof json === "object" &&
              json !== null &&
              "error" in json &&
              typeof (json as { error?: { message?: string } }).error?.message === "string"
                ? (json as { error: { message: string } }).error.message
                : text.slice(0, 300);
            throw new Error(`AgentRouter ${res.status}: ${message}`);
          }
          return json as {
            choices: Array<{ message?: { content?: string | null } }>;
          };
        },
      },
    },
  };
}

function extractJsonObject(content: string): unknown {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    }
    throw new Error("model response was not valid JSON");
  }
}

export async function draftCarePlan(
  input: DraftCarePlanInput,
  deployment: DeploymentProfile,
): Promise<DraftCarePlanResult> {
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);

  if (input.preset === "conservative" || input.preset === "balanced") {
    const preset = CARE_PLAN_PRESETS[input.preset];
    const draft: CarePlanDraft = {
      preset: preset.name,
      alertBelow: preset.alertBelow,
      interveneBelow: preset.interveneBelow,
      restoreTo: preset.restoreTo,
      maxTopUpRaw: preset.maxTopUpRaw,
      sessionDurationSeconds: preset.sessionDurationSeconds,
    };
    const validation = validateCarePlan(draft, deployment, nowSeconds);
    return { ok: true, draft, validation };
  }

  const hasExplicit =
    input.alertBelow !== undefined ||
    input.interveneBelow !== undefined ||
    input.restoreTo !== undefined ||
    input.maxTopUpRaw !== undefined ||
    input.sessionDurationSeconds !== undefined;

  if (hasExplicit) {
    const draft: CarePlanDraft = {
      preset: "custom",
      ...(input.alertBelow ? { alertBelow: input.alertBelow } : {}),
      ...(input.interveneBelow ? { interveneBelow: input.interveneBelow } : {}),
      ...(input.restoreTo ? { restoreTo: input.restoreTo } : {}),
      ...(input.maxTopUpRaw ? { maxTopUpRaw: input.maxTopUpRaw } : {}),
      ...(input.sessionDurationSeconds !== undefined
        ? { sessionDurationSeconds: input.sessionDurationSeconds }
        : {}),
    };
    const validation = validateCarePlan(draft, deployment, nowSeconds);
    if (!validation.ok) {
      return {
        ok: false,
        code: validation.code,
        message: validation.message,
        ...(validation.followUpQuestion
          ? { followUpQuestion: validation.followUpQuestion }
          : {}),
        draft,
      };
    }
    return { ok: true, draft, validation };
  }

  if (!input.naturalLanguage || input.naturalLanguage.trim().length === 0) {
    return {
      ok: false,
      code: "DRAFT_NEEDS_FOLLOW_UP",
      message: "provide a preset or natural-language Care Plan request",
      followUpQuestion:
        "Choose conservative or balanced, or describe intervene/restore thresholds, max USDT, and duration.",
    };
  }

  const injected = input.agentRouterClient;
  const apiKey = resolveApiKey(input);
  if (!apiKey && !injected) {
    return {
      ok: false,
      code: "AGENT_ROUTER_KEY_MISSING",
      message:
        "AGENT_ROUTER_API_KEY is required for natural-language Care Plan drafting",
    };
  }

  const client =
    injected ??
    createAgentRouterClient({
      apiKey: apiKey!,
      baseUrl: resolveBaseUrl(input),
    });
  const model = resolveModel(input);

  let content: string | undefined;
  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0,
      max_tokens: 400,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "lujaw_care_plan_draft",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              interveneBelow: { type: ["string", "null"] },
              alertBelow: { type: ["string", "null"] },
              restoreTo: { type: ["string", "null"] },
              maxTopUpUsdt: { type: ["string", "null"] },
              sessionHours: { type: ["string", "null"] },
              followUpQuestion: { type: ["string", "null"] },
            },
            required: ["interveneBelow", "alertBelow", "restoreTo", "maxTopUpUsdt", "sessionHours", "followUpQuestion"],
          },
        },
      },
      messages: [
        {
          role: "system",
          content:
            "Extract Care Plan numeric fields from the user. Reply with a single JSON object only, no markdown. Keys: interveneBelow, alertBelow, restoreTo, maxTopUpUsdt, sessionHours (decimal strings like \"1.50\", or null), followUpQuestion (string or null). Never invent chain IDs, addresses, tokens, or selectors. If a required field is missing, set it null and put one short followUpQuestion.",
        },
        { role: "user", content: input.naturalLanguage },
      ],
    });
    content = completion.choices[0]?.message?.content ?? undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      code: "DRAFT_INVALID",
      message: `AgentRouter draft failed: ${message}`,
    };
  }

  if (!content) {
    return { ok: false, code: "DRAFT_INVALID", message: "AgentRouter returned an empty draft" };
  }

  let extracted: z.infer<typeof nlExtractSchema>;
  try {
    extracted = nlExtractSchema.parse(extractJsonObject(content));
  } catch (error) {
    return {
      ok: false,
      code: "DRAFT_INVALID",
      message: error instanceof Error ? error.message : "failed to parse AgentRouter draft JSON",
    };
  }

  let maxTopUpRaw: string | undefined;
  if (extracted.maxTopUpUsdt !== null && extracted.maxTopUpUsdt !== undefined) {
    try {
      maxTopUpRaw = usdtToRaw(extracted.maxTopUpUsdt);
      if (BigInt(maxTopUpRaw) > MAX_TOP_UP_RAW) {
        throw new Error(`maxTopUpUsdt exceeds the supported ${MAX_TOP_UP_RAW} raw-unit cap`);
      }
    } catch (error) {
      return {
        ok: false,
        code: "DRAFT_INVALID",
        message: error instanceof Error ? error.message : "invalid maxTopUpUsdt",
      };
    }
  }

  let sessionDurationSeconds: number | undefined;
  if (extracted.sessionHours !== null && extracted.sessionHours !== undefined) {
    try {
      sessionDurationSeconds = hoursToSeconds(extracted.sessionHours);
    } catch (error) {
      return {
        ok: false,
        code: "DRAFT_INVALID",
        message: error instanceof Error ? error.message : "invalid sessionHours",
      };
    }
  }
  const draft: CarePlanDraft = {
    preset: "custom",
    naturalLanguage: input.naturalLanguage,
    ...(extracted.interveneBelow ? { interveneBelow: extracted.interveneBelow } : {}),
    ...(extracted.alertBelow
      ? { alertBelow: extracted.alertBelow }
      : extracted.interveneBelow
        ? { alertBelow: addFiveHundredths(extracted.interveneBelow) }
        : {}),
    ...(extracted.restoreTo ? { restoreTo: extracted.restoreTo } : {}),
    ...(maxTopUpRaw ? { maxTopUpRaw } : {}),
    ...(sessionDurationSeconds === undefined ? {} : { sessionDurationSeconds }),
    ...(extracted.followUpQuestion ? { followUpQuestion: extracted.followUpQuestion } : {}),
  };

  const validation = validateCarePlan(draft, deployment, nowSeconds);
  if (!validation.ok) {
    return {
      ok: false,
      code: validation.code,
      message: validation.message,
      ...(validation.followUpQuestion
        ? { followUpQuestion: validation.followUpQuestion }
        : {}),
      draft,
    };
  }
  return { ok: true, draft, validation };
}


function addFiveHundredths(intervene: string): string {
  const [w, f = ""] = intervene.split(".");
  const frac = `${f}${"0".repeat(Math.max(0, 2 - f.length))}`.slice(0, 2);
  const hundredths = BigInt(w ?? "0") * 100n + BigInt(frac);
  const bumped = hundredths + 5n;
  const whole = bumped / 100n;
  const rem = (bumped % 100n).toString(10).padStart(2, "0");
  return `${whole}.${rem}`;
}
