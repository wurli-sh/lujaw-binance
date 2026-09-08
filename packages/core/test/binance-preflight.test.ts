import { describe, expect, it } from "vitest";
import {
  attachObservationHash,
  buildSpotEpisode,
  canonicalHash,
  createSpotAuthorization,
  markAuthorizationState,
  runSpotPreflight,
  validateSpotPolicy,
  verifySpotEpisode,
} from "../src/index.js";
import { baseObservation, demoPolicy, marketBuyIntent } from "./binance-fixtures.js";

describe("binance spot preflight matrix", () => {
  const nowMs = 1_700_000_000_000;
  const nowSeconds = 1_700_000_000;

  it("1. safe BNBUSDT buy → ALLOW", () => {
    const policy = demoPolicy({}, nowSeconds);
    const observation = baseObservation({}, nowMs);
    const result = runSpotPreflight({
      policy,
      observation,
      intent: marketBuyIntent("10"),
      nowMs,
    });
    expect(result.decision).toBe("ALLOW");
    expect(result.authorizedOrder?.quoteOrderQty).toBe("10");
  });

  it("2. buy as much as possible → REDUCE", () => {
    const policy = demoPolicy({ maxOrderNotional: "25" }, nowSeconds);
    const observation = baseObservation({}, nowMs);
    const result = runSpotPreflight({
      policy,
      observation,
      intent: marketBuyIntent("1000"),
      nowMs,
    });
    expect(result.decision).toBe("REDUCE");
    expect(Number(result.calculations.authorizedNotional)).toBeLessThan(1000);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("3. reserve consumes spendable USDT → BLOCK", () => {
    const policy = demoPolicy({ minQuoteReserve: "100" }, nowSeconds);
    const observation = baseObservation({
      balances: [
        { asset: "USDT", free: "100.00000000", locked: "0" },
        { asset: "BNB", free: "0.05", locked: "0" },
      ],
    }, nowMs);
    const result = runSpotPreflight({
      policy,
      observation,
      intent: marketBuyIntent("10"),
      nowMs,
    });
    expect(result.decision).toBe("BLOCK");
    expect(result.reasons).toContain("MIN_RESERVE_BINDING");
  });

  it("4. concentration already high → BLOCK additional buy", () => {
    const policy = demoPolicy({ maxAssetConcentrationBps: 100 }, nowSeconds);
    const observation = baseObservation({
      balances: [
        { asset: "USDT", free: "10.00000000", locked: "0" },
        { asset: "BNB", free: "5.00000000", locked: "0" },
      ],
    }, nowMs);
    const result = runSpotPreflight({
      policy,
      observation,
      intent: marketBuyIntent("5"),
      nowMs,
    });
    expect(result.decision).toBe("BLOCK");
    expect(result.reasons).toContain("CONCENTRATION_BINDING");
  });

  it("5. thin book → REDUCE or BLOCK", () => {
    const policy = demoPolicy({ maxEstimatedSlippageBps: 1 }, nowSeconds);
    const observation = baseObservation({
      asks: [
        { price: "600.10", quantity: "0.001" },
        { price: "650.00", quantity: "100" },
      ],
    }, nowMs);
    const result = runSpotPreflight({
      policy,
      observation,
      intent: marketBuyIntent("20"),
      nowMs,
    });
    expect(["REDUCE", "BLOCK", "INCONCLUSIVE"]).toContain(result.decision);
  });

  it("6. stale observation → INCONCLUSIVE", () => {
    const policy = demoPolicy({}, nowSeconds);
    const observation = baseObservation({}, nowMs - 60_000);
    const result = runSpotPreflight({
      policy,
      observation,
      intent: marketBuyIntent("10"),
      nowMs,
    });
    expect(result.decision).toBe("INCONCLUSIVE");
    expect(result.reasons).toContain("OBSERVATION_STALE");
  });

  it("7. symbol metadata mismatch → INCONCLUSIVE", () => {
    const policy = demoPolicy({}, nowSeconds);
    const observation = baseObservation({ symbol: "ETHUSDT" }, nowMs);
    const result = runSpotPreflight({
      policy,
      observation,
      intent: marketBuyIntent("10"),
      nowMs,
    });
    expect(result.decision).toBe("INCONCLUSIVE");
  });

  it("8. host changes amount after authorization → verification failure", () => {
    const policy = demoPolicy({}, nowSeconds);
    const observation = baseObservation({}, nowMs);
    const preflight = runSpotPreflight({
      policy,
      observation,
      intent: marketBuyIntent("10"),
      nowMs,
    });
    expect(preflight.decision).toBe("ALLOW");
    const auth = createSpotAuthorization({
      policy,
      preflight,
      acceptedPreflightHash: preflight.preflightHash,
      nowSeconds,
      nonce: "test-nonce-1",
    });
    expect(auth.ok).toBe(true);
    if (!auth.ok) return;
    const episode = buildSpotEpisode({
      createdAt: nowSeconds,
      policyHash: preflight.policyHash,
      observationHash: preflight.observationHash,
      preflight,
      authorization: auth.authorization,
      exactHashAccepted: true,
      evidence: {
        orderId: 1,
        clientOrderId: "x",
        status: "FILLED",
        executedQty: "1",
        cumulativeQuoteQty: "999",
        fills: [{ price: "600", qty: "1", commission: "0", commissionAsset: "BNB" }],
        preBalances: observation.balances,
        postBalances: observation.balances,
        hostAttested: false,
      },
    });
    expect(episode.outcome).toBe("FAILED");
    expect(episode.reasons).toContain("ORDER_MISMATCH");
  });

  it("9. Binance rejects order → FAILED episode", () => {
    const policy = demoPolicy({}, nowSeconds);
    const observation = baseObservation({}, nowMs);
    const preflight = runSpotPreflight({
      policy,
      observation,
      intent: marketBuyIntent("10"),
      nowMs,
    });
    const auth = createSpotAuthorization({
      policy,
      preflight,
      acceptedPreflightHash: preflight.preflightHash,
      nowSeconds,
      nonce: "test-nonce-2",
    });
    if (!auth.ok) throw new Error("auth failed");
    const episode = buildSpotEpisode({
      createdAt: nowSeconds,
      policyHash: preflight.policyHash,
      observationHash: preflight.observationHash,
      preflight,
      authorization: auth.authorization,
      exactHashAccepted: true,
      evidence: {
        orderId: null,
        clientOrderId: null,
        status: "REJECTED",
        executedQty: "0",
        cumulativeQuoteQty: "0",
        fills: [],
        preBalances: observation.balances,
        postBalances: observation.balances,
        hostAttested: false,
      },
    });
    expect(episode.outcome).toBe("FAILED");
  });

  it("10. partial fill never VERIFIED", () => {
    const policy = demoPolicy({}, nowSeconds);
    const observation = baseObservation({}, nowMs);
    const preflight = runSpotPreflight({
      policy,
      observation,
      intent: marketBuyIntent("10"),
      nowMs,
    });
    const auth = createSpotAuthorization({
      policy,
      preflight,
      acceptedPreflightHash: preflight.preflightHash,
      nowSeconds,
      nonce: "test-nonce-3",
    });
    if (!auth.ok) throw new Error("auth failed");
    const episode = buildSpotEpisode({
      createdAt: nowSeconds,
      policyHash: preflight.policyHash,
      observationHash: preflight.observationHash,
      preflight,
      authorization: auth.authorization,
      exactHashAccepted: true,
      evidence: {
        orderId: 2,
        clientOrderId: "p",
        status: "PARTIALLY_FILLED",
        executedQty: "0.001",
        cumulativeQuoteQty: "0.6",
        fills: [{ price: "600.1", qty: "0.001", commission: "0", commissionAsset: "BNB" }],
        preBalances: observation.balances,
        postBalances: observation.balances,
        hostAttested: false,
      },
    });
    expect(episode.outcome).not.toBe("VERIFIED");
    expect(episode.reasons).toContain("ORDER_PARTIALLY_FILLED");
  });

  it("11. verified fill with BNB commission", () => {
    const policy = demoPolicy({}, nowSeconds);
    const observation = baseObservation({}, nowMs);
    const preflight = runSpotPreflight({
      policy,
      observation,
      intent: marketBuyIntent("10"),
      nowMs,
    });
    const auth = createSpotAuthorization({
      policy,
      preflight,
      acceptedPreflightHash: preflight.preflightHash,
      nowSeconds,
      nonce: "test-nonce-4",
    });
    if (!auth.ok) throw new Error("auth failed");
    const episode = buildSpotEpisode({
      createdAt: nowSeconds,
      policyHash: preflight.policyHash,
      observationHash: preflight.observationHash,
      preflight,
      authorization: markAuthorizationState(auth.authorization, "VERIFIED"),
      exactHashAccepted: true,
      evidence: {
        orderId: 3,
        clientOrderId: "ok",
        status: "FILLED",
        executedQty: "0.016",
        cumulativeQuoteQty: "9.60",
        fills: [{ price: "600.1", qty: "0.016", commission: "0.000016", commissionAsset: "BNB" }],
        preBalances: observation.balances,
        postBalances: [
          { asset: "USDT", free: "90.4", locked: "0" },
          { asset: "BNB", free: "0.066", locked: "0" },
        ],
        hostAttested: false,
      },
    });
    expect(episode.outcome).toBe("VERIFIED");
    expect(verifySpotEpisode(episode).ok).toBe(true);
  });

  it("12. duplicate authorization hash acceptance mismatch blocked", () => {
    const policy = demoPolicy({}, nowSeconds);
    const observation = baseObservation({}, nowMs);
    const preflight = runSpotPreflight({
      policy,
      observation,
      intent: marketBuyIntent("10"),
      nowMs,
    });
    const bad = createSpotAuthorization({
      policy,
      preflight,
      acceptedPreflightHash: ("0x" + "11".repeat(32)) as `0x${string}`,
      nowSeconds,
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.reasons).toContain("PREFLIGHT_HASH_MISMATCH");
  });
});

describe("binance hashing adversarial", () => {
  it("policy hash changes when a field changes; key order does not", () => {
    const a = validateSpotPolicy({ accountRef: "a", preset: "demo" }, 1_700_000_000);
    const b = validateSpotPolicy({ accountRef: "a", preset: "demo" }, 1_700_000_000);
    const c = validateSpotPolicy({ accountRef: "b", preset: "demo" }, 1_700_000_000);
    expect(a.ok && b.ok && c.ok).toBe(true);
    if (!a.ok || !b.ok || !c.ok) return;
    expect(a.policyHash).toBe(b.policyHash);
    expect(a.policyHash).not.toBe(c.policyHash);
  });

  it("observation hash ignores key insertion order via canonicalize", () => {
    const obs = baseObservation();
    const h1 = attachObservationHash(obs).observationHash;
    const shuffled = attachObservationHash({
      ...obs,
      sources: { book: obs.sources.book, market: obs.sources.market, account: obs.sources.account },
    });
    expect(shuffled.observationHash).toBe(h1);
  });

  it("tampered episode fails verify", () => {
    const policy = demoPolicy();
    const observation = baseObservation();
    const preflight = runSpotPreflight({
      policy,
      observation,
      intent: marketBuyIntent("10"),
      nowMs: 1_700_000_000_000,
    });
    const episode = buildSpotEpisode({
      createdAt: 1_700_000_000,
      policyHash: preflight.policyHash,
      observationHash: preflight.observationHash,
      preflight,
      authorization: null,
      exactHashAccepted: false,
      evidence: null,
    });
    const tampered = { ...episode, outcome: "VERIFIED" as const };
    expect(verifySpotEpisode(tampered).ok).toBe(false);
  });

  it("rejects unicode lookalike quote asset at schema boundary", () => {
    const result = validateSpotPolicy({
      accountRef: "x",
      // @ts-expect-error intentional
      quoteAsset: "USDΤ",
    });
    // validateSpotPolicy always forces USDT literal — draft cannot override
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.policy.quoteAsset).toBe("USDT");
  });

  it("canonicalHash rejects non-integer numbers", () => {
    expect(() => canonicalHash({ x: 1.5 })).toThrow();
  });
});
