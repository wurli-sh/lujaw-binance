# Phase 2 locked decisions

These supersede older example wording in early product drafts that used mainnet-shaped values.

| Decision | Lock |
|----------|------|
| Execution network | BSC testnet **chainId 97**, market USDT from `deployments/bsc-testnet.json` |
| Freshness | `MAX_OBSERVATION_AGE_BLOCKS = 64` |
| Top-up buffer | `TOP_UP_BUFFER_BPS = 50` (+ min +1 raw when unbuffered > 0) |
| Native fee cap | `DEFAULT_NATIVE_FEE_CAP_WEI = 1e16` (0.01 tBNB) |
| Max custom top-up | `25000000` raw (25 USDT @ 6 decimals) |
| NL drafting | AgentRouter schema-constrained output; default model **`deepseek-v4-flash`** (`AGENT_ROUTER_MODEL`) |
| Session custody | `OWNER_PRIVATE_KEY` for admin operations; CLI requires a fresh externally-held `SESSION_PRIVATE_KEY` so later invocations can rescue/revoke; the long-lived MCP process may keep an ephemeral signer in memory; persist only public `SessionRecord` |
| `check` + `AT_RISK` | Outcome **`HELD`**, reason **`CHECK_ONLY_AT_RISK`** |
| Receipts | Altana orchestrator wrap is expected; post-state verifies mint success |
| Freshness | age ≤ 64 blocks **and** pinned block hash re-read must match |

## Live gate (2026-09-08)

`pnpm phase2:live` passed on owner `0x658d…440B` (re-verified after Agent OS surface restore):

- grant `0xea4d88a3…`
- mint/rescue EXECUTED `0x7d4663eb…` (HF 4.360200 → 4.410249)
- revoke `0xe3304674…`

## Env placeholders

```bash
AGENT_ROUTER_API_KEY=
AGENT_ROUTER_BASE_URL=https://agentrouter.org/v1
AGENT_ROUTER_MODEL=deepseek-v4-flash
```

NL drafting requires a working AgentRouter API key; preset/custom explicit fields work offline.
