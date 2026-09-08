/**
 * Requested authority is not effective authority.
 *
 * Porto rewrites session permissions before they reach the chain — notably by
 * appending a wildcard-selector Orchestrator call permission. Comparing the
 * requested object to on-chain `canExecutePackedInfos` / `spendInfos` is what
 * keeps Gate 0 honest.
 *
 * LUJAW does not rebuild MANDATE's AuthorityIR; it only diffs and blocks on
 * CRITICAL discrepancies.
 */
import { toFunctionSelector } from "viem";
import type { Address, Hex } from "viem";
import { ANY_FN_SEL, ANY_TARGET } from "./constants.js";
import type { EnforcedAuthority, EnforcedCallRule } from "./account-reads.js";

export type SpendPeriod = "minute" | "hour" | "day" | "week" | "month" | "year";

export type RequestedCallPermission =
  | { to: Address; signature: string }
  | { signature: string }
  | { to: Address };

export interface RequestedSpendPermission {
  limit: bigint;
  period: SpendPeriod;
  /** Omitted for the native token. */
  token?: Address;
}

export interface RequestedSessionPermissions {
  calls?: readonly RequestedCallPermission[];
  spend?: readonly RequestedSpendPermission[];
}

const NATIVE_TOKEN: Address = "0x0000000000000000000000000000000000000000";

/**
 * Normalise a requested call permission into the `(target, selector)` pair the
 * account will actually store.
 */
export function normalizeRequestedCall(permission: RequestedCallPermission): {
  target: Address;
  selector: Hex;
} {
  const target = "to" in permission ? (permission.to.toLowerCase() as Address) : ANY_TARGET;

  if (!("signature" in permission)) return { target, selector: ANY_FN_SEL };

  const { signature } = permission;
  const selector = /^0x[0-9a-fA-F]{8}$/.test(signature)
    ? (signature.toLowerCase() as Hex)
    : toFunctionSelector(signature);

  return { target, selector };
}

export const DISCREPANCY_CODES = [
  "UNREQUESTED_CALL_RULE",
  "MISSING_REQUESTED_CALL_RULE",
  "WILDCARD_TARGET",
  "WILDCARD_SELECTOR",
  "WALLET_WIDE_RULE",
  "UNREQUESTED_SPEND_LIMIT",
  "SPEND_LIMIT_ENLARGED",
  "SPEND_LIMIT_REDUCED",
  "MISSING_REQUESTED_SPEND_LIMIT",
  "SUPER_ADMIN_KEY",
  "KEY_NOT_REGISTERED",
  "EXPIRY_MISMATCH",
] as const;

export type DiscrepancyCode = (typeof DISCREPANCY_CODES)[number];

export type DiscrepancySeverity = "CRITICAL" | "DISCLOSE" | "INFO";

export interface AuthorityDiscrepancy {
  code: DiscrepancyCode;
  severity: DiscrepancySeverity;
  message: string;
  target?: Address;
  selector?: Hex;
  token?: Address;
}

const CRITICAL_CODES: readonly DiscrepancyCode[] = [
  "WILDCARD_TARGET",
  "WILDCARD_SELECTOR",
  "SUPER_ADMIN_KEY",
  "KEY_NOT_REGISTERED",
  "UNREQUESTED_SPEND_LIMIT",
  "SPEND_LIMIT_ENLARGED",
  "WALLET_WIDE_RULE",
];

function ruleKey(target: Address, selector: Hex): string {
  return `${target.toLowerCase()}|${selector.toLowerCase()}`;
}

/** Is this enforced rule the Orchestrator permission Porto adds to every session? */
export function isOrchestratorRule(rule: EnforcedCallRule, orchestrator: Address): boolean {
  return rule.target === orchestrator.toLowerCase() && rule.selectorIsWildcard;
}

export interface DiscrepancyContext {
  orchestrator: Address;
  requestedExpiry?: number;
}

/**
 * Compare what was asked for against what the chain enforces.
 */
