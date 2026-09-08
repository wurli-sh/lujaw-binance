# Operations

## Binance Spot (primary MCP)

### lujaw_policy_create

Draft (`accept=false`) or activate (`accept=true` + exact `policyHash`) a
`lujaw.binance-spot-policy/1` policy. Demo preset ceilings are disposable
hackathon limits (e.g. 25 USDT per order). State: `.lujaw/binance/`.

### lujaw_order_preflight

Host supplies intent + observation (normalized or fixture-shaped). Returns
`ALLOW` | `REDUCE` | `BLOCK` | `INCONCLUSIVE` with `preflightHash`. REDUCE
exposes the only compliant size — do not interpolate.

### lujaw_order_authorize

Consumes an unexpired ALLOW/REDUCE preflight after exact hash acceptance.
Reserves daily notional. Does **not** submit to Binance.

### lujaw_episode_verify

Builds `lujaw.binance-spot-episode/1` from authorization + redacted host
evidence. Partial/rejected/ambiguous never become full `VERIFIED` success.
`hostAttested` is always false in v1.

---

## Venus (secondary)

## markets

Read configured Venus supply markets at one pinned block and report three
independent capabilities: observation verification, current supply availability,
and execution verification. It never spends and may use a public probe account
when no account is supplied. `OBSERVE_VERIFIED` or `AVAILABLE` must never be
described as `EXECUTE_VERIFIED`.

## check

Read-only Venus observe + reconstruct. Writes `lujaw.episode/1`.

| Product status | Outcome | Reason |
|----------------|---------|--------|
| HEALTHY | HELD | HEALTHY_NO_REPAIR |
| WATCH | HELD | WATCH_NO_REPAIR |
| AT_RISK | HELD | CHECK_ONLY_AT_RISK |
| INCONCLUSIVE | BLOCKED | OBSERVATION_INCONCLUSIVE |

## activate

1. Draft via preset or AgentRouter schema-constrained output (`AGENT_ROUTER_MODEL`, default `deepseek-v4-flash`).
2. Without `accept`, persist and return the normalized draft plus its canonical `planHash`.
3. With `accept=true` and that exact `planHash`: owner ERC-20 approve + Altana grant with a **fresh** session signer. Never redraft during acceptance.
4. Persist plan + public `SessionRecord` under `apps/agent/state/` (gitignored). Never persist private keys.

For separate CLI invocations, keep the matching `SESSION_PRIVATE_KEY` in the caller's external environment or keystore for rescue. Do not pass it on the command line. The MCP server may retain a generated signer only in its own process memory. Revocation uses the owner signer plus persisted public session identity and does not require the session private key.

## rescue

Policy gates: fresh observation (≤64 blocks), repair market entered, below intervene, session live, no CRITICAL authority widen, buffered top-up ≤ plan and session spend, projected HF ≥ restoreTo, exact mint intent.

Outcomes: `HELD` | `BLOCKED` | `EXECUTED` | `FAILED`.

`EXECUTED` requires confirmed receipt + post-state HF ≥ restoreTo. Top-level `tx.to` may be the Altana orchestrator.

## revoke

Revoke on-chain session. Always disclose remaining underlying allowance to the vToken spender.
