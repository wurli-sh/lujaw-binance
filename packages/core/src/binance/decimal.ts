/**
 * Exact decimal arithmetic for Binance Spot — no JavaScript floats.
 * Internal representation: integer scaled by 10^SCALE.
 */
export const DECIMAL_SCALE = 18;
const TEN = 10n;
const SCALE_FACTOR = TEN ** BigInt(DECIMAL_SCALE);

export class DecimalParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecimalParseError";
  }
}

const STRICT_DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

export function parseScaled(input: string): bigint {
  if (typeof input !== "string") {
    throw new DecimalParseError("decimal must be a string");
  }
  if (input.trim() !== input || /\s/.test(input)) {
    throw new DecimalParseError("whitespace not allowed");
  }
  if (!STRICT_DECIMAL.test(input)) {
    throw new DecimalParseError(`invalid decimal: ${input}`);
  }
  const parts = input.split(".");
  const wholePart = parts[0] ?? "0";
  const fracPart = parts[1] ?? "";
  if (fracPart.length > DECIMAL_SCALE) {
    throw new DecimalParseError(`over-precision: ${input}`);
  }
  const whole = BigInt(wholePart);
  const fracPadded = (fracPart + "0".repeat(DECIMAL_SCALE)).slice(0, DECIMAL_SCALE);
  return whole * SCALE_FACTOR + BigInt(fracPadded || "0");
}

export function formatScaled(value: bigint, maxFracDigits = DECIMAL_SCALE): string {
  if (value < 0n) {
    throw new DecimalParseError("negative values are not supported");
  }
  const whole = value / SCALE_FACTOR;
  let frac = (value % SCALE_FACTOR).toString().padStart(DECIMAL_SCALE, "0");
  if (maxFracDigits < DECIMAL_SCALE) {
    frac = frac.slice(0, maxFracDigits);
  }
  frac = frac.replace(/0+$/, "");
  return frac.length === 0 ? whole.toString(10) : `${whole.toString(10)}.${frac}`;
}

export function cmpScaled(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minScaled(...values: bigint[]): bigint {
  if (values.length === 0) throw new DecimalParseError("min requires values");
  return values.reduce((acc, v) => (v < acc ? v : acc));
}

export function maxScaled(...values: bigint[]): bigint {
  if (values.length === 0) throw new DecimalParseError("max requires values");
  return values.reduce((acc, v) => (v > acc ? v : acc));
}

export function addScaled(a: bigint, b: bigint): bigint {
  return a + b;
}

export function subScaled(a: bigint, b: bigint): bigint {
  if (a < b) throw new DecimalParseError("subtraction underflow");
  return a - b;
}

/** Floor(a * b / SCALE_FACTOR) */
export function mulScaled(a: bigint, b: bigint): bigint {
  return (a * b) / SCALE_FACTOR;
}

/** Floor(a * SCALE_FACTOR / b) */
export function divScaledDown(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new DecimalParseError("division by zero");
  return (a * SCALE_FACTOR) / b;
}

/** Ceil(a * SCALE_FACTOR / b) */
export function divScaledUp(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new DecimalParseError("division by zero");
  return (a * SCALE_FACTOR + b - 1n) / b;
}

/** Round down to nearest multiple of step (both scaled). */
export function roundDownToStep(value: bigint, step: bigint): bigint {
  if (step <= 0n) throw new DecimalParseError("step must be positive");
  return (value / step) * step;
}

/** Round up to nearest multiple of step (both scaled). */
export function roundUpToStep(value: bigint, step: bigint): bigint {
  if (step <= 0n) throw new DecimalParseError("step must be positive");
  const q = value / step;
  return value % step === 0n ? value : (q + 1n) * step;
}

/** Apply bps: floor(value * bps / 10_000) */
export function applyBpsDown(value: bigint, bps: number): bigint {
  if (!Number.isInteger(bps) || bps < 0) {
    throw new DecimalParseError("bps must be a non-negative integer");
  }
  return (value * BigInt(bps)) / 10_000n;
}

/** Apply bps: ceil(value * bps / 10_000) */
export function applyBpsUp(value: bigint, bps: number): bigint {
  if (!Number.isInteger(bps) || bps < 0) {
    throw new DecimalParseError("bps must be a non-negative integer");
  }
  return (value * BigInt(bps) + 9_999n) / 10_000n;
}

/** bps = floor((numerator - denominator) * 10000 / denominator) relative to reference */
export function slippageBpsFromPrices(fillPrice: bigint, referencePrice: bigint): number {
  if (referencePrice <= 0n) throw new DecimalParseError("reference price must be positive");
  if (fillPrice < referencePrice) return 0;
  const diff = fillPrice - referencePrice;
  const bps = (diff * 10_000n) / referencePrice;
  if (bps > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new DecimalParseError("slippage bps overflow");
  }
  return Number(bps);
}

export function isZeroScaled(value: bigint): boolean {
  return value === 0n;
}

export function assertFiniteDecimalString(input: string): void {
  parseScaled(input);
}
