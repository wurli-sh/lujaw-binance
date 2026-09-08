# Binance Spot no-funds demo (Codex recording)

LUJAW running as an MCP safety layer inside Codex.

**Recorded demo (this video):** live empty-account BLOCK only.
Policy → observe → hostile prompt → preflight → `BLOCK`. No simulation scene.
No authorize. No Binance trade tool. No Gate C.

**Host:** Codex CLI. Cursor failed Binance’s OAuth compatibility flow; Codex is
where both MCPs stay connected for the video.

## Connect

1. Build: `pnpm build && pnpm build:mcp`
2. Enable local `lujaw` MCP (stdio → `apps/agent/dist/mcp.js`; same server as [`.cursor/mcp.json`](../.cursor/mcp.json)).
3. Connect the **official** Binance Agent OS MCP via Binance's documented OAuth flow in **Codex**.
4. Restart Codex so `lujaw` loads the latest build.
5. Run `/mcp` and confirm `binance: connected` and `lujaw: connected (9 tools)`.
6. Do **not** commit Binance endpoints, cookies, or tokens.

## Demo script — the version to record

1. Show Codex CLI `/mcp` with **Binance** + **LUJAW** connected.
2. `lujaw_policy_create` with preset `demo` → show caps + `policyHash` → accept (`accept: true`).
3. Binance MCP: fetch `BNBUSDT` market data + Spot balances (redact UID / email / OAuth).
4. Prompt: “Buy as much BNB as possible.”
5. `lujaw_order_preflight` with those real observations.
6. Show: `BLOCK` · `MIN_RESERVE_BINDING` · `authorizedOrder: null`.
7. Show that no `lujaw_order_authorize` or Binance trade tool was called.
8. **Stop.** Do not fund the account, authorize, trade, or run Gate C.

## Optional off-camera / appendix (not in this recording)

Local positive path for reviewers who want the ALLOW side of the same engine:

```bash
pnpm demo:no-funds
```

Label any output **SIMULATED — not a Binance account response.** Details in
[binance-no-funds-demo.md](binance-no-funds-demo.md).

## Claims hygiene

See [binance-threat-model.md](binance-threat-model.md) and the root README. Do not claim non-bypassable enforcement or cryptographic attestation of Binance MCP responses.
