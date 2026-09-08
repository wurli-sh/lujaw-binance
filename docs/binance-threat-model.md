# Binance Spot threat model (hackathon v1)

What the seatbelt covers — and what it does not (bypass, attestation, profit).

## Trust boundary

```text
LUJAW authorizes an exact normalized order
        ↓
Cursor asks Binance MCP to execute that exact order
        ↓
LUJAW evaluates the returned order and post-trade state
```

LUJAW MCP cannot invoke Binance MCP. The host model orchestrates both.

## Controls vs residual risk

| Threat | Control | Residual risk |
|---|---|---|
| LLM proposes all-in trade | Deterministic caps, reserve, concentration, daily budget, slippage | Host can bypass LUJAW |
| LLM changes approved order | Exact-hash authorize + episode verify | Binance MCP does not consume LUJAW hash |
| Stale market data | Freshness window; fail closed | Host timestamps are not attested |
| Thin book / slippage | Depth walk | Market moves after preflight |
| Replay | One-shot nonce, atomic reservation, short TTL | Local state deletion erases history |
| Partial fill | Explicit `ORDER_PARTIALLY_FILLED`; never `VERIFIED` as full | Later market movement |
| Credential theft | Binance remote OAuth; LUJAW stores no token | Compromised Cursor session |
| Evidence authenticity | Canonical episode hash | Hash proves integrity after creation, not Binance provenance |

## Integrity vs authenticity

Episode hashes detect **tampering after creation**. Host-mediated Binance fields are labeled `hostAttested: false` and are **not** a cryptographic attestation from Binance.

## Forbidden claims (v1)

- “No AI agent can bypass LUJAW.”
- “LUJAW cryptographically attests Binance MCP responses.”
- “LUJAW guarantees execution price or prevents all slippage.”
- “LUJAW is autonomous portfolio management.”
- “LUJAW makes trading safe or profitable.”

## Post-hackathon hard enforcement

Move execution behind a LUJAW-owned credential/proxy so agents never hold raw Binance trading capability. Until then, `lujaw_order_execute` is an dishonest tool name and is intentionally absent.
