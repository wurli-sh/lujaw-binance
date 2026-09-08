/**
 * Conservative demo Spot policy ceilings for the hackathon Agentic sub-account.
 */
export const DEMO_SPOT_CEILINGS = {
  maxOrderNotional: "25",
  maxDailyGrossNotional: "50",
  minQuoteReserve: "5",
  maxAssetConcentrationBps: 5_000,
  maxEstimatedSlippageBps: 50,
  feeBufferBps: 20,
  minValuationCoverageBps: 9_900,
  authorizationTtlSeconds: 60,
  allowedSymbols: ["BNBUSDT"] as const,
} as const;

export const DEMO_SPOT_PRESET_NAME = "demo" as const;
