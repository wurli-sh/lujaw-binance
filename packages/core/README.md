# @lujaw/core

Deterministic policy engines and evidence for [LUJAW](https://github.com/wurli-sh/lujaw-binance).

## Binance Spot (primary)

Exact decimal math, Spot policy/preflight/authorization/episode schemas, order-book
slippage walks, concentration/reserve checks, and offline episode verification.
No MCP, network, or LLM imports.

## Venus (secondary)

Venus reads, health reconstruction, Care Plan policy, scoped Altana authority,
and canonical Venus episodes.

The language model does not select final sizes, targets, or execution outcomes.
Unknown and stale state fails closed.
