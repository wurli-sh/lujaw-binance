# No-funds demo: real refusal, simulated safe path

This is the intended hackathon demonstration when the Agentic Spot sub-account
has no disposable USDT. It never places, authorizes, or simulates an exchange
fill.

## Scene 1 — real Binance, blocked safely

Use the connected Binance MCP to fetch only `BNBUSDT` Spot filters, depth, and
the Agentic Spot account. Pass that observation to the connected LUJAW MCP for
a `MARKET BUY` with `quoteOrderQty: "10"`.

With an empty account, LUJAW must return:

```text
decision: BLOCK
reasons: [MIN_RESERVE_BINDING]
authorizedOrder: null
```

That is live, read-only evidence. Do not work around the block and do not call
`lujaw_order_authorize` or any Binance trading tool.

## Scene 2 — local simulation, positive preflight

Run the repository’s deterministic simulated-account test:

```bash
pnpm --filter @lujaw/agent test -- conformance.test.ts
```

The named test `allows a clearly simulated 10 USDT buy while preserving the 5
USDT reserve` uses:

- public-shaped BNBUSDT exchange and order-book fixtures;
- a declared simulation: `USDT free = 20`, `BNB free = 0`;
- the unmodified demo policy: max order 25 USDT, min reserve 5 USDT, max BNB
  concentration 50%, fee buffer 20 bps;
- a `MARKET BUY BNBUSDT` proposal sized at 10 USDT.

Expected preflight output:

```text
decision: ALLOW
authorizedOrder.quoteOrderQty: "10"
```

The test deliberately stops there. It does not call `lujaw_order_authorize`,
Binance order placement, a balance mutation, or a fill verifier.

## Judge-facing wording

> On the real connected Binance account, LUJAW blocks the proposed trade
> because there is no spendable quote balance after reserve. With a separately
> labeled 20-USDT local simulation and the same deterministic policy engine,
> it returns the exact 10-USDT order that fits every constraint. No simulated
> result is represented as a Binance account response or live execution.

## Boundary

Do not combine a real empty-account response with simulated balances and call
it a live preflight. Capture and label the two scenes separately.
