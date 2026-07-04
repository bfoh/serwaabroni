# SerwaaBroni Agent — Design Spec

**Date:** 2026-07-04
**Status:** Approved (design), pending implementation plan

## 1. Summary

Add a voice-first AI agent named **SerwaaBroni** to the app. It lets a market
trader run their bookkeeping by speaking (Twi or English) instead of filling
forms. The agent does three things:

1. **Stock / restock** — take spoken product info and create products or add
   stock, then save via the existing store.
2. **Sales** — take spoken sale info (cash or credit) and record it.
3. **Info & alerts** — answer any question about the business in real time and
   surface alerts, spoken back to the user.

The agent **never writes to the database directly**. Claude only *proposes*
structured actions; every money-moving action is confirmed by the user on a
preview card, then written through the existing, battle-tested store functions
(`addSale`, `addSaleBatch`, `addProduct`, `addDebt`, `addExpense`,
`updateProduct`). This reuses all current validation, FIFO, cash-posting, RLS,
and offline-sync logic, so there is no parallel data path and no new
data-integrity risk.

## 2. Decisions (locked)

| Decision | Choice |
|---|---|
| Interaction modality | Voice-first (Phase 1 English browser voice; Twi in Phase 2) |
| Write safety | Always show a confirm card before any money-moving write |
| LLM backend | Claude via Supabase Edge Function (key server-side) |
| Cost model | App owner absorbs; keep cheap (Haiku, snapshotting, usage guard) |
| Twi speech-to-text | GhanaNLP Khaya (ASR/translate/TTS) for Twi; browser Web Speech for English |
| Uncertain recognition | Agent re-asks the unclear slot by voice, confirm-card fields still editable |
| Capital-injection / loan setup | Out of agent scope — remains manual (too many financial params for voice) |

## 3. Architecture

```
User speaks (Twi/English)
      │
      ▼
[STT router]  English → browser Web Speech (free)
              Twi     → GhanaNLP Khaya ASR (+ Twi→English translate)
      │  transcript (English)
      ▼
[serwaa-agent Edge Function]  Supabase Deno fn → Claude Haiku (tool-calling)
      │  system prompt = business snapshot + tool schema
      │  authenticates Supabase user (JWT) before calling Claude
      ▼
[Client executor]  maps returned tool call → existing store fn
      │
      ├─ money-moving action → CONFIRM CARD → user taps ✓ → store write → sync
      └─ read/info action    → answer immediately
      │
      ▼
[TTS]  Khaya TTS (Twi) / browser speech (English) speaks the reply
```

**Turn loop:** listen → transcribe → call agent → (execute read | render confirm
card for write) → speak reply.

## 4. New components

| File | Purpose |
|---|---|
| `supabase/functions/serwaa-agent/index.ts` | Claude proxy. Holds `ANTHROPIC_API_KEY`. Auth's the Supabase user, receives transcript + business snapshot, returns tool calls / text. Enforces monthly usage guard. |
| `supabase/functions/serwaa-speech/index.ts` | Thin Khaya proxy holding `KHAYA_API_KEY` (ASR / translate / TTS). Auth'd. |
| `src/lib/agent/tools.ts` | Claude tool schema + client-side executor mapping each tool → store fn. |
| `src/lib/agent/speech.ts` | STT router (Web Speech ↔ Khaya) + TTS; confidence scoring → slot re-ask. |
| `src/lib/agent/khaya.ts` | Client for the `serwaa-speech` edge fn. |
| `src/lib/agent/snapshot.ts` | Builds the compact, token-capped business snapshot from `state`. |
| `src/components/agent/AgentSheet.tsx` | Full-screen voice UI: mic button, live transcript, agent bubbles, confirm cards. |
| `src/components/agent/ConfirmCard.tsx` | Preview of proposed sale/stock/debt; tap ✓ / edit field / ✗. |
| `src/hooks/useAgent.ts` | Orchestrates the turn loop. |

Entry point: a floating mic FAB (e.g. on Home). No changes to existing pages or
data model.

## 5. Tools (the 3 tasks)

All tools are allow-listed. Claude cannot run arbitrary code — only these
actions, all client-executed with existing `user_id`/RLS scoping.

### Task 1 — Stock / restock
- `new_product{ name, cost_price, sell_price, qty, category?, payment: cash|bank|supplier_credit }`
  → `addProduct(..., opts)`
- `add_stock{ product_match, qty, cost_price? }`
  → fuzzy-match spoken name against `state.products`; on ambiguity, agent
  re-asks. Increases quantity via `updateProduct` (or the existing restock path).

### Task 2 — Sales
- `add_sale{ items: [{product_match, qty}], payment: cash|bank }` → `addSaleBatch`
- `add_credit_sale{ items: [...], customer_name, due_date? }` → `addSaleBatch` + `addDebt`
- Multi-item in a single utterance supported.

### Task 3 — Info & alerts (read-only over `state`)
- `get_summary{ period: daily|weekly|monthly|yearly }`
- `get_low_stock`
- `get_debts{ direction: owed|owing }`
- `get_top_products`
- `get_alerts` → `generateAlerts()`

Read tools answer immediately and are spoken back; no confirm card.

## 6. Cost control

- **Model:** Claude Haiku on every turn.
- **No long history:** send only the last ~4 turns plus a compact snapshot.
- **Snapshot capping** (`snapshot.ts`): products trimmed to `name+id+qty`;
  totals pre-aggregated client-side. Target ~1–2K tokens/turn.
- **Khaya only for Twi**; English STT/TTS is the free browser API.
- Estimated **< $0.005 per typical interaction**.
- **Usage guard** in the edge fn: hard monthly cap per tenant to bound cost.

## 7. Security

- `ANTHROPIC_API_KEY` and `KHAYA_API_KEY` live only in Supabase secrets — never
  shipped to the SPA.
- Edge functions verify the Supabase user JWT before any upstream call — no open
  proxy.
- Tools are allow-listed and client-executed; writes go through existing store
  functions with existing RLS and `user_id` scoping.
- Mandatory confirm card = human in the loop on every money-moving write.

## 8. Phasing

- **Phase 1 (MVP):** English voice (free browser STT/TTS) + text; all three task
  tools; confirm cards; read/alerts. Proves the loop end-to-end, cheaply.
- **Phase 2:** Khaya Twi ASR + TTS; slot-by-slot re-ask; multi-item sales.
- **Phase 3:** proactive spoken alerts (low stock, overdue debts); daily spoken
  briefing; SerwaaBroni personality/brand voice.

## 9. Pros / Cons

**Pros**
- Real accessibility leap for low-literacy traders — speak in Twi, books keep
  themselves. This is the differentiator / award angle.
- Reuses the existing store → low integrity risk, fast to build.
- Reads work offline (local `state`); writes queue via existing sync.
- No Ghanaian SME bookkeeping app offers a Twi voice agent.

**Cons / risks**
- **Twi ASR accuracy** is the top risk (noisy markets, code-switching). Khaya is
  the best available but imperfect — mitigated by slot re-ask + confirm card.
- Recurring LLM + Khaya cost scales with active users (owner absorbs) —
  mitigated by Haiku + snapshotting + usage guard.
- Cloud STT dependency: voice needs connectivity. Offline degrades to English
  browser STT or manual entry.
- Number/price misrecognition in money records — mitigated hard by the mandatory
  confirm card.

## 10. Out of scope (this spec)

- Capital-injection / loan setup by voice (stays manual).
- Editing or deleting existing records by voice (Phase 3+ candidate).
- Billing / paid-tier gating (owner absorbs cost for now).
