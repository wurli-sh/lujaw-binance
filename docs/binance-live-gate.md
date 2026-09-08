# Binance Live Gate — Discovery Decisions

Status: authenticated read-only discovery completed on 2026-09-08. Synthetic
fixtures remain the deterministic test corpus; a live order remains out of
scope unless an intentionally funded Agentic Spot account is available.

## Discovery status

The official Binance Agent OS MCP was authenticated in Codex and exposed 50
tools. Read-only Spot discovery confirmed public BNBUSDT exchange metadata and
book access plus an Agentic Spot account response. The account returned no
balances, and LUJAW correctly failed closed with `MIN_RESERVE_BINDING` for a
10-USDT market-buy proposal. No order, authorization, transfer, or trade tool
was called.

The repository retains **synthetic Spot fixtures** shaped like Binance Spot
REST responses (`exchangeInfo`, depth, account, order) so tests stay
reproducible and do not require OAuth or funds. Do not save UID, email, OAuth
data, cookies, or raw account responses in those fixtures.

### Gate C stop conditions

Do not place a live Spot order until discovery confirms:

1. Spot account / balance read
2. Spot order placement
3. Order status query

## Provisional capability decisions

| Capability | Decision for demo | Rationale |
|---|---|---|
| Market buy sizing | Prefer `quoteOrderQty` for `MARKET` `BUY` | Confirmed viable for the demo contract; never invent a quantity heuristically. |
| `clientOrderId` | Optional; pass through when present | Useful for episode binding; not required for verification if Binance `orderId` is present. |
| Freshness fields | Require observation `observedAt` (unix ms) supplied by host normalize | Host timestamps are audit metadata, not Binance attestation. Default max age: 5_000 ms for ticker/book, 10_000 ms for balances. |
| Symbol allowlist | `BNBUSDT` only for demo preset | Keeps valuation complete (USDT + BNB). |
| Demo ceilings | `maxOrderNotional=25`, `maxDailyGrossNotional=50`, `minQuoteReserve=5` USDT | Used in both real refusal and clearly labeled simulation. |

## How to refresh discovery

1. Connect official Binance MCP through its supported OAuth host (never commit tokens).
2. Capture only sanitized exchange-info and book data if a refreshed fixture is required.
3. Redact or omit all identity/account fields; do not capture an order unless Gate C is intentionally run.
4. Update this document with schema deltas.
5. Adjust `apps/agent/src/binance/normalize.ts` if field paths differ.

## Live gates

- **Gate A** — read-only: market + balances → normalize → preflight (no trade tool). **Passed:** empty account yielded `BLOCK / MIN_RESERVE_BINDING`.
- **Gate B** — hostile all-in prompt → `REDUCE`/`BLOCK`; confirm no Binance trade call. **Ready to demonstrate with the no-funds runbook.**
- **Gate C** — one minimum practical authorized `BNBUSDT` buy with Binance confirmation; save redacted episode.
