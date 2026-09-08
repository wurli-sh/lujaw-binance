---
name: lujaw
description: On-chain Venus Care Plan agent for BSC testnet via Altana. Use for check, activate, rescue, and revoke of a scoped collateral top-up session. Never invent addresses or budgets.
---

# LUJAW Agent Skill

LUJAW rescues unhealthy Venus lending positions on **BSC testnet (chain 97)** with a single scoped Altana mint session against the locked **USDT** market from `deployments/bsc-testnet.json`.

## Tools only

Route exclusively through these four MCP tools (same semantics as the `lujaw` CLI):

| Tool | Purpose |
|------|---------|
| `lujaw_check` | Read-only health. Never spends. If `AT_RISK`, outcome is `HELD` with reason `CHECK_ONLY_AT_RISK`. |
| `lujaw_activate` | Draft Care Plan (`preset` or `nl`), display its `planHash`, then grant only when `accept=true` carries that exact hash. Fresh session key every grant. |
| `lujaw_rescue` | Evaluate policy; execute at most one buffered mint if authorized. MCP retains its live session; CLI restores it from the externally-held session key. |
| `lujaw_revoke` | Revoke session; disclose remaining ERC-20 allowance (not cleared). |

## Hard rules

1. Protocol scope (chainId, vToken, underlying, mint selector) comes only from the deployment profile — never from model output.
2. Custom/`nl` `maxTopUp` ≤ 25 USDT (25_000_000 raw @ 6 decimals).
3. Do not reuse a revoked session private key.
4. Do not invent second rails, schedulers, or Solidity.
5. Never log or persist `OWNER_PRIVATE_KEY`, `SESSION_PRIVATE_KEY`, or `AGENT_ROUTER_API_KEY`.

## NL drafting

When the user describes thresholds in natural language, call `lujaw_activate` with `nl` (requires `AGENT_ROUTER_API_KEY`; default `deepseek-v4-flash` with schema-constrained output). Show the normalized draft and `planHash`; grant only after the user explicitly accepts that exact hash.

## References

- [deployment-profile.md](references/deployment-profile.md) — how to read the locked profile
- [operations.md](references/operations.md) — command semantics and outcomes
- [presets.md](references/presets.md) — conservative / balanced thresholds
