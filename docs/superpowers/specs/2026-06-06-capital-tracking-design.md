# Capital Injection Tracking — Design Spec

**Date:** 2026-06-06
**App:** serwaabroni (React + TS + Vite, Supabase, offline-first, Ghana/GHS retail shop management)
**Status:** Approved design, pending implementation plan

## Problem

A shop owner regularly injects capital into her business — microfinance loans,
personal money, money from family/friends, or outside investment. She wants to
track **every pesewa** of that capital from the day it enters the business until
it is paid off (typically a 3–6 month window). Specifically she wants to:

- Identify exactly which new stock each capital injection purchased.
- See the turnover and the revenue/profit that stock generates.
- Know whether that profit is coming fast enough to repay the capital on schedule.
- Get alerted when she is at risk of not repaying on time.
- See a periodic report on how the funded stock is performing.

## Decisions (from brainstorming)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Capital→stock link precision | **Per-purchase batch** — every pesewa traceable via a stock-purchase ledger |
| 2 | Sale→capital attribution | **Batch ledger + FIFO consumption** with a per-sale audit trail |
| 3 | Repayment shape | **Fixed installments** (equal, monthly, over the payback period) |
| 4 | Which injections repay | **All** — every injection gets a payback schedule, even personal money |
| 5 | Interest | **Optional per injection** — `total_repayable = principal + interest` |
| 6 | Risk basis | **Profit pace vs schedule** (self-liquidating model) |
| 7 | Profit accounting | **Batch-accurate everywhere** — sale, dashboard, reports all use batch cost |
| 8 | Reports | **Weekly, in-app only**, computed on read |
| 9 | Alerts | **In-app + SMS** on risk transition / overdue installment |
| 10 | Placement | Capital nested as a tab in the **Debts** page + a **Home** summary card |

## Architecture overview

The tracking chain: **Capital In → Stock bought → Sales of that stock → Profit → Repayment.**

The hard link is sale→stock→capital. We make it precise with an inventory batch
ledger. Each restock becomes a *purchase line* (a batch) optionally tagged to a
capital injection. Each sale consumes batch units FIFO and writes an audit row,
so the profit attributable to any injection is a single indexed query. That
cumulative profit, compared against the installment schedule and projected to the
deadline, powers the risk engine, the alerts, and the weekly report.

## Data model

All tables `user_id`-scoped with RLS, matching every existing table. Added to the
Supabase realtime publication where the UI needs live updates
(`capital_injections`, `repayment_installments`, `stock_batches`).

### `capital_injections`
One row per money-in event.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid pk | |
| `user_id` | uuid fk auth.users | RLS scope |
| `source` | text | `microfinance` \| `personal` \| `family_friends` \| `investment` \| `other` |
| `lender_name` | text null | who it's from / repayable to |
| `principal` | decimal(10,2) | capital received |
| `interest_amount` | decimal(10,2) default 0 | flat interest (optional) |
| `total_repayable` | decimal(10,2) | `principal + interest_amount` |
| `amount_repaid` | decimal(10,2) default 0 | running total she has actually paid |
| `injection_date` | timestamptz | start of the payback clock |
| `payback_months` | int | 3–6 typically |
| `installment_count` | int | number of installments generated |
| `status` | text | `active` \| `repaid` \| `closed` |
| `risk_tier` | text | cached: `on_track` \| `watch` \| `at_risk` (recomputed; see engine) |
| `risk_alerted` | bool default false | dedup flag — SMS already sent for current at-risk state |
| `notes` | text null | |
| `created_at` | timestamptz default now() | |

### `repayment_installments`
Schedule generated when an injection is created.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid pk | |
| `user_id` | uuid fk | RLS scope |
| `injection_id` | uuid fk capital_injections (cascade) | |
| `seq` | int | 1..installment_count |
| `due_date` | timestamptz | spaced monthly from `injection_date` |
| `amount_due` | decimal(10,2) | `round(total_repayable / count)`; last absorbs rounding remainder |
| `amount_paid` | decimal(10,2) default 0 | |
| `paid_at` | timestamptz null | |
| `status` | text | `due` \| `paid` \| `overdue` (derived/maintained) |

### `stock_batches`
A purchase line = stock received into inventory.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid pk | |
| `user_id` | uuid fk | RLS scope |
| `injection_id` | uuid fk capital_injections null | NULL = restock not funded by tracked capital |
| `product_id` | uuid fk products (cascade) | |
| `qty_purchased` | int | units received |
| `qty_remaining` | int | decremented as sales consume it |
| `unit_cost` | decimal(10,2) | cost per unit for this batch |
| `total_cost` | decimal(10,2) | `qty_purchased * unit_cost` |
| `purchased_at` | timestamptz default now() | FIFO ordering key |

