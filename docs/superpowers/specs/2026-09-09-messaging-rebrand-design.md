# LUJAW messaging rebrand — Seatbelt

Status: locked  
Date: 2026-09-09  
Audience split: landing → hackathon judges; README / core docs → operators & builders

## Wedge

**Agent OS gives agents trading power. LUJAW is the seatbelt that stays on when the model goes stupid.**

Primary venue: Binance Spot (Agentic sub-account). Venus is a secondary DeFi adapter and must not appear in the hero.

## Locked surface copy

| Surface | Copy |
|---|---|
| Eyebrow | Seatbelt for Binance Agent OS |
| Hero | Trading power needs a seatbelt. |
| Sub | Set caps once. LUJAW preflights size, binds one authorized order, and verifies the fill after Binance confirms. |
| CTA | Open the demo |
| README one-liner | LUJAW is the seatbelt for AI Spot trades: durable policy, deterministic size, exact-hash auth, episode verify. |
| Footer honesty | Does not make trading safe or profitable. Does not stop a bypass of LUJAW. |

### Derived meta (landing)

| Field | Copy |
|---|---|
| `title` | LUJAW — Trading power needs a seatbelt |
| `description` | Seatbelt for Binance Agent OS. Policy, preflight, one-shot authorize, Binance confirmation, episode verify — hostile all-in dies before a trade tool runs. |

### Footer blurb (landing)

Seatbelt for AI Spot trades on Binance — policy, preflight, one-shot authorize, episode verify.

### Copyright line

© 2026 LUJAW · Binance Spot demo

## How it works (landing)

Six real steps from the Cursor + Binance MCP host workflow. No invented stages.
Bodies stay under ~12 words.

| Step | Name | Role | Body |
|---|---|---|---|
| 01 | Set policy | `lujaw_policy_create` | Caps, reserve, budget, allowlist. Accept the exact `policyHash`. |
| 02 | Observe Spot | Binance MCP read | Pull balances, ticker, and book for the proposed symbol. |
| 03 | Preflight | `lujaw_order_preflight` | Deterministic `ALLOW` / `REDUCE` / `BLOCK`. Hostile all-in dies here. |
| 04 | Authorize | `lujaw_order_authorize` | One-shot hash on the exact normalized order. Does not place it. |
| 05 | Confirm & trade | Binance MCP write | Show the authorized order. Binance runs its own user confirmation. |
| 06 | Verify episode | `lujaw_episode_verify` | Check redacted fill + balances into a canonical episode. |

Section header:

- Overline: How it works  
- H2: Six steps behind every trade  
- Support: Real host workflow. Each step has one job.

Docs section:

- Overline: Documentation  
- H2: Open the Cursor demo  
- Button: Open the demo (same CTA)

## README lead (replace current opening)

```markdown
# LUJAW

**LUJAW is the seatbelt for AI Spot trades: durable policy, deterministic size,
exact-hash auth, episode verify.**

Binance Agent OS gives agents financial capabilities. LUJAW bounds Spot orders
before they hit Binance — then verifies what actually filled.

Does not make trading safe or profitable. Does not stop a bypass of LUJAW.
```

Keep the existing tool table, architecture diagram, and demo instructions below that lead. Demote Venus to a short secondary note after the primary Spot section.

## Docs voice map

| Doc | Lead sentence |
|---|---|
| `docs/binance-cursor-demo.md` | Seatbelt demo in Cursor: policy → preflight → authorize → Binance confirm → episode verify. |
| `docs/binance-no-funds-demo.md` | Prove the seatbelt with no funds: simulated ALLOW path + live empty-account BLOCK. |
| `docs/binance-threat-model.md` | What the seatbelt covers — and what it does not (bypass, attestation, profit). |
| `docs/binance-live-gate.md` | Live-gate checklist before real Spot spend. |
| `packages/core/README.md` | Deterministic policy engines behind the seatbelt. Spot primary; Venus secondary. |
| `apps/agent/README.md` | MCP surface that exposes the seatbelt tools to Cursor. |
| Root `binance-cex-impl.md` | Keep as implementation plan; align executive claim with locked README one-liner. |

Do not rewrite every paragraph of technical docs. Update titles, opening claims, and any Venus-first framing that contradicts Spot-primary.

## Lexicon

### Prefer

- seatbelt  
- bounds / bounded  
- Spot (Binance Spot)  
- policy, preflight, authorize, verify / episode  
- ALLOW / REDUCE / BLOCK  
- exact-hash / one-shot authorization  
- Agentic sub-account  
- host-mediated  

### Avoid on marketing surfaces

- “makes trading safe” / “risk-free” / “guaranteed”  
- “unbypassable” / “agents cannot bypass LUJAW”  
- “autonomous portfolio management” / profit / alpha  
- Venus, Care Plan, Altana, collateral top-up, rescue (hero / eyebrow / title)  
- long adjective stacks (“bounded, explainable, and independently verifiable”) as the hero  

### Honesty lines (must survive somewhere visible)

1. Does not make trading safe or profitable. Does not stop a bypass of LUJAW.  
2. LUJAW does not store Binance OAuth tokens and does not cryptographically attest host-supplied Binance evidence in v1.  
3. Venus remains a secondary adapter.

## Implementation scope

1. `apps/web/lib/site.ts` — brand strings, hero, footer, meta, CTA label  
2. `apps/web/components/HowItWorks.tsx` — layer copy + section header  
3. `apps/web/components/DocsSection.tsx` — H2 to match CTA  
4. Root `README.md` — opening claim + honesty; Venus demotion if still loud  
5. Core docs listed above — opening alignment only  
6. Optional: `.cursor/rules` / skill blurbs if they still lead with Venus

Out of scope for this rebrand pass: visual redesign, new pages, tool renames, product behavior changes.

## Success criteria

- A judge reading only the first viewport understands: Binance agents + Spot + seatbelt, not Venus rescue.  
- README opening matches landing wedge in one sentence.  
- No hero/meta claim that contradicts the threat model.  
- Venus appears only as secondary / footnote language.