export function diffRequestedVsEnforced(
  requested: RequestedSessionPermissions,
  enforced: EnforcedAuthority,
  context: DiscrepancyContext,
): AuthorityDiscrepancy[] {
  const discrepancies: AuthorityDiscrepancy[] = [];
  const add = (
    code: DiscrepancyCode,
    message: string,
    extra: Omit<AuthorityDiscrepancy, "code" | "severity" | "message"> = {},
    severity?: DiscrepancySeverity,
  ): void => {
    discrepancies.push({
      code,
      severity: severity ?? (CRITICAL_CODES.includes(code) ? "CRITICAL" : "DISCLOSE"),
      message,
      ...extra,
    });
  };

  if (!enforced.registered) {
    add("KEY_NOT_REGISTERED", "The account holds no key with this hash, so nothing is enforced");
    return discrepancies;
  }

  if (enforced.isSuperAdmin) {
    add(
      "SUPER_ADMIN_KEY",
      "This key is a super admin. Call and spend restrictions are not applied to it at all",
    );
    return discrepancies;
  }

  const requestedRules = new Map<string, { target: Address; selector: Hex }>();
  for (const permission of requested.calls ?? []) {
    const normalized = normalizeRequestedCall(permission);
    requestedRules.set(ruleKey(normalized.target, normalized.selector), normalized);
  }

  const enforcedKeys = new Set(enforced.callRules.map((rule) => ruleKey(rule.target, rule.selector)));

  for (const rule of enforced.callRules) {
    if (rule.targetIsWildcard) {
      add("WILDCARD_TARGET", "A rule permits every contract on the chain", {
        target: rule.target,
        selector: rule.selector,
      });
      continue;
    }

    const known = requestedRules.has(ruleKey(rule.target, rule.selector));

    if (!known) {
      if (isOrchestratorRule(rule, context.orchestrator)) {
        add(
          "UNREQUESTED_CALL_RULE",
          `The wallet layer added a wildcard-selector permission for the Orchestrator at ${rule.target}. Every session key receives this; it is required for the session to submit anything at all, and it was not requested by LUJAW`,
          { target: rule.target, selector: rule.selector },
        );
      } else if (rule.selectorIsWildcard) {
        add("WILDCARD_SELECTOR", `Every method on ${rule.target} is permitted`, {
          target: rule.target,
          selector: rule.selector,
        });
      } else {
        add(
          "UNREQUESTED_CALL_RULE",
          `The account enforces a rule for ${rule.target} that was never requested`,
          { target: rule.target, selector: rule.selector },
          "CRITICAL",
        );
      }
      continue;
    }

    if (rule.selectorIsWildcard) {
      add("WILDCARD_SELECTOR", `Every method on ${rule.target} is permitted`, {
        target: rule.target,
        selector: rule.selector,
      });
    }
  }

  for (const [key, rule] of requestedRules) {
    if (!enforcedKeys.has(key)) {
      add(
        "MISSING_REQUESTED_CALL_RULE",
        `${rule.selector} on ${rule.target} was requested but the account does not enforce it, so the session cannot make this call`,
        { target: rule.target, selector: rule.selector },
      );
    }
  }

  for (const rule of enforced.walletWideRules) {
    add(
      "WALLET_WIDE_RULE",
      `A wallet-wide rule permits ${rule.selector} on ${rule.target} for every key on this account, including this session`,
      { target: rule.target, selector: rule.selector },
    );
  }

  const requestedSpend = new Map<string, RequestedSpendPermission>();
  for (const permission of requested.spend ?? []) {
    const token = (permission.token ?? NATIVE_TOKEN).toLowerCase() as Address;
    requestedSpend.set(`${token}|${permission.period}`, permission);
  }

  for (const limit of enforced.spendLimits) {
    const key = `${limit.token}|${limit.period}`;
    const match = requestedSpend.get(key);

    if (match === undefined) {
      add(
        "UNREQUESTED_SPEND_LIMIT",
        `The account enforces a ${limit.period} cap of ${limit.limit} on ${limit.token} that was never requested`,
        { token: limit.token },
      );
      continue;
    }

    if (limit.limit > match.limit) {
      add(
        "SPEND_LIMIT_ENLARGED",
        `The enforced ${limit.period} cap on ${limit.token} is ${limit.limit}, above the requested ${match.limit}`,
        { token: limit.token },
      );
    } else if (limit.limit < match.limit) {
      add(
        "SPEND_LIMIT_REDUCED",
        `The enforced ${limit.period} cap on ${limit.token} is ${limit.limit}, below the requested ${match.limit}`,
        { token: limit.token },
      );
    }
  }

  for (const [key, permission] of requestedSpend) {
    const token = key.split("|")[0] as Address;
    if (!enforced.spendLimits.some((limit) => `${limit.token}|${limit.period}` === key)) {
      add(
        "MISSING_REQUESTED_SPEND_LIMIT",
        `A ${permission.period} cap on ${token} was requested but is not enforced, so the session cannot move this token at all`,
        { token },
      );
    }
  }

  if (context.requestedExpiry !== undefined && context.requestedExpiry !== enforced.expiry) {
    add(
      "EXPIRY_MISMATCH",
      `The account expires this key at ${enforced.expiry}, not the requested ${context.requestedExpiry}`,
      {},
      enforced.expiry === 0 || enforced.expiry > context.requestedExpiry ? "CRITICAL" : "DISCLOSE",
    );
  }

  return discrepancies;
}

/** True when at least one discrepancy makes the displayed boundary untrustworthy. */
export function hasCriticalDiscrepancy(discrepancies: readonly AuthorityDiscrepancy[]): boolean {
  return discrepancies.some((discrepancy) => discrepancy.severity === "CRITICAL");
}
