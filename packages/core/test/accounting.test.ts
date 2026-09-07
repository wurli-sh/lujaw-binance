import { describe, expect, it } from "vitest";
import { reconstruct } from "../src/health/accounting.js";
import {
  hasDebtOutsideEnteredMarkets,
  marketsWithDebt,
  marketsWithUnpricedExposure,
} from "../src/venus/observation.js";
import {
  FIXTURE,
  FROZEN,
  MANTISSA,
  VUSDC,
  applyWeight,
  formatMantissa,
  marketAt,
  vTokenToUsdFlooredFirst,
  vTokenToUsdUnfloored,
} from "./fixtures.js";

describe("VENUS-ACCOUNTING-001: getAssetsIn is not the debt universe", () => {
  it("records VAI debt outside entered markets", () => {
    expect(FIXTURE.hasDebtOutsideEnteredMarkets).toBe(true);
    expect(hasDebtOutsideEnteredMarkets(FROZEN)).toBe(true);
    expect(BigInt(FROZEN.vai.repayAmount)).toBeGreaterThan(0n);
    expect(marketsWithDebt(FROZEN)).toHaveLength(0);
  });

  it("keeps principal and repay amount distinct", () => {
    expect(BigInt(FROZEN.vai.repayAmount)).toBeGreaterThan(BigInt(FROZEN.vai.mintedPrincipal));
  });
});

describe("VENUS-ACCOUNTING-002: VAI is charged at par", () => {
  it("reconstructs HF ≈ 2.505467 from weighted collateral / VAI repay", () => {
    const result = reconstruct(FROZEN);
    expect(result.unpriced).toHaveLength(0);
    expect(result.healthFactorMantissa).not.toBeNull();
    expect(formatMantissa(result.healthFactorMantissa!)).toBe("2.505467");
  });

  it("matches Comptroller liquidity within rounding", () => {
    const result = reconstruct(FROZEN);
    const protocolNet =
      BigInt(FROZEN.accountLiquidity.liquidity) - BigInt(FROZEN.accountLiquidity.shortfall);
    const ownNet = result.liquidityUsd - result.shortfallUsd;
    const delta = ownNet > protocolNet ? ownNet - protocolNet : protocolNet - ownNet;
    // Sub-wei to a few wei of drift is acceptable; larger means wrong scale.
    expect(delta).toBeLessThan(MANTISSA / 1_000_000n);
  });
});

describe("VENUS-ACCOUNTING-003: multiply-then-divide vs floor-first", () => {
  it("unfloored vToken USD exceeds or equals the floored path", () => {
    const market = marketAt(FROZEN, VUSDC);
    const balance = BigInt(market.vTokenBalance!);
    const rate = BigInt(market.exchangeRateMantissa!);
    const price = BigInt(market.priceMantissa!);
    const unfloored = vTokenToUsdUnfloored(balance, rate, price);
    const floored = vTokenToUsdFlooredFirst(balance, rate, price);
    expect(unfloored).toBeGreaterThanOrEqual(floored);
  });
});

describe("VENUS-ACCOUNTING-004: fail closed on unpriced exposure", () => {
  it("flags a market with balance and null price", () => {
    const market = marketAt(FROZEN, VUSDC);
    const poisoned = {
      ...FROZEN,
      markets: FROZEN.markets.map((m) =>
        m.vToken === VUSDC
          ? { ...m, priceMantissa: null, priceUnavailableReason: "forced" }
          : m,
      ),
    };
    expect(marketsWithUnpricedExposure(poisoned).some((m) => m.vToken === VUSDC)).toBe(true);
    const result = reconstruct(poisoned);
    expect(result.unpriced.some((u) => u.vToken === VUSDC)).toBe(true);
  });

  it("flags a market with balance and a zero oracle price", () => {
    const poisoned = {
      ...FROZEN,
      markets: FROZEN.markets.map((market) =>
        market.vToken === VUSDC ? { ...market, priceMantissa: "0" } : market,
      ),
    };

    expect(marketsWithUnpricedExposure(poisoned).some((m) => m.vToken === VUSDC)).toBe(true);
    expect(reconstruct(poisoned).unpriced).toContainEqual({
      vToken: VUSDC,
      reason: "the oracle returned a zero price for a market carrying exposure",
    });
  });

  it("flags a market whose balances could not be read", () => {
    const poisoned = {
      ...FROZEN,
      markets: FROZEN.markets.map((market, index) =>
        index === 1
          ? {
              ...market,
              vTokenBalance: null,
              borrowBalance: null,
              exchangeRateMantissa: null,
              balancesUnavailableReason: "forced balance read failure",
            }
          : market,
      ),
    };

    expect(marketsWithUnpricedExposure(poisoned)).toContainEqual(
      expect.objectContaining({ balancesUnavailableReason: "forced balance read failure" }),
    );
    expect(reconstruct(poisoned).unpriced).toContainEqual(
      expect.objectContaining({ reason: "forced balance read failure" }),
    );
  });

  it("flags accrued VAI debt as unknown when its controller read failed", () => {
    const poisoned = {
      ...FROZEN,
      vai: {
        ...FROZEN.vai,
        repayAmount: null,
        repayAmountUnavailableReason: "forced VAI controller failure",
      },
    };

    const result = reconstruct(poisoned);
    expect(result.unpriced).toContainEqual({
      vToken: FROZEN.vai.controller,
      reason: "forced VAI controller failure",
    });
    expect(hasDebtOutsideEnteredMarkets(poisoned)).toBe(true);
  });

  it("flags an accrued VAI amount below its principal as inconsistent", () => {
    const poisoned = {
      ...FROZEN,
      vai: { ...FROZEN.vai, repayAmount: "0" },
    };

    expect(reconstruct(poisoned).unpriced).toContainEqual({
      vToken: FROZEN.vai.controller,
      reason: "accrued VAI repay amount is below minted principal",
    });
  });

  it("weights collateral by liquidation threshold field 4, not collateral factor", () => {
    const market = marketAt(FROZEN, VUSDC);
    const cf = BigInt(market.collateralFactorMantissa!);
    const lt = BigInt(market.liquidationThresholdMantissa!);
    expect(lt).not.toBe(cf);
    const usd = vTokenToUsdUnfloored(
      BigInt(market.vTokenBalance!),
      BigInt(market.exchangeRateMantissa!),
      BigInt(market.priceMantissa!),
    );
    const weighted = applyWeight(usd, lt);
    const result = reconstruct(FROZEN);
    expect(result.weightedCollateralUsd).toBe(weighted);
  });
});
