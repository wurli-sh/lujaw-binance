/**
 * One-shot Spot authorization with TTL, nonce, and canonical hash.
 */
import { randomBytes } from "node:crypto";
import type { Hex } from "viem";
import { canonicalHash } from "../episode/canonical.js";
import type { BinanceReasonCode } from "./reason-codes.js";
import type {
  BinanceSpotAuthorization,
  BinanceSpotOrderIntent,
  BinanceSpotPolicy,
  BinanceSpotPreflight,
} from "./schemas.js";
import { binanceSpotAuthorizationSchema } from "./schemas.js";

export type AuthorizeInput = {
  policy: BinanceSpotPolicy;
  preflight: BinanceSpotPreflight;
  acceptedPreflightHash: Hex;
  nowSeconds?: number;
  nonce?: string;
};

export type AuthorizeResult =
  | { ok: true; authorization: BinanceSpotAuthorization }
  | { ok: false; reasons: BinanceReasonCode[]; message: string };

function canonicalAuthorizationHash(
  body: Omit<BinanceSpotAuthorization, "authorizationHash" | "state">,
): Hex {
  return canonicalHash(body);
}

export function createSpotAuthorization(input: AuthorizeInput): AuthorizeResult {
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (input.acceptedPreflightHash.toLowerCase() !== input.preflight.preflightHash.toLowerCase()) {
    return { ok: false, reasons: ["PREFLIGHT_HASH_MISMATCH"], message: "preflight hash mismatch" };
  }
  if (nowSeconds >= input.preflight.expiresAt) {
    return { ok: false, reasons: ["PREFLIGHT_EXPIRED"], message: "preflight expired" };
  }
  if (input.preflight.decision !== "ALLOW" && input.preflight.decision !== "REDUCE") {
    return {
      ok: false,
      reasons: ["PREFLIGHT_HASH_MISMATCH"],
      message: `cannot authorize decision ${input.preflight.decision}`,
    };
  }
  if (!input.preflight.authorizedOrder) {
    return { ok: false, reasons: ["PREFLIGHT_HASH_MISMATCH"], message: "no authorized order" };
  }
  if (nowSeconds >= input.policy.expiresAt) {
    return { ok: false, reasons: ["POLICY_EXPIRED"], message: "policy expired" };
  }

  const nonce = input.nonce ?? randomBytes(16).toString("hex");
  const ttl = Math.min(input.policy.authorizationTtlSeconds, 60);
  const body = {
    version: "lujaw.binance-spot-authorization/1" as const,
    policyHash: input.preflight.policyHash,
    preflightHash: input.preflight.preflightHash,
    accountRef: input.policy.accountRef,
    authorizedOrder: input.preflight.authorizedOrder,
    nonce,
    maxActions: 1 as const,
    createdAt: nowSeconds,
    expiresAt: nowSeconds + ttl,
    reservedNotional: input.preflight.calculations.authorizedNotional,
  };
  const authorizationHash = canonicalAuthorizationHash(body);
  const authorization: BinanceSpotAuthorization = {
    ...body,
    authorizationHash,
    state: "RESERVED",
  };
  const parsed = binanceSpotAuthorizationSchema.safeParse(authorization);
  if (!parsed.success) {
    return { ok: false, reasons: ["HARD_BOUND_VIOLATION"], message: parsed.error.message };
  }
  return { ok: true, authorization: parsed.data };
}

export function isAuthorizationUsable(
  auth: BinanceSpotAuthorization,
  nowSeconds: number,
): { ok: true } | { ok: false; reasons: BinanceReasonCode[] } {
  if (auth.state !== "RESERVED") {
    return { ok: false, reasons: ["AUTHORIZATION_REPLAY"] };
  }
  if (nowSeconds >= auth.expiresAt) {
    return { ok: false, reasons: ["PREFLIGHT_EXPIRED"] };
  }
  return { ok: true };
}

export function ordersEqual(
  a: BinanceSpotOrderIntent,
  b: BinanceSpotOrderIntent,
): boolean {
  return (
    a.version === b.version &&
    a.symbol.toUpperCase() === b.symbol.toUpperCase() &&
    a.side === b.side &&
    a.type === b.type &&
    (a.quoteOrderQty ?? null) === (b.quoteOrderQty ?? null) &&
    (a.quantity ?? null) === (b.quantity ?? null) &&
    (a.limitPrice ?? null) === (b.limitPrice ?? null)
  );
}

export function markAuthorizationState(
  auth: BinanceSpotAuthorization,
  state: BinanceSpotAuthorization["state"],
): BinanceSpotAuthorization {
  return { ...auth, state };
}
