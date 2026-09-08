/**
 * Map reconstructed health to product status.
 */
import type { Reconstruction } from "./accounting.js";
import { parseThresholdToMantissa } from "./thresholds.js";
import type { ProductStatus } from "../schemas/common.js";

export interface StatusAssessment {
  readonly status: ProductStatus;
  readonly healthFactorMantissa: bigint | null;
  readonly reason: string;
}

export function assessProductStatus(
  reconstruction: Reconstruction,
  alertBelow: string,
  interveneBelow: string,
  options: { stale?: boolean } = {},
): StatusAssessment {
  if (options.stale) {
    return {
      status: "INCONCLUSIVE",
      healthFactorMantissa: reconstruction.healthFactorMantissa,
      reason: "observation exceeds freshness limit",
    };
  }
  if (reconstruction.unpriced.length > 0) {
    return {
      status: "INCONCLUSIVE",
      healthFactorMantissa: reconstruction.healthFactorMantissa,
      reason: "unpriced or incomplete exposure",
    };
  }

  const hf = reconstruction.healthFactorMantissa;
  if (hf === null) {
    // No debt: treat as healthy for product status.
    return {
      status: "HEALTHY",
      healthFactorMantissa: null,
      reason: "no borrow; health factor unbounded",
    };
  }

  const alert = parseThresholdToMantissa(alertBelow);
  const intervene = parseThresholdToMantissa(interveneBelow);

  if (hf < intervene) {
    return { status: "AT_RISK", healthFactorMantissa: hf, reason: "below interveneBelow" };
  }
  if (hf < alert) {
    return { status: "WATCH", healthFactorMantissa: hf, reason: "between interveneBelow and alertBelow" };
  }
  return { status: "HEALTHY", healthFactorMantissa: hf, reason: "at or above alertBelow" };
}
