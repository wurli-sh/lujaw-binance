/**
 * Independent scale arithmetic for fixture regressions.
 * Deliberately duplicated from health/scale so tests do not self-certify.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Address } from "viem";
import type { RawMarketObservation, RawVenusObservation } from "../src/venus/observation.js";

export interface FrozenFixture {
  readonly invariant: string;
  readonly provenance: {
    readonly chainId: number;
    readonly account: string;
    readonly blockNumber: string;
    readonly blockHash: string;
  };
  readonly observation: RawVenusObservation;
  readonly brokenView: { readonly vaiDebtMissed: string; readonly principalUnderstatement: string };
  readonly hasDebtOutsideEnteredMarkets: boolean;
}

const here = dirname(fileURLToPath(import.meta.url));

export const FIXTURE = JSON.parse(
  readFileSync(join(here, "..", "..", "..", "fixtures", "venus-accounting-001.json"), "utf8"),
) as FrozenFixture;

export const FROZEN: RawVenusObservation = FIXTURE.observation;

export const VUSDC: Address = "0xd5c4c2e2facbeb59d0216d0595d63fcdc6f9a1a7";

export const MANTISSA = 10n ** 18n;

export function marketAt(observation: RawVenusObservation, vToken: Address): RawMarketObservation {
  const market = observation.markets.find((candidate) => candidate.vToken === vToken);
  if (market === undefined) throw new Error(`fixture has no market ${vToken}`);
  return market;
}

export function oracleScaleFor(decimals: number): bigint {
  return 10n ** BigInt(36 - decimals);
}

export function vTokenToUsdUnfloored(
  vTokenBalance: bigint,
  exchangeRateMantissa: bigint,
  priceMantissa: bigint,
): bigint {
  return (vTokenBalance * exchangeRateMantissa * priceMantissa) / (MANTISSA * MANTISSA);
}

export function vTokenToUsdFlooredFirst(
  vTokenBalance: bigint,
  exchangeRateMantissa: bigint,
  priceMantissa: bigint,
): bigint {
  const underlying = (vTokenBalance * exchangeRateMantissa) / MANTISSA;
  return (underlying * priceMantissa) / MANTISSA;
}

export function applyWeight(usdMantissa: bigint, weightMantissa: bigint): bigint {
  return (usdMantissa * weightMantissa) / MANTISSA;
}

export function formatMantissa(value: bigint, places = 6): string {
  const whole = value / MANTISSA;
  const fraction = (value % MANTISSA).toString(10).padStart(18, "0").slice(0, places);
  return `${whole}.${fraction}`;
}
