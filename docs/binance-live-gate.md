# Binance Live Gate — Discovery Decisions

Status: synthetic contract frozen for Phase 1–2; replace fixtures with live
redacted captures before Gate C.

## Discovery status

Live authenticated `tools/list` against the official Binance Agent OS MCP server
was not available in-repo at plan execution time. Phase 1–2 therefore use
**synthetic Spot fixtures** shaped like Binance Spot REST responses
(`exchangeInfo`, depth, account, order). Host-facing normalize code accepts
those shapes and must be revalidated when live schemas are recorded under
`fixtures/binance-mcp/`.

### Gate C stop conditions

Do not place a live Spot order until discovery confirms:

1. Spot account / balance read
2. Spot order placement
3. Order status query

## Provisional capability decisions

| Capability | Decision for demo | Rationale |
|---|---|---|
| Market buy sizing | Prefer `quoteOrderQty` for `MARKET` `BUY` | Matches Binance Spot REST; TermiX/community MCP samples expose it. If live MCP omits it, fall back to marketable `LIMIT` with explicit `limitPrice` from preflight — never invent a quantity heuristically. |
| `clientOrderId` | Optional; pass through when present | Useful for episode binding; not required for verification if Binance `orderId` is present. |
| Freshness fields | Require observation `observedAt` (unix ms) supplied by host normalize | Host timestamps are audit metadata, not Binance attestation. Default max age: 5_000 ms for ticker/book, 10_000 ms for balances. |
| Symbol allowlist | `BNBUSDT` only for demo preset | Keeps valuation complete (USDT + BNB). |
| Demo ceilings | `maxOrderNotional=25`, `maxDailyGrossNotional=50`, `minQuoteReserve=5` USDT | Disposable Agentic sub-account funding only. |

## How to refresh discovery

1. Connect official Binance MCP via Cursor's documented OAuth flow (never commit tokens).
2. Capture sanitized `tools/list` → `fixtures/binance-mcp/tools-list.redacted.json`.
3. Capture redacted exchange-info, book, account, filled, and rejected order fixtures.
4. Update this document with exact tool names and any schema deltas.
5. Adjust `apps/agent/src/binance/normalize.ts` if field paths differ.

## Live gates

- **Gate A** — read-only: market + balances → normalize → preflight (no trade tool).
- **Gate B** — hostile all-in prompt → `REDUCE`/`BLOCK`; confirm no Binance trade call.
- **Gate C** — one minimum practical authorized `BNBUSDT` buy with Binance confirmation; save redacted episode.
