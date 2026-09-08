import { describe, expect, it } from "vitest";
import {
  verifyVenusSupplyMarkets,
  type RawSupplyMarketObservation,
  type RawSupplyObservation,
} from "../src/index.js";

const account = "0x4444444444444444444444444444444444444444" as const;
const vToken = "0x1111111111111111111111111111111111111111" as const;
const underlying = "0x2222222222222222222222222222222222222222" as const;

function market(
  overrides: Partial<RawSupplyMarketObservation> = {},
): RawSupplyMarketObservation {
  return {
    vToken,
    underlying,
    symbol: "USDC",
    underlyingDecimals: 6,
    reportedUnderlyingDecimals: 6,
    isListed: true,
    mintPaused: false,
    supplyCapRaw: "100000000",
    supplyRatePerBlockMantissa: "100",
    exchangeRateMantissa: "2000000000000000000",
    totalSupplyVTokens: "10000000",
    cashRaw: "10000000",
    totalBorrowsRaw: "10000000",
    totalReservesRaw: "0",
    vTokenBalance: "0",
    walletUnderlyingBalance: "0",
    walletAllowance: "0",
    priceMantissa: "1000000000000000000000000000000",
    implementation: "0x3333333333333333333333333333333333333333",
    ...overrides,
  };
}

function observation(markets: RawSupplyMarketObservation[]): RawSupplyObservation {
  return {
    schemaVersion: "lujaw.venus-supply-observation/1",
    chainId: 97,
    account,
    blockNumber: "123",
    blockHash: `0x${"ab".repeat(32)}`,
    comptroller: "0x5555555555555555555555555555555555555555",
    markets,
  };
}

describe("Venus market capability verification", () => {
  it("separates observed, available, and execution-verified capability", () => {
    const result = verifyVenusSupplyMarkets(observation([market()]), {
      executeVerifiedVToken: vToken,
    });
    expect(result.markets[0]).toMatchObject({
      observation: "OBSERVE_VERIFIED",
      supply: "AVAILABLE",
      execution: "EXECUTE_VERIFIED",
      suppliedRaw: "20000000",
      remainingSupplyCapacityRaw: "80000000",
      reasons: [],
    });
  });

  it("reports a readable retired market as unavailable without enabling execution", () => {
    const result = verifyVenusSupplyMarkets(
      observation([market({ symbol: "BUSD", mintPaused: true, supplyCapRaw: "0" })]),
      { executeVerifiedVToken: vToken },
    );
    expect(result.markets[0]).toMatchObject({
      observation: "OBSERVE_VERIFIED",
      supply: "UNAVAILABLE",
      execution: "NOT_VERIFIED",
      reasons: ["MINT_PAUSED", "ZERO_SUPPLY_CAP"],
    });
  });

  it("fails observation closed on decimal disagreement", () => {
    const result = verifyVenusSupplyMarkets(
      observation([market({ reportedUnderlyingDecimals: 18 })]),
    );
    expect(result.markets[0]).toMatchObject({
      observation: "INCONCLUSIVE",
      supply: "INCONCLUSIVE",
      execution: "NOT_VERIFIED",
      reasons: ["DECIMALS_MISMATCH"],
    });
  });
});