### `batch_consumptions`
Audit trail — one row per (sale, batch) draw.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid pk | |
| `user_id` | uuid fk | RLS scope |
| `sale_id` | uuid fk sales (cascade) | |
| `batch_id` | uuid fk stock_batches | |
| `injection_id` | uuid fk capital_injections null | denormalized from batch for fast aggregation |
| `qty` | int | units drawn from this batch |
| `unit_cost` | decimal(10,2) | batch cost (copied for immutability) |
| `unit_price` | decimal(10,2) | sale price per unit |
| `profit` | decimal(10,2) | `(unit_price - unit_cost) * qty` |
| `created_at` | timestamptz default now() | week-bucket key for reports |

**Why `profit` is stored on the consumption row:** cumulative recovery for an
injection is `SELECT SUM(profit) FROM batch_consumptions WHERE injection_id = X`
— one indexed query, no recompute, drives risk + weekly report cheaply.

Indexes: `batch_consumptions(injection_id)`, `batch_consumptions(created_at)`,
`stock_batches(product_id, purchased_at)`, `stock_batches(injection_id)`,
`repayment_installments(injection_id)`, `capital_injections(user_id)`.

## Attribution mechanics

### Restock → "Receive stock"
Today Inventory edits `product.quantity` directly. New flow: receiving stock
creates a `stock_batch` (qty, unit_cost, optional `injection_id`) and bumps the
product. `product.quantity` remains as a denormalized cache equal to
`SUM(qty_remaining)` of the product's open batches. Choosing the funding injection
at receive-time is the only extra interaction.

### Sale → FIFO consumption
`insertSale` currently writes `profit` using the product's current `cost_price`.
New behavior: after the sale row is created, draw down the product's batches
oldest-first (`purchased_at ASC`, `qty_remaining > 0`), decrement each
`qty_remaining`, and write a `batch_consumptions` row per batch touched. The
sale's `profit` becomes the sum of those rows — **batch-accurate**, replacing the
current-cost estimate. Dashboard and Reports read this same true profit.

Edge case — sale quantity exceeds available batch stock (oversell / untracked
stock): consume what batches exist FIFO; any remainder is attributed to a
fallback "untracked" cost using the product's `cost_price`, recorded as a
consumption with `batch_id = NULL` / `injection_id = NULL` so totals still
reconcile and no profit is silently lost.

### Backfill (one-time migration)
Existing products have `quantity` but no batches. The migration creates one
"opening batch" per product: `qty_remaining = current quantity`,
`unit_cost = current cost_price`, `injection_id = NULL`, `purchased_at =
product.created_at`. FIFO then has stock to consume from day one. Historical sales
are **not** retro-attributed (no injections existed before); the feature tracks
forward from the first injection.

### Reversals
Deleting or voiding a sale restores `qty_remaining` on the affected batches and
removes its `batch_consumptions` rows, keeping injection profit correct.

