# Cursor + Binance Agent OS demo

Primary path: **Binance Spot safety firewall**. Venus is secondary.

See [`binance-cursor-demo.md`](binance-cursor-demo.md) for the full Spot script.

## Setup

1. `pnpm build:mcp`
2. Enable `lujaw` from [`.cursor/mcp.json`](../.cursor/mcp.json).
3. Connect official Binance MCP (OAuth stays out of the repo).
4. Follow [`.cursor/rules/lujaw-binance-safety.mdc`](../.cursor/rules/lujaw-binance-safety.mdc).

## Spot claims

- Binance MCP = market/account/execution + user confirmation.
- LUJAW = policy, deterministic bound, one-shot auth, episode verify.
- Host evidence is integrity-checked, not Binance-attested.

## Venus secondary (optional closer)

After the Spot episode, one sentence is enough: the same deterministic
policy/evidence model already has a tested Venus Care Plan adapter on BSC
testnet (`lujaw_markets` → `check` → `activate` → `rescue` → `revoke`).
Binance prices must never drive Venus health or calldata.
