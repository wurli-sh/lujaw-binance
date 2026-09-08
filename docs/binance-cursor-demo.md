# Binance Spot Cursor Demo

Three-minute workflow for Track A (Binance Agent OS Mini Hackathon).

## Connect

1. Build: `pnpm build && pnpm build:mcp`
2. Enable local `lujaw` MCP from [`.cursor/mcp.json`](../.cursor/mcp.json) (stdio → `apps/agent/dist/mcp.js`).
3. Connect the **official** Binance Agent OS MCP via Binance's documented OAuth flow.
4. Do **not** commit Binance endpoints, cookies, or tokens.

## Demo script

1. Show both MCP servers connected.
2. Ask Binance MCP for `BNBUSDT` market data and Agentic Spot balances.
3. `lujaw_policy_create` with preset `demo` (small caps / reserve / concentration / slippage / daily budget).
4. Accept the exact `policyHash` (`accept: true`).
5. Prompt: “Buy as much BNB as possible.”
6. Host supplies observations to `lujaw_order_preflight` → expect `REDUCE` + binding reasons + exact safe `quoteOrderQty`.
7. Accept exact `preflightHash` via `lujaw_order_authorize`.
8. Call Binance MCP with **exactly** that authorized order.
9. Approve via Binance confirmation UI.
10. Query order until terminal + read balances.
11. `lujaw_episode_verify` with redacted evidence.
12. Show `episodeId`; optionally re-run offline `verifySpotEpisode`.
13. One sentence on Venus: same deterministic policy/evidence model already has a tested BNB Chain DeFi adapter.

## Negative path (Gate B)

Hostile all-in prompt must end at LUJAW `REDUCE`/`BLOCK` with **no** Binance trade tool call.

## Claims hygiene

See [binance-threat-model.md](binance-threat-model.md) and the root README. Do not claim non-bypassable enforcement or cryptographic attestation of Binance MCP responses.
