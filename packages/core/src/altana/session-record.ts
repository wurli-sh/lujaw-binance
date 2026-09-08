/**
 * Persisting a session without storing a key.
 *
 * Spend limits must be decimal strings — JSON numbers cannot hold a BSC
 * stablecoin cap above 2^53. The SessionRecord type structurally cannot hold a
 * private key; assertNoKeyMaterial is a belt-and-suspenders guard.
 */
import { keccak256, toBytes } from "viem";
import type { Address, Hex } from "viem";
import type { RequestedSessionPermissions, SpendPeriod } from "./effective-authority.js";

export interface SessionRecord {
  chainId: number;
  walletAddress: Address;
  /** SEC1 uncompressed public key of the session signer. */
  publicKey: Hex;
  /** Index in the account's permission storage. */
  keyHash: Hex;
  /** Index in the public KeyStore registry. */
  keyId: Hex;
  /** What was requested, with spend limits as decimal strings. Not what is enforced. */
  requestedPermissions: SerializedPermissions;
  expiry: number;
  grantTxHash?: Hex;
  revokeTxHash?: Hex;
  /** Wall-clock seconds when revoke succeeded; absent while the session is live. */
  revokedAt?: number;
}

export interface SerializedCallPermission {
  to?: Address;
  signature?: string;
}

export interface SerializedSpendPermission {
  /** Decimal string. Never a JSON number: a BSC stablecoin cap exceeds 2^53. */
  limit: string;
  period: SpendPeriod;
  token?: Address;
}

export interface SerializedPermissions {
  calls: SerializedCallPermission[];
  spend: SerializedSpendPermission[];
}

/** Convert requested permissions into their lossless persisted form. */
export function serializePermissions(
  permissions: RequestedSessionPermissions,
): SerializedPermissions {
  return {
    calls: (permissions.calls ?? []).map((call) => {
      const serialized: SerializedCallPermission = {};
      if ("to" in call) serialized.to = call.to.toLowerCase() as Address;
      if ("signature" in call) serialized.signature = call.signature;
      return serialized;
    }),
    spend: (permissions.spend ?? []).map((entry) => {
      const serialized: SerializedSpendPermission = {
        limit: entry.limit.toString(10),
        period: entry.period,
      };
      if (entry.token !== undefined) serialized.token = entry.token.toLowerCase() as Address;
      return serialized;
    }),
  };
}

/**
 * Restore permissions in the shape the SDK expects.
 */
export function deserializePermissions(
  permissions: SerializedPermissions,
): RequestedSessionPermissions {
  return {
    calls: permissions.calls.map((call) => {
      if (call.to !== undefined && call.signature !== undefined) {
        return { to: call.to, signature: call.signature };
      }
      if (call.to !== undefined) return { to: call.to };
      if (call.signature !== undefined) return { signature: call.signature };
      throw new Error("A call permission must carry a target, a signature, or both");
    }),
    spend: permissions.spend.map((entry) => {
      const restored: { limit: bigint; period: SpendPeriod; token?: Address } = {
        limit: BigInt(entry.limit),
        period: entry.period,
      };
      if (entry.token !== undefined) restored.token = entry.token;
      return restored;
    }),
  };
}

/**
 * Stable hash of requested permissions + identity fields.
 *
 * Proves byte identity of what LUJAW asked for. It does not prove on-chain
 * enforcement — that comes from reading the account contracts.
 */
export function requestedPermissionsHash(record: {
  chainId: number;
  walletAddress: Address;
  publicKey: Hex;
  requestedPermissions: SerializedPermissions;
  expiry: number;
}): Hex {
  const payload = {
    chainId: record.chainId,
    wallet: record.walletAddress.toLowerCase(),
    publicKey: record.publicKey.toLowerCase(),
    expiry: record.expiry,
    calls: record.requestedPermissions.calls.map((call) => ({
      to: call.to ?? null,
      signature: call.signature ?? null,
    })),
    spend: record.requestedPermissions.spend.map((entry) => ({
      token: entry.token ?? null,
      limit: entry.limit,
      period: entry.period,
    })),
  };
  return keccak256(toBytes(stableStringify(payload)));
}

/** Deterministic JSON with sorted object keys. Rejects non-integer numbers. */
function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new Error(`non-integer number rejected in canonical encoding: ${value}`);
    }
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString(10);
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const out: Record<string, unknown> = {};
    for (const [key, nested] of entries) {
      out[key] = canonicalize(nested);
    }
    return out;
  }
  throw new Error(`unsupported canonical value type: ${typeof value}`);
}

const FORBIDDEN_KEYS = ["privatekey", "privkey", "secretkey", "mnemonic", "seed", "signer"];

/**
 * Assert that a value carries no key material before it is written anywhere.
 */
export function assertNoKeyMaterial(value: unknown, path = "$"): void {
  if (value === null || typeof value !== "object") return;

  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoKeyMaterial(item, `${path}[${index}]`));
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.includes(key.toLowerCase())) {
      throw new Error(`Refusing to persist key material: ${path}.${key}`);
    }
    assertNoKeyMaterial(nested, `${path}.${key}`);
  }
}
