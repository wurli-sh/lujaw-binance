# Binance Spot Cursor Demo

Seatbelt demo in Cursor: policy → preflight → authorize → Binance confirm → episode verify.

Two-scene, no-funds workflow for Track A (Binance Agent OS Mini Hackathon).

## Connect

1. Build: `pnpm build && pnpm build:mcp`
2. Enable local `lujaw` MCP from [`.cursor/mcp.json`](../.cursor/mcp.json) (stdio → `apps/agent/dist/mcp.js`).
3. Connect the **official** Binance Agent OS MCP via Binance's documented OAuth flow.
4. Do **not** commit Binance endpoints, cookies, or tokens.

## Demo script — the version to record

1. Show both MCP servers connected.
2. Ask Binance MCP for `BNBUSDT` market data and Agentic Spot balances.
3. `lujaw_policy_create` with preset `demo` (small caps / reserve / concentration / slippage / daily budget).
4. Accept the exact `policyHash` (`accept: true`).
5. Prompt: “Buy as much BNB as possible.”
6. Host supplies the real observations to `lujaw_order_preflight`.
7. With an unfunded account, show `BLOCK`, `MIN_RESERVE_BINDING`, and `authorizedOrder: null`.
8. Show that no `lujaw_order_authorize` or Binance trade tool was called.
9. In a terminal, run `pnpm demo:no-funds`.
10. Explain that it uses a separately labeled local 20-USDT balance simulation and returns `ALLOW` for an exact 10-USDT `BNBUSDT` market-buy proposal.
11. Stop. Do not represent the simulation as an account response, Binance authorization, or Binance execution.
12. One sentence on Venus: the same deterministic policy/evidence model already has a tested BNB Chain DeFi adapter.

The full evidence and exact judge wording are in
[binance-no-funds-demo.md](binance-no-funds-demo.md).

## Optional funded path — do not use for this demo

Only an intentionally funded Agentic Spot account can continue after preflight:
exact-hash authorization → Binance confirmation → terminal order/balance reads →
episode verification. This is Gate C, not a prerequisite for the no-funds demo.

## Negative path (Gate B)

Hostile all-in prompt must end at LUJAW `REDUCE`/`BLOCK` with **no** Binance trade tool call. On an empty account, the expected result is `BLOCK` with `MIN_RESERVE_BINDING`.

## Claims hygiene

See [binance-threat-model.md](binance-threat-model.md) and the root README. Do not claim non-bypassable enforcement or cryptographic attestation of Binance MCP responses.