### Offline
The app syncs writes via `sync_queue`. Consumption is computed client-side at
sale time (the client knows the product's batches) and queued like every other
write — no server-only logic that would break offline use.

## Repayment & risk engine

**Schedule generation.** On injection create, generate `installment_count` rows.
`amount_due = round(total_repayable / count)`; the last installment absorbs the
rounding remainder so the sum equals `total_repayable` exactly. `due_date` spaced
one month apart from `injection_date`. Payments are recorded manually against
installments (same UX as the existing Debts partial-payment flow); `amount_repaid`
on the injection is the running total.

**Two independent signals:**

1. **Profit recovery (predictive — the chosen risk basis).**
   `P = SUM(batch_consumptions.profit)` for the injection.
   `days_elapsed = today - injection_date`; `total_days = deadline - injection_date`.
   `pace = P / max(days_elapsed, 1)`; `projected = pace * total_days`.
   `linear_target_now = total_repayable * days_elapsed / total_days`.
2. **Actual repayment (factual).** `amount_repaid` vs installments due-to-date
   (`SUM(amount_due) WHERE due_date <= today`).

**Risk tiers (worst of the two wins):**

| Tier | Condition |
|------|-----------|
| `on_track` | `projected >= total_repayable` AND no overdue unpaid installment |
| `watch` | `projected` is 85–100% of `total_repayable`, OR profit slightly behind `linear_target_now` |
| `at_risk` | `projected < 85%` of `total_repayable`, OR an installment is overdue and unpaid |

**Action insight** (the differentiator): when behind, compute the shortfall
(`total_repayable - projected`) and translate it into required selling pace —
e.g. "GHS 570 short — sell ~8 more cartons/week to stay on track." Derived from
the funded products' remaining quantity, unit margin, and days left.

`risk_tier` is cached on `capital_injections`, recomputed (a) live after every
sale that touches a funded batch, and (b) by the daily scheduled job.

## Alerts

Reuses existing infra: `notifications` table (in-app) and the Arkesel SMS edge
function (respects per-shop `sms_sender_id` from migration_011).

**Fires on state transitions only** — `risk_alerted` dedup flag prevents repeat
SMS for the same at-risk state (same idea as `debts.reminder_sent`):

- `on_track`/`watch` → `at_risk` (first crossing): in-app **+ SMS**
  ("Loan {lender}: GHS {gap} behind. Open app.").
- Installment becomes overdue & unpaid: in-app **+ SMS**.
- `at_risk` → `on_track` (recovered): in-app only (positive nudge, clears
  `risk_alerted`).

**Computation cadence:** risk recalculated (a) live after each relevant sale, and
(b) by a daily scheduled job (existing `migration_010_schedule_daily` + edge
functions) so due/overdue installments are caught even on days with no sales.

## Weekly report (in-app, computed on read)

No new table. Group `batch_consumptions` by ISO week (`created_at`). Surfaced in a
"Reports" view inside the Capital section, weeks newest-first.

**All-injections summary (top):** total outstanding, total recovered, count at-risk.

**Per active injection — "This week" card:**
- Profit added this week + week-over-week delta (↑/↓ vs prior week)
- Units sold this week; recovery % now vs 7 days ago
- Risk tier; projected shortfall/surplus
- Next installment + countdown

## UI / placement

- **Home dashboard:** a "Capital & Loans" summary card — total outstanding,
  recovery %, and an at-risk count badge. Tapping opens the Capital view.
- **Debts page:** a third tab alongside Owed / Owing → **Capital**, listing all
  injections with source, total repayable, recovery %, and risk badge.
- **Injection detail screen** (approved layout), four stacked cards:
  1. Header — source, principal + interest, total repayable, deadline, risk badge
  2. Recovery bar — profit recovered vs linear target (dashed marker) + action insight
  3. Repayment schedule — installments (paid / due / upcoming), log-payment action
  4. Stock bought with this capital — per-product sell-through, total turnover + profit
- **Create injection** flow: source, lender, principal, optional interest,
  injection date, payback months, installment count → generates schedule.
- **Receive stock** flow (Inventory): qty, unit cost, optional funding injection →
  creates batch.

## Components / boundaries

- DB migration(s): new tables, indexes, RLS, realtime, backfill opening batches.
- `services/api.ts` (or a new `services/capitalApi.ts`): CRUD for injections,
  installments, batches; FIFO consumption helper; injection profit/risk queries.
- Modify `insertSale` + sale reversal to write/undo `batch_consumptions` and
  decrement/restore `qty_remaining`.
- Modify restock path to create batches; keep `product.quantity` as cache.
- Risk engine module (pure functions: given injection + consumptions +
  installments → tier + projection + insight). Unit-testable in isolation.
- Daily scheduled job: recompute risk, flip overdue installments, fire alerts.
- UI: Capital tab + list, injection detail, create-injection form, receive-stock
  form, Home summary card, weekly report view.

## Testing

- **Risk engine** (pure functions): table-driven tests across on_track / watch /
  at_risk boundaries, rounding, day-0 (`days_elapsed` guard), fully-recovered,
  overdue-installment escalation.
- **FIFO consumption:** single batch, multiple batches, exact-boundary draw,
  oversell fallback, reversal restores quantities and removes consumptions.
- **Schedule generation:** installment amounts sum to `total_repayable`; due dates
  spaced correctly.
- **Backfill migration:** opening batch qty/cost equals product state; product
  quantity cache reconciles with `SUM(qty_remaining)`.
- **Offline:** consumption queued and replays correctly through `sync_queue`.

## Out of scope (YAGNI)

- Retro-attributing historical (pre-injection) sales.
- Variable / amortized interest schedules (flat interest only).
- Multi-currency (GHS only, per existing app).
- PDF export of the weekly report (in-app only for now).
- Auto-paying installments from profit (repayment stays manual).
