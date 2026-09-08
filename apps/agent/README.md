# @lujaw-binance/agent

CLI and MCP server for LUJAW.

**Primary:** Binance Spot safety tools (`lujaw_policy_create`,
`lujaw_order_preflight`, `lujaw_order_authorize`, `lujaw_episode_verify`).

**Secondary:** Venus Care Plan CLI/MCP (`check`, `markets`, `activate`,
`rescue`, `revoke`).

```bash
npx -y --package @lujaw-binance/agent lujaw-mcp
npx -y --package @lujaw-binance/agent lujaw markets
```

See the main [LUJAW repository](https://github.com/wurli-sh/lujaw-binance) for
Cursor setup, threat model, and demo script. Spot tools need no Binance secrets
in LUJAW — the host supplies observations and calls Binance MCP separately.
