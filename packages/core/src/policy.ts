/**
 * Pure rescue policy evaluator.
 */
import type { Address, Hex } from "viem";
import { MINT_SELECTOR } from "./venus/abis.js";
import type { AuthorityDiscrepancy } from "./altana/effective-authority.js";
import { hasCriticalDiscrepancy } from "./altana/effective-authority.js";
import type { EnforcedAuthority } from "./altana/account-reads.js";
import { MAX_OBSERVATION_AGE_BLOCKS } from "./constants.js";
import { isObservationFresh } from "./freshness.js";
import type { Reconstruction } from "./health/accounting.js";
import { assessProductStatus } from "./health/status.js";
import { parseThresholdToMantissa } from "./health/thresholds.js";
import type { ReasonCode } from "./schemas/common.js";
import type { CarePlan } from "./schemas/plan.js";
import type { TopUpCalculation } from "./topup.js";
import type { RawVenusObservation } from "./venus/observation.js";

export type RescueDecisionKind = "EXECUTE" | "HOLD" | "BLOCK";

export interface SessionPolicyState {
  readonly present: boolean;
  readonly wallet: Address;
  readonly expectedWallet: Address;
  readonly expiresAt: number;
  readonly registered: boolean;
  readonly tokenSpendRemaining: bigint | null;
  readonly enforced: EnforcedAuthority | null;
  readonly discrepancies: readonly AuthorityDiscrepancy[];
  readonly actionsConsumed: number;
}

export interface RescueDecision {
  readonly kind: RescueDecisionKind;
  readonly reason: ReasonCode;
  readonly productStatus: ReturnType<typeof assessProductStatus>["status"];
  readonly topUpRaw: bigint;
  readonly projectedHealthFactorMantissa: bigint | null;
  readonly message: string;
}

export function evaluateRescue(input: {
  observation: RawVenusObservation;
  reconstruction: Reconstruction;
  plan: CarePlan;
  topUp: TopUpCalculation;
  headBlock: bigint;
  nowSeconds: number;
  session: SessionPolicyState;
  repairVToken: Address;
  preparedTarget?: Address;
  preparedSelector?: Hex;
  /** When false, treat as stale (pinned block hash re-read mismatch). */
  observationPinValid?: boolean;
}): RescueDecision {
  const staleByAge = !isObservationFresh(
    BigInt(input.observation.blockNumber),
    input.headBlock,
    MAX_OBSERVATION_AGE_BLOCKS,
  );
  const staleByHash = input.observationPinValid === false;
  const stale = staleByAge || staleByHash;
  const status = assessProductStatus(
    input.reconstruction,
    input.plan.alertBelow,
    input.plan.interveneBelow,
    { stale },
  );

  if (stale) {
    return block(
      "OBSERVATION_STALE",
      status.status,
      staleByHash
        ? "observation block hash mismatch on re-read"
        : "observation exceeds freshness limit",
    );
  }
  if (status.status === "INCONCLUSIVE") {
    return block("OBSERVATION_INCONCLUSIVE", status.status, status.reason);
  }
  if (status.status === "HEALTHY") {
    return hold("HEALTHY_NO_REPAIR", status.status, "position at or above alert threshold");
  }
  if (status.status === "WATCH") {
    return hold("WATCH_NO_REPAIR", status.status, "position between intervene and alert thresholds");
  }
  if (!input.topUp.repairMarketEntered) {
    return block(
      "REPAIR_MARKET_NOT_ENTERED",
      status.status,
      "repair collateral market is not entered; mint would not improve liquidation health",
    );
  }
  if (input.session.actionsConsumed >= input.plan.maxActions) {
    return block("ACTION_ALREADY_CONSUMED", status.status, "Care Plan maxActions already consumed");
  }

  // AT_RISK
  if (!input.session.present || input.session.enforced === null) {
    return block("SESSION_MISSING", status.status, "no active Altana session");
  }
  if (input.session.wallet.toLowerCase() !== input.session.expectedWallet.toLowerCase()) {
    return block("SESSION_WRONG_WALLET", status.status, "session wallet does not match account");
  }
  if (!input.session.registered) {
    return block("SESSION_REVOKED", status.status, "session is not registered on-chain");
  }
  if (input.nowSeconds >= input.session.expiresAt || input.nowSeconds >= input.plan.sessionExpiresAt) {
    return block("SESSION_EXPIRED", status.status, "session or plan expiry has passed");
  }
  if (hasCriticalDiscrepancy(input.session.discrepancies)) {
    return block(
      "AUTHORITY_CRITICAL_DISCREPANCY",
      status.status,
      "effective authority has a CRITICAL discrepancy",
    );
  }

  if (input.topUp.bufferedRaw <= 0n) {
    return block("TOP_UP_ZERO", status.status, "calculated top-up is zero");
  }
  if (input.topUp.bufferedRaw > BigInt(input.plan.maxTopUpRaw)) {
    return block("TOP_UP_EXCEEDS_PLAN", status.status, "buffered top-up exceeds Care Plan cap");
  }
  if (
    input.session.tokenSpendRemaining !== null &&
    input.topUp.bufferedRaw > input.session.tokenSpendRemaining
  ) {
    return block("TOP_UP_EXCEEDS_SESSION", status.status, "buffered top-up exceeds session spend remaining");
  }

  const restore = parseThresholdToMantissa(input.plan.restoreTo);
  if (
    input.topUp.projectedHealthFactorMantissa === null ||
    input.topUp.projectedHealthFactorMantissa < restore
  ) {
    return block(
      "PROJECTED_TARGET_NOT_REACHED",
      status.status,
      "buffered top-up does not project reaching restoreTo",
    );
  }

  if (input.preparedTarget !== undefined && input.preparedSelector !== undefined) {
    if (
      input.preparedTarget.toLowerCase() !== input.repairVToken.toLowerCase() ||
      input.preparedSelector.toLowerCase() !== MINT_SELECTOR.toLowerCase()
    ) {
      return block(
        "UNEXPECTED_TARGET_OR_SELECTOR",
        status.status,
        "prepared call is not the locked mint(uint256) on vToken",
      );
    }
  }

  return {
    kind: "EXECUTE",
    reason: "BELOW_INTERVENTION_THRESHOLD",
    productStatus: status.status,
    topUpRaw: input.topUp.bufferedRaw,
    projectedHealthFactorMantissa: input.topUp.projectedHealthFactorMantissa,
    message: "position below interveneBelow; buffered top-up authorized",
  };
}

function hold(
  reason: ReasonCode,
  productStatus: RescueDecision["productStatus"],
  message: string,
): RescueDecision {
  return {
    kind: "HOLD",
    reason,
    productStatus,
    topUpRaw: 0n,
    projectedHealthFactorMantissa: null,
    message,
  };
}

function block(
  reason: ReasonCode,
  productStatus: RescueDecision["productStatus"],
  message: string,
): RescueDecision {
  return {
    kind: "BLOCK",
    reason,
    productStatus,
    topUpRaw: 0n,
    projectedHealthFactorMantissa: null,
    message,
  };
}
