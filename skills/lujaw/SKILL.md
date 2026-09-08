---
name: lujaw
description: Binance Spot safety firewall for AI-initiated trades via LUJAW MCP, plus a secondary Venus Care Plan adapter on BSC testnet. Use for policy, preflight, authorize, and episode verify of Spot orders; never invent sizes or bypass exact-hash acceptance.
---

# LUJAW Agent Skill

LUJAW bounds and verifies **Binance Spot** actions on an Agentic sub-account
(USDT-quoted allowlist; demo default `BNBUSDT`). Venus rescue on BSC testnet is
a secondary adapter.

## Tools only

### Binance Spot (primary)

| Tool | Purpose |
|------|---------|
| `lujaw_policy_create` | Draft (`accept=false`) or activate (`accept=true` + exact `policyHash`) a Spot policy. |
| `lujaw_order_preflight` | Deterministic ALLOW / REDUCE / BLOCK / INCONCLUSIVE from host-supplied observations. |
| `lujaw_order_authorize` | One-shot authorization from exact `preflightHash`. Does **not** place the order. |
| `lujaw_episode_verify` | Verify redacted Binance fill + balances into a canonical episode. |

Host orchestration: authorize → Binance MCP exact order + user confirmation →
status/balances → `lujaw_episode_verify`.

### Venus (secondary)

| Tool | Purpose |
|------|---------|
| `lujaw_markets` | Read-only Venus capability report. |
| `lujaw_check` | Read-only health; never spends. |
| `lujaw_activate` | Draft/grant Care Plan (`accept` + exact `planHash`). |
| `lujaw_rescue` | At most one buffered mint if authorized. |
| `lujaw_revoke` | Revoke session; disclose remaining allowance. |

## Hard rules

1. Never call Binance trading tools before a successful LUJAW authorization.
2. Never change symbol, side, type, price, or amount after authorization.
3. Show the exact authorized order; let Binance confirm independently.
4. Fail closed on stale/missing observations — never invent decimals or sizes.
5. Do not claim LUJAW prevents host bypass of Binance MCP.
6. Never log or persist Binance OAuth tokens, `OWNER_PRIVATE_KEY`, or `SESSION_PRIVATE_KEY`.
7. Venus protocol scope still comes only from the deployment profile.

## References

- [binance-cursor-demo.md](../../docs/binance-cursor-demo.md)
- [binance-threat-model.md](../../docs/binance-threat-model.md)
- [binance-live-gate.md](../../docs/binance-live-gate.md)
- [operations.md](references/operations.md) — Venus command semantics
- [deployment-profile.md](references/deployment-profile.md) — Venus profile
