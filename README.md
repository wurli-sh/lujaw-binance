# LUJAW

**Binance Agent OS gives agents financial capabilities. LUJAW makes Binance Spot
actions bounded, explainable, and independently verifiable.**

LUJAW is a safety and verification layer for AI-initiated Spot trades on a
Binance Agentic sub-account. It drafts a durable portfolio policy, deterministically
preflights proposed orders (ALLOW / REDUCE / BLOCK), binds an exact one-shot
authorization hash, and verifies host-mediated fills into a canonical episode.

Venus Care Plan rescue on BSC testnet remains a **secondary** adapter that
reuses the same deterministic policy/evidence model for on-chain DeFi.

## Primary surface (Binance Spot)

| Tool | Purpose |
|---|---|
| `lujaw_policy_create` | Draft or activate a hashed Spot policy (`accept` + exact `policyHash`) |
| `lujaw_order_preflight` | Deterministic sizing / risk checks from host-supplied observations |
| `lujaw_order_authorize` | One-shot authorization; does **not** place the order |
| `lujaw_episode_verify` | Verify redacted Binance order + balance evidence into an episode |

Cursor calls **Binance MCP** between authorize and verify. LUJAW never stores
Binance OAuth tokens and does not claim to execute Binance orders in v1.

Initial demo scope: Spot only, USDT-quoted, allowlist `BNBUSDT`, market buys
sized with `quoteOrderQty` when the connected Binance MCP exposes it.

## Five-minute fixture start

Requirements: Node.js 20.12+ and pnpm 9.

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm build:mcp
```

Standard tests use redacted/synthetic fixtures only — no Binance auth, no spend.

## Cursor demo (Binance + LUJAW)

1. `pnpm build:mcp` and enable local `lujaw` from [`.cursor/mcp.json`](.cursor/mcp.json).
2. Connect official Binance Agent OS MCP via Binance's documented OAuth flow.
3. Follow [`docs/binance-cursor-demo.md`](docs/binance-cursor-demo.md).

Orchestration rule (workflow guidance, not a security boundary):
[`.cursor/rules/lujaw-binance-safety.mdc`](.cursor/rules/lujaw-binance-safety.mdc).

Recommended prompt:

> Buy as much BNB as possible with my Agentic Spot USDT. Use LUJAW policy,
> preflight, and authorize first. Never change the authorized order. After
> Binance confirmation, verify the episode.

## Architecture and trust boundary

```text
Cursor / MCP host
  ├── Binance Agent OS MCP ── market data, balances, confirmed Spot execution
  └── LUJAW MCP
        ├── Spot policy + exact-hash acceptance
        ├── deterministic preflight / REDUCE
        ├── one-shot authorization
        ├── episode verify (host evidence, non-attested)
        └── Venus adapter (secondary)
```

**Integrity vs authenticity:** episode hashes detect tampering after creation.
Host-supplied Binance fields are not cryptographic attestations from Binance.
The host can bypass LUJAW and call Binance MCP directly — see
[`docs/binance-threat-model.md`](docs/binance-threat-model.md).

## Secondary surface (Venus)

| Tool | Purpose |
|---|---|
| `lujaw_markets` | Venus market capability report |
| `lujaw_check` | Read-only health reconstruction |
| `lujaw_activate` | Draft/accept Care Plan session |
| `lujaw_rescue` | At most one buffered mint top-up |
| `lujaw_revoke` | Revoke Altana session |

Venus CLI flows still work (`pnpm lujaw …`). State prefers `.lujaw/venus/` with
legacy `.lujaw/` fallback. Binance Spot state lives under `.lujaw/binance/`.

## Evidence and docs

- Live gate / discovery decisions: [`docs/binance-live-gate.md`](docs/binance-live-gate.md)
- Demo script: [`docs/binance-cursor-demo.md`](docs/binance-cursor-demo.md)
- No-funds judge demo: [`docs/binance-no-funds-demo.md`](docs/binance-no-funds-demo.md)
- Threat model: [`docs/binance-threat-model.md`](docs/binance-threat-model.md)
- Synthetic MCP fixtures: [`fixtures/binance-mcp/`](fixtures/binance-mcp/)
- Fixture episode evidence: [`deployments/evidence/binance-spot-demo.redacted.json`](deployments/evidence/binance-spot-demo.redacted.json)
- Venus Gate 0 evidence remains under [`deployments/evidence/`](deployments/evidence/)

```bash
pnpm test
pnpm typecheck
pnpm build
```

## Safe claims (after a live Gate C)

- LUJAW deterministically bounds AI-proposed Binance Spot trades.
- LUJAW calculates a compliant maximum instead of letting the model choose.
- Demo execution goes through Binance MCP with Binance confirmation.
- Episodes are canonical and tamper-evident after creation.

## Forbidden claims (v1)

- Non-bypassable enforcement when the host can call Binance MCP directly.
- Cryptographic attestation of Binance MCP responses.
- Guaranteed fill price / “safe or profitable” trading.
- Support for all Binance markets, Futures, Margin, or withdrawals.
