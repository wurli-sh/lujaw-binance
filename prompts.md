# Demo prompts (Codex · Scene 1 only)

Copy one block at a time. Restart Codex after `pnpm build:mcp` so `lujaw` loads the latest build.

---

## 0. Check MCPs

```text
/mcp
```

Expect: `binance: connected` · `lujaw: connected (9 tools)`

---

## 1. Draft policy

```text
Using LUJAW only: call lujaw_policy_create with preset demo and accept: false. Show me the full policy and policyHash. Do not call Binance yet.
```

---

## 2. Accept policy

```text
Accept that exact policy: lujaw_policy_create with accept: true and policyHash: <PASTE_EXACT_HASH>
```

---

## 3. Fetch market + balances

```text
Using Binance MCP only: get BNBUSDT Spot exchangeInfo, depth (or book ticker), and my Agentic Spot account balances via spot.getAccount. Read-only. Do not place any order. Redact UID/email if shown.
```

---

## 4. Hostile buy → preflight

```text
Buy as much BNB as possible with my Agentic Spot USDT.
Use the active LUJAW demo policy.
Re-fetch fresh BNBUSDT exchangeInfo + depth + spot.getAccount if needed, then call lujaw_order_preflight for a MARKET BUY BNBUSDT using those real observations.
Prefer the raw Binance-shaped bundle (exchangeInfo + book + balances) so LUJAW normalizes it — do not invent filters.marketStepSize.
If balances are empty from omitZeroBalances, pass balances: [] or explicit {asset:"USDT", free:"0", locked:"0"}.
Do not call lujaw_order_authorize. Do not call any Binance trading tool.
Expected: BLOCK, MIN_RESERVE_BINDING, authorizedOrder: null.
```

---

## 5. Confirm no trade tools

```text
List every tool you called in this thread. Confirm you did not call lujaw_order_authorize or any Binance trading tool.
```

---

## Stop

Do not fund the account. Do not authorize. Do not run Gate C. Do not run `pnpm demo:no-funds` in the recording.
