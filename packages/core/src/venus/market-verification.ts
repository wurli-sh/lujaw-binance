import type { Address } from "viem";
import type {
  RawSupplyMarketObservation,
  RawSupplyObservation,
} from "./supply.js";

export const VENUS_MARKET_VERIFICATION_SCHEMA_VERSION =
  "lujaw.venus-market-verification/1" as const;

export type ObservationCapability = "OBSERVE_VERIFIED" | "INCONCLUSIVE";
export type SupplyCapability = "AVAILABLE" | "UNAVAILABLE" | "INCONCLUSIVE";
export type ExecutionCapability = "EXECUTE_VERIFIED" | "NOT_VERIFIED";

export interface VenusMarketCapability {
  readonly symbol: string;
  readonly vToken: Address;
  readonly underlying: Address;
  readonly underlyingDecimals: number;
  readonly implementation: Address | null;
  readonly observation: ObservationCapability;
  readonly supply: SupplyCapability;
  readonly execution: ExecutionCapability;
  readonly supplyRatePerBlockMantissa: string | null;
  readonly priceMantissa: string | null;
  readonly supplyCapRaw: string | null;
  readonly suppliedRaw: string | null;
  readonly remainingSupplyCapacityRaw: string | null;
  readonly walletUnderlyingBalanceRaw: string | null;
  readonly walletAllowanceRaw: string | null;
  readonly walletVTokenBalanceRaw: string | null;
  readonly reasons: readonly string[];
}

export interface VenusMarketVerification {
  readonly schemaVersion: typeof VENUS_MARKET_VERIFICATION_SCHEMA_VERSION;
  readonly chainId: number;
  readonly account: Address;
  readonly blockNumber: string;
  readonly blockHash: `0x${string}`;
  readonly markets: readonly VenusMarketCapability[];
}

function suppliedUnderlyingRaw(market: RawSupplyMarketObservation): bigint | null {
  if (market.totalSupplyVTokens === null || market.exchangeRateMantissa === null) return null;
  return (
    (BigInt(market.totalSupplyVTokens) * BigInt(market.exchangeRateMantissa)) /
    10n ** 18n
  );
}

function assessMarket(
  market: RawSupplyMarketObservation,
  executeVerifiedVToken?: Address,
): VenusMarketCapability {
  const reasons: string[] = [];
  const supplied = suppliedUnderlyingRaw(market);
  const cap = market.supplyCapRaw === null ? null : BigInt(market.supplyCapRaw);

  if (market.metadataUnavailableReason !== undefined) reasons.push("METADATA_UNREADABLE");
  if (market.rateUnavailableReason !== undefined) reasons.push("RATE_UNREADABLE");
  if (market.balancesUnavailableReason !== undefined) reasons.push("BALANCES_UNREADABLE");
  if (market.priceUnavailableReason !== undefined || market.priceMantissa === null) {
    reasons.push("PRICE_UNREADABLE");
  } else if (BigInt(market.priceMantissa) === 0n) {
    reasons.push("ZERO_PRICE");
  }
  if (market.implementation === null) reasons.push("IMPLEMENTATION_UNREADABLE");
  if (
    market.reportedUnderlyingDecimals !== null &&
    market.reportedUnderlyingDecimals !== market.underlyingDecimals
  ) {
    reasons.push("DECIMALS_MISMATCH");
  }

  const observation: ObservationCapability = reasons.length === 0
    ? "OBSERVE_VERIFIED"
    : "INCONCLUSIVE";

  let supply: SupplyCapability = "INCONCLUSIVE";
  if (market.isListed === false) reasons.push("NOT_LISTED");
  if (market.mintPaused === true) reasons.push("MINT_PAUSED");
  if (cap === 0n) reasons.push("ZERO_SUPPLY_CAP");
  if (cap !== null && cap > 0n && supplied !== null && supplied >= cap) {
    reasons.push("SUPPLY_CAP_REACHED");
  }

  const unavailable = reasons.some((reason) =>
    ["NOT_LISTED", "MINT_PAUSED", "ZERO_SUPPLY_CAP", "SUPPLY_CAP_REACHED"].includes(reason),
  );
  if (unavailable) {
    supply = "UNAVAILABLE";
  } else if (
    observation === "OBSERVE_VERIFIED" &&
    market.isListed === true &&
    market.mintPaused === false &&
    cap !== null &&
    supplied !== null
  ) {
    supply = "AVAILABLE";
  }

  const execution: ExecutionCapability =
    executeVerifiedVToken !== undefined &&
    executeVerifiedVToken.toLowerCase() === market.vToken.toLowerCase() &&
    supply === "AVAILABLE"
      ? "EXECUTE_VERIFIED"
      : "NOT_VERIFIED";

  return {
    symbol: market.symbol,
    vToken: market.vToken,
    underlying: market.underlying,
    underlyingDecimals: market.underlyingDecimals,
    implementation: market.implementation,
    observation,
    supply,
    execution,
    supplyRatePerBlockMantissa: market.supplyRatePerBlockMantissa,
    priceMantissa: market.priceMantissa,
    supplyCapRaw: market.supplyCapRaw,
    suppliedRaw: supplied?.toString(10) ?? null,
    remainingSupplyCapacityRaw:
      cap === null || supplied === null || cap <= supplied
        ? null
        : (cap - supplied).toString(10),
    walletUnderlyingBalanceRaw: market.walletUnderlyingBalance,
    walletAllowanceRaw: market.walletAllowance,
    walletVTokenBalanceRaw: market.vTokenBalance,
    reasons,
  };
}

export function verifyVenusSupplyMarkets(
  observation: RawSupplyObservation,
  options: { executeVerifiedVToken?: Address } = {},
): VenusMarketVerification {
  return {
    schemaVersion: VENUS_MARKET_VERIFICATION_SCHEMA_VERSION,
    chainId: observation.chainId,
    account: observation.account,
    blockNumber: observation.blockNumber,
    blockHash: observation.blockHash,
    markets: observation.markets.map((market) =>
      assessMarket(market, options.executeVerifiedVToken),
    ),
  };
}
