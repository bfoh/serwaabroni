# Interest-only repayment option — design

**Date:** 2026-06-06
**App:** serwaabroni (`/Users/ebenezerbarning/Desktop/sb/serwaabroni`)
**Feature area:** capital-injection tracking (see `2026-06-06-capital-tracking-design.md`)

## Problem

The capital tracker currently builds one repayment schedule shape: **equal monthly
installments** — every month pays an equal slice of `total_repayable`
(`principal + interest`), the last absorbing the rounding remainder.

A real user reports a second, common Ghana microfinance shape: **interest-only +
balloon**. The borrower pays only the interest each month, and on the final month
pays the last interest slice **plus the entire principal** in one lump.

The user wants to choose, per loan, which shape applies.

## Decisions (locked)

- **Per-injection toggle.** Repayment type is chosen in the Add/Edit capital sheet.
  Each injection can differ. No global setting.
- **Interest split = equal across ALL months.** For interest-only, each month's
  interest slice is `interest / count` (including the final month). The final
  month additionally carries the full principal.
  - Example: principal 100,000, interest 18,000, 6 months →
    months 1–5 = 3,000 each; month 6 = 3,000 + 100,000 = 103,000.
- **`total_repayable` unchanged** = `principal + interest`, regardless of type.
- **Risk engine unchanged.** `computeRisk` is profit-pace-vs-total plus a
  per-installment overdue check; both remain valid. The balloon simply makes the
  final installment large, and overdue detection already reads each row's
  `amount_due`. Linear target stays (conservative for back-loaded schedules).
- **Edge fn `daily-tasks` risk mirror unchanged** — it reads installments + totals
  and is repayment-type-agnostic.

## Data model

`migration_015`: add to `capital_injections`

```sql
ALTER TABLE capital_injections
  ADD COLUMN repayment_type TEXT NOT NULL DEFAULT 'equal'
  CHECK (repayment_type IN ('equal','interest_only'));
```

Existing rows default to `'equal'` → no behavior change for live data.

## Schedule generator (`src/lib/capitalRisk.ts`)

Keep existing `generateInstallments(total, count, dateIso)` for `'equal'`.

Add:

```ts
export function generateInterestOnlyInstallments(
  principal: number,
  interest: number,
  count: number,
  injectionDateIso: string
): GeneratedInstallment[]
```

Behavior:
- For `i` in `1..count`: interest slice = `round2(interest / count)`, except the
  **last interest slice absorbs the rounding remainder** so the interest slices
  sum exactly to `interest` (mirrors the equal generator's remainder handling, but
  on the interest portion — because the final month also carries principal).
- Final month (`i === count`): `amount_due = (final interest slice) + principal`.
- Returns the same `GeneratedInstallment[]` shape (`seq`, `due_date`, `amount_due`),
  same UTC `addMonthsUtc` date math.
- Invariant: `sum(amount_due) === round2(principal + interest)` (= `total_repayable`).

Edge cases:
- `interest === 0` → every month 0 except final = principal. (Degenerate but valid;
  it's effectively a pure balloon.)
- `count === 1` → single installment = principal + interest (same as equal).

## Service (`src/services/capitalApi.ts`)

`createInjection` input gains `repayment_type: 'equal' | 'interest_only'`.
- Persist `repayment_type` on the row (spread into insert).
- Pick generator:
  - `'equal'` → `generateInstallments(total_repayable, count, date)`
  - `'interest_only'` → `generateInterestOnlyInstallments(principal, interest, count, date)`

`updateInjection` updates gain optional `repayment_type`.
- When any of `principal | interest_amount | payback_months | repayment_type`
  changes, regenerate the schedule using the (possibly new) type, then re-apply
  `amount_repaid` across the regenerated rows in seq order (existing logic,
  unchanged — it walks rows and fills `amount_paid` greedily).

No change to `total_repayable` computation.

## Types (`src/lib/supabase.ts`)

Add to `CapitalInjection`:

```ts
repayment_type: 'equal' | 'interest_only'
```

## UI (`src/components/CreateInjectionSheet.tsx`)

- New state `repaymentType: 'equal' | 'interest_only'` (default `'equal'`; seeded
  from `injection.repayment_type` when editing; reset to `'equal'`).
- Two-button toggle "Repayment type" (same `harsh-border` button style as the
  source picker):
  - `Equal installments`
  - `Interest-only + balloon`
- Pass `repayment_type` in both `createInjection` and `updateInjection` calls.
- Preview line branches:
  - `equal` (current): "Total to repay: GHS {total} over {months} monthly installments."
  - `interest_only`: "Interest GHS {round2(interest/months)}/mo for {months} months;
    final month GHS {round2(interest/months) + principal} (incl. principal).
    Total GHS {total}."

## Tests (`src/lib/capitalRisk.test.ts`)

Add cases for `generateInterestOnlyInstallments`:
- Returns `count` rows with correct `seq`/`due_date` sequence.
- `sum(amount_due) === round2(principal + interest)`.
- Months `1..count-1` each equal `round2(interest/count)`.
- Final row = (interest slice incl. remainder) + principal.
- Rounding remainder lands on the final interest slice (e.g. interest that doesn't
  divide evenly).
- `interest === 0` and `count === 1` edge cases.

## Out of scope

- Changing the risk model / linear target for back-loaded schedules.
- Migrating any existing injection off `'equal'`.
- Editing the `daily-tasks` edge function.
