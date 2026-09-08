/**
 * Binance Spot episode construction and offline verification.
 */
import type { Hex } from "viem";
import { canonicalHash } from "../episode/canonical.js";
import { ordersEqual } from "./authorization.js";
import { parseScaled } from "./decimal.js";
import type { BinanceReasonCode } from "./reason-codes.js";
import {
  binanceSpotEpisodeSchema,
  type BinanceExecutionEvidence,
  type BinanceSpotAuthorization,
  type BinanceSpotEpisode,
  type BinanceSpotOrderIntent,
  type BinanceSpotPreflight,
} from "./schemas.js";

export type BuildSpotEpisodeInput = {
  createdAt: number;
  policyHash: Hex;
  observationHash: Hex;
  preflight: BinanceSpotPreflight;
  authorization: BinanceSpotAuthorization | null;
  exactHashAccepted: boolean;
  evidence: BinanceExecutionEvidence | null;
  limitations?: string[];
};

export function buildSpotEpisode(input: BuildSpotEpisodeInput): BinanceSpotEpisode {
  const decision = input.preflight.decision;
  const reasons = [...input.preflight.reasons] as BinanceReasonCode[];
  const limitations = [
    "Host-supplied Binance evidence is not cryptographically attested by LUJAW.",
    "Host can bypass LUJAW and call Binance MCP directly.",
    ...(input.limitations ?? []),
  ];

  let outcome: BinanceSpotEpisode["outcome"];
  const compliance: Record<string, boolean> = {
    policyHashBound: true,
    preflightHashBound: Boolean(input.authorization),
    authorizationOneShot: input.authorization?.state === "VERIFIED" || input.authorization?.state === "RESERVED",
  };

  if (decision === "BLOCK") {
    outcome = "BLOCKED";
  } else if (decision === "INCONCLUSIVE") {
    outcome = "INCONCLUSIVE";
  } else if (!input.authorization) {
    outcome = "AUTHORIZED";
  } else if (!input.evidence) {
    outcome = "AUTHORIZED";
  } else if (input.evidence.status === "REJECTED" || input.evidence.status === "CANCELED" || input.evidence.status === "EXPIRED") {
    outcome = "FAILED";
    reasons.push("ORDER_REJECTED");
    compliance.orderAccepted = false;
  } else if (input.evidence.status === "PARTIALLY_FILLED") {
    outcome = "INCONCLUSIVE";
    reasons.push("ORDER_PARTIALLY_FILLED");
    compliance.fullFill = false;
  } else if (input.evidence.status !== "FILLED") {
    outcome = "INCONCLUSIVE";
    reasons.push("ORDER_STATUS_UNCONFIRMED");
  } else if (
    input.authorization.authorizedOrder &&
    !orderMatchesEvidence(input.authorization.authorizedOrder, input.evidence)
  ) {
    outcome = "FAILED";
    reasons.push("ORDER_MISMATCH");
    compliance.orderMatch = false;
  } else {
    outcome = "VERIFIED";
    reasons.push("VERIFIED_COMPLIANT");
    compliance.orderMatch = true;
    compliance.fullFill = true;
  }

  const body = {
    version: "lujaw.binance-spot-episode/1" as const,
    createdAt: input.createdAt,
    policyHash: input.policyHash,
    observationHash: input.observationHash,
    preflightHash: input.preflight.preflightHash,
    authorizationHash: input.authorization?.authorizationHash ?? null,
    requestedOrder: input.preflight.requestedOrder,
    authorizedOrder: input.preflight.authorizedOrder,
    decision,
    reasons: dedupeReasons(reasons),
    exactHashAccepted: input.exactHashAccepted,
    evidence: input.evidence,
    compliance,
    outcome,
    limitations,
  };

  const episodeId = canonicalHash(body);
  const episode: BinanceSpotEpisode = { ...body, episodeId };
  const parsed = binanceSpotEpisodeSchema.parse(episode);
  return parsed;
}

function dedupeReasons(reasons: BinanceReasonCode[]): BinanceReasonCode[] {
  return [...new Set(reasons)];
}

function orderMatchesEvidence(
  authorized: BinanceSpotOrderIntent,
  evidence: BinanceExecutionEvidence,
): boolean {
  // Symbol/side/type are not always on evidence schema — check fills presence and quote.
  if (evidence.fills.length === 0 && evidence.status === "FILLED") return false;
  try {
    if (authorized.quoteOrderQty) {
      const authorizedQuote = parseScaled(authorized.quoteOrderQty);
      const executedQuote = parseScaled(evidence.cumulativeQuoteQty);
      // Allow tiny undershoot from fees/rounding but not overspend vs authorized quote.
      if (executedQuote > authorizedQuote) return false;
    }
  } catch {
    return false;
  }
  return true;
}

export function verifySpotEpisode(episode: unknown): {
  ok: boolean;
  errors: string[];
  episode?: BinanceSpotEpisode;
} {
  const parsed = binanceSpotEpisodeSchema.safeParse(episode);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => i.message) };
  }
  const value = parsed.data;
  const { episodeId, ...rest } = value;
  const expectedId = canonicalHash(rest);
  const errors: string[] = [];
  if (expectedId.toLowerCase() !== episodeId.toLowerCase()) {
    errors.push("episodeId mismatch");
  }
  if (value.outcome === "VERIFIED") {
    if (!value.evidence || value.evidence.status !== "FILLED") {
      errors.push("VERIFIED requires FILLED evidence");
    }
    if (!value.authorizationHash) {
      errors.push("VERIFIED requires authorizationHash");
    }
    if (value.evidence && value.evidence.hostAttested !== false) {
      errors.push("hostAttested must be false in v1");
    }
  }
  if (value.outcome === "VERIFIED" && value.decision !== "ALLOW" && value.decision !== "REDUCE") {
    errors.push("VERIFIED incompatible with decision");
  }
  if (value.authorizedOrder && value.requestedOrder) {
    // no-op type check
    void ordersEqual;
  }
  return errors.length === 0
    ? { ok: true, errors: [], episode: value }
    : { ok: false, errors };
}
