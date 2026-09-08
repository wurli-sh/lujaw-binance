/**
 * Deterministic collateral top-up sizing for the locked Venus market.
 */
import type { Address } from "viem";
import { BPS_DENOMINATOR, TOP_UP_BUFFER_BPS } from "./constants.js";
import type { Reconstruction } from "./health/accounting.js";
import { MANTISSA, applyWeight, fromUsd, toUsd } from "./health/scale.js";
import { parseThresholdToMantissa } from "./health/thresholds.js";
import type { CarePlan } from "./schemas/plan.js";
import type { RawVenusObservation } from "./venus/observation.js";

export interface TopUpCalculation {
  readonly unbufferedRaw: bigint;
  readonly bufferedRaw: bigint;
  readonly requiredCollateralUsd: bigint;
  readonly projectedHealthFactorMantissa: bigint | null;
  readonly liquidationThresholdMantissa: bigint;
  readonly priceMantissa: bigint;
  readonly repairMarketEntered: boolean;
}

export function calculateTopUp(
  observation: RawVenusObservation,
  reconstruction: Reconstruction,
  plan: CarePlan,
  repairVToken: Address,
): TopUpCalculation {
  const market = observation.markets.find(
    (entry) => entry.vToken.toLowerCase() === repairVToken.toLowerCase(),
  );
  if (
    market === undefined ||
    market.priceMantissa === null ||
    market.liquidationThresholdMantissa === null ||
    market.underlyingDecimals === null
  ) {
    throw new Error("repair market facts missing from observation");
  }

  const price = BigInt(market.priceMantissa);
  const lambda = BigInt(market.liquidationThresholdMantissa);
  const restore = parseThresholdToMantissa(plan.restoreTo);
  const borrow = reconstruction.totalBorrowUsd;
  const weighted = reconstruction.weightedCollateralUsd;

  if (borrow === 0n) {
    return {
      unbufferedRaw: 0n,
      bufferedRaw: 0n,
      requiredCollateralUsd: 0n,
      projectedHealthFactorMantissa: null,
      liquidationThresholdMantissa: lambda,
      priceMantissa: price,
      repairMarketEntered: market.entered,
    };
  }

  // required additional collateral value
  //   = max(0, (restore * borrow - weighted) / lambda)
  const targetWeighted = (restore * borrow + MANTISSA - 1n) / MANTISSA;
  const deficit = targetWeighted > weighted ? targetWeighted - weighted : 0n;
  const requiredCollateralUsd =
    deficit === 0n ? 0n : (deficit * MANTISSA + lambda - 1n) / lambda;

  const unbufferedRaw = requiredCollateralUsd === 0n ? 0n : fromUsd(requiredCollateralUsd, price);
  let bufferedRaw = unbufferedRaw;
  if (unbufferedRaw > 0n) {
    bufferedRaw = (unbufferedRaw * (BPS_DENOMINATOR + TOP_UP_BUFFER_BPS) + BPS_DENOMINATOR - 1n) /
      BPS_DENOMINATOR;
    if (bufferedRaw < unbufferedRaw + 1n) bufferedRaw = unbufferedRaw + 1n;
  }

  const addedUsd = bufferedRaw === 0n ? 0n : toUsd(bufferedRaw, price);
  const addedWeighted = applyWeight(addedUsd, lambda);
  const projectedWeighted = weighted + addedWeighted;
  const projectedHealthFactorMantissa =
    borrow === 0n ? null : (projectedWeighted * MANTISSA) / borrow;

  return {
    unbufferedRaw,
    bufferedRaw,
    requiredCollateralUsd,
    projectedHealthFactorMantissa,
    liquidationThresholdMantissa: lambda,
    priceMantissa: price,
    repairMarketEntered: market.entered,
  };
}
