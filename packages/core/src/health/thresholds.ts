/**
 * Convert Care Plan threshold decimal strings to 1e18 mantissas without floats.
 */
import { MANTISSA } from "../health/scale.js";

export class ThresholdParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ThresholdParseError";
  }
}

/**
 * Parse a non-negative decimal string like "1.60" into a 1e18 fixed-point bigint.
 */
export function parseThresholdToMantissa(value: string): bigint {
  if (!/^\d+(\.\d+)?$/.test(value)) {
    throw new ThresholdParseError(`invalid threshold decimal: ${value}`);
  }
  const [wholePart, fractionPart = ""] = value.split(".");
  if (fractionPart.length > 18) {
    throw new ThresholdParseError(`threshold has more than 18 fractional digits: ${value}`);
  }
  const whole = BigInt(wholePart ?? "0");
  const fracPadded = `${fractionPart}${"0".repeat(18 - fractionPart.length)}`;
  return whole * MANTISSA + BigInt(fracPadded);
}

export function formatMantissaThreshold(value: bigint, places = 6): string {
  const whole = value / MANTISSA;
  const fraction = (value % MANTISSA).toString(10).padStart(18, "0").slice(0, places);
  return `${whole}.${fraction}`;
}
