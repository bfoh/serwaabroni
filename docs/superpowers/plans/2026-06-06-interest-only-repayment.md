# Interest-only Repayment Option Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user choose, per capital injection, between equal monthly installments and an interest-only schedule with a final balloon payment that includes the full principal.

**Architecture:** Add a `repayment_type` column to `capital_injections`. Add a second schedule generator (`generateInterestOnlyInstallments`) alongside the existing equal one in `capitalRisk.ts`. The service layer (`capitalApi.ts`) picks the generator by type on create/update. The Add/Edit capital sheet gets a two-button toggle. The risk engine, edge function, and `total_repayable` math are untouched.

**Tech Stack:** React + Vite + TypeScript, Supabase (Postgres + RLS), vitest.

**Spec:** `docs/superpowers/specs/2026-06-06-interest-only-repayment-design.md`

---

## File Structure

- `src/lib/capitalRisk.ts` — add `generateInterestOnlyInstallments`; keep `generateInstallments`.
- `src/lib/capitalRisk.test.ts` — add tests for the new generator.
- `src/lib/supabase.ts` — add `repayment_type` to `CapitalInjection`.
- `src/services/capitalApi.ts` — branch generator by type in `createInjection`/`updateInjection`.
- `src/components/CreateInjectionSheet.tsx` — repayment-type toggle + preview branch.
- `src/db/migration_015_repayment_type.sql` — new column (applied by USER in Supabase SQL editor).

---

### Task 1: Schedule generator for interest-only

**Files:**
- Modify: `src/lib/capitalRisk.ts`
- Test: `src/lib/capitalRisk.test.ts`

- [ ] **Step 1: Write the failing tests**

Add this `describe` block to `src/lib/capitalRisk.test.ts` (after the existing `generateInstallments` block, and add `generateInterestOnlyInstallments` to the import on line 2):

```ts
import { generateInstallments, generateInterestOnlyInstallments, computeRisk, type RiskInput } from './capitalRisk'
```

```ts
describe('generateInterestOnlyInstallments', () => {
  it('pays equal interest each month and the principal on the final month', () => {
    const rows = generateInterestOnlyInstallments(100000, 18000, 6, '2026-01-06T00:00:00.000Z')
    expect(rows).toHaveLength(6)
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3, 4, 5, 6])
    expect(rows.slice(0, 5).map((r) => r.amount_due)).toEqual([3000, 3000, 3000, 3000, 3000])
    expect(rows[5].amount_due).toBe(103000)
  })

  it('sums exactly to principal + interest', () => {
    const rows = generateInterestOnlyInstallments(100000, 18000, 6, '2026-01-06T00:00:00.000Z')
    const sum = rows.reduce((s, r) => s + r.amount_due, 0)
    expect(sum).toBeCloseTo(118000, 2)
  })

  it('puts the interest rounding remainder on the final month, then adds principal', () => {
    // 1000 interest / 3 = 333.33; remainder 0.01 lands on the last interest slice.
    const rows = generateInterestOnlyInstallments(9000, 1000, 3, '2026-01-15T00:00:00.000Z')
    expect(rows[0].amount_due).toBe(333.33)
    expect(rows[1].amount_due).toBe(333.33)
    expect(rows[2].amount_due).toBeCloseTo(9333.34, 2) // 333.34 interest + 9000 principal
    const sum = rows.reduce((s, r) => s + r.amount_due, 0)
    expect(sum).toBeCloseTo(10000, 2)
  })

  it('spaces due dates one month apart from the injection date', () => {
    const rows = generateInterestOnlyInstallments(100000, 18000, 3, '2026-01-15T00:00:00.000Z')
    expect(rows[0].due_date.slice(0, 10)).toBe('2026-02-15')
    expect(rows[2].due_date.slice(0, 10)).toBe('2026-04-15')
  })

  it('handles zero interest as a pure balloon', () => {
    const rows = generateInterestOnlyInstallments(5000, 0, 3, '2026-01-15T00:00:00.000Z')
    expect(rows.map((r) => r.amount_due)).toEqual([0, 0, 5000])
  })

  it('handles a single installment as principal + interest', () => {
    const rows = generateInterestOnlyInstallments(5000, 500, 1, '2026-01-15T00:00:00.000Z')
    expect(rows).toHaveLength(1)
    expect(rows[0].amount_due).toBe(5500)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/ebenezerbarning/Desktop/sb/serwaabroni && npx vitest run src/lib/capitalRisk.test.ts`
Expected: FAIL — `generateInterestOnlyInstallments is not a function` / import error.

- [ ] **Step 3: Implement the generator**

In `src/lib/capitalRisk.ts`, add this function immediately after `generateInstallments` (it reuses the existing `round2` and `addMonthsUtc` helpers):

```ts
// Interest-only schedule with a final balloon. Each month pays an equal slice of
// the interest; the last interest slice absorbs the rounding remainder so the
// interest slices sum exactly to `interest`. The final month additionally carries
// the full principal. Total still sums to principal + interest.
export function generateInterestOnlyInstallments(
  principal: number,
  interest: number,
  count: number,
  injectionDateIso: string
): GeneratedInstallment[] {
  const baseInterest = round2(interest / count)
  const rows: GeneratedInstallment[] = []
  for (let i = 1; i <= count; i++) {
    const interestSlice = i === count
      ? round2(interest - baseInterest * (count - 1))
      : baseInterest
    const amount = i === count ? round2(interestSlice + principal) : interestSlice
    rows.push({
      seq: i,
      due_date: addMonthsUtc(injectionDateIso, i).toISOString(),
      amount_due: amount,
    })
  }
  return rows
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/ebenezerbarning/Desktop/sb/serwaabroni && npx vitest run src/lib/capitalRisk.test.ts`
Expected: PASS — all `generateInterestOnlyInstallments` cases green, existing cases still green.

- [ ] **Step 5: Commit**

```bash
cd /Users/ebenezerbarning/Desktop/sb/serwaabroni
git add src/lib/capitalRisk.ts src/lib/capitalRisk.test.ts
git commit -m "feat: interest-only + balloon schedule generator"
```

---

### Task 2: Migration + type for repayment_type

**Files:**
- Create: `src/db/migration_015_repayment_type.sql`
- Modify: `src/lib/supabase.ts:126-143` (the `CapitalInjection` interface)

- [ ] **Step 1: Write the migration**

Create `src/db/migration_015_repayment_type.sql`:

```sql
-- migration_015: per-injection repayment type.
-- 'equal'         = existing behavior: equal monthly installments of total_repayable.
-- 'interest_only' = pay interest each month; final month also pays full principal.
ALTER TABLE capital_injections
  ADD COLUMN IF NOT EXISTS repayment_type TEXT NOT NULL DEFAULT 'equal'
  CHECK (repayment_type IN ('equal','interest_only'));
```

- [ ] **Step 2: Add the field to the type**

In `src/lib/supabase.ts`, add `repayment_type` to the `CapitalInjection` interface, right after `installment_count: number`:

```ts
  installment_count: number
  repayment_type: 'equal' | 'interest_only'
```

- [ ] **Step 3: Typecheck**

Run: `cd /Users/ebenezerbarning/Desktop/sb/serwaabroni && npx tsc --noEmit`
Expected: errors only in `capitalApi.ts` / `CreateInjectionSheet.tsx` referencing the new field once wired (next tasks), OR clean if those aren't yet touched. No errors in `supabase.ts`.

- [ ] **Step 4: Commit**

```bash
cd /Users/ebenezerbarning/Desktop/sb/serwaabroni
git add src/db/migration_015_repayment_type.sql src/lib/supabase.ts
git commit -m "feat: repayment_type column + type for capital injections"
```

---

### Task 3: Branch the generator in the service layer

**Files:**
- Modify: `src/services/capitalApi.ts` (imports, `createInjection`, `updateInjection`)

- [ ] **Step 1: Import the new generator**

In `src/services/capitalApi.ts`, update the import on the existing line:

```ts
import { generateInstallments, generateInterestOnlyInstallments, computeRisk } from '@/lib/capitalRisk'
```

- [ ] **Step 2: Accept and use repayment_type in createInjection**

Change the `createInjection` input type to add the field (after `installment_count: number`):

```ts
export async function createInjection(input: {
  source: CapitalSource
  lender_name: string | null
  principal: number
  interest_amount: number
  injection_date: string
  payback_months: number
  installment_count: number
  repayment_type: 'equal' | 'interest_only'
  notes: string | null
}): Promise<CapitalInjection> {
```

Then replace the schedule-generation line:

```ts
  const rows = generateInstallments(total_repayable, input.installment_count, input.injection_date)
    .map((r) => ({ ...r, user_id: uid, injection_id: injection.id }))
```

with:

```ts
  const generated = input.repayment_type === 'interest_only'
    ? generateInterestOnlyInstallments(input.principal, input.interest_amount, input.installment_count, input.injection_date)
    : generateInstallments(total_repayable, input.installment_count, input.injection_date)
  const rows = generated.map((r) => ({ ...r, user_id: uid, injection_id: injection.id }))
```

(`repayment_type` is already persisted because the insert spreads `...input`.)

- [ ] **Step 3: Accept and use repayment_type in updateInjection**

Add `repayment_type` to the `updates` type (after `payback_months?: number`):

```ts
export async function updateInjection(id: string, updates: {
  source?: CapitalSource
  lender_name?: string | null
  principal?: number
  interest_amount?: number
  payback_months?: number
  repayment_type?: 'equal' | 'interest_only'
}): Promise<void> {
```

After the existing `const newMonths = ...` line, add:

```ts
  const newType = updates.repayment_type ?? injection.repayment_type
```

Change the regeneration trigger condition to include the type:

```ts
  if (updates.principal !== undefined || updates.interest_amount !== undefined || updates.payback_months !== undefined || updates.repayment_type !== undefined) {
```

Inside that block, replace the generation line:

```ts
    const rows = generateInstallments(total_repayable, newMonths, injection.injection_date)
```

with:

```ts
    const generated = newType === 'interest_only'
      ? generateInterestOnlyInstallments(newPrincipal, newInterest, newMonths, injection.injection_date)
      : generateInstallments(total_repayable, newMonths, injection.injection_date)
    const rows = generated
```

(The `.map(...)` chain that follows stays attached to `generated`.)

- [ ] **Step 4: Typecheck**

Run: `cd /Users/ebenezerbarning/Desktop/sb/serwaabroni && npx tsc --noEmit`
Expected: only remaining error is in `CreateInjectionSheet.tsx` (calls don't yet pass `repayment_type`), fixed in Task 4. No errors in `capitalApi.ts`.

- [ ] **Step 5: Commit**

```bash
cd /Users/ebenezerbarning/Desktop/sb/serwaabroni
git add src/services/capitalApi.ts
git commit -m "feat: pick schedule generator by repayment_type on create/update"
```

---

### Task 4: Repayment-type toggle in the sheet

**Files:**
- Modify: `src/components/CreateInjectionSheet.tsx`

- [ ] **Step 1: Add state + seed/reset**

Add state alongside the others (after the `months` state):

```ts
  const [repaymentType, setRepaymentType] = useState<'equal' | 'interest_only'>('equal')
```

In the edit-seeding `useEffect`, after `setMonths(injection.payback_months.toString())`, add:

```ts
      setRepaymentType(injection.repayment_type)
```

In `reset()`, append:

```ts
    setRepaymentType('equal')
```

(Resulting `reset` body: `setSource('microfinance'); setLender(''); setPrincipal(''); setInterest(''); setMonths('3'); setRepaymentType('equal')`.)

- [ ] **Step 2: Pass repayment_type to both calls**

In `submit`, add `repayment_type: repaymentType,` to the `updateInjection` updates object (after `payback_months: m,`) and to the `createInjection` input (after `installment_count: m,`).

- [ ] **Step 3: Add the toggle UI**

In the JSX, immediately after the "Payback months" field block (the closing `</div>` of that `space-y-1` block) and before the `{total > 0 && (...)}` preview, insert:

```tsx
          <div className="space-y-1">
            <label className="text-xs text-ink font-medium">Repayment type</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setRepaymentType('equal')}
                className={`text-xs px-3 py-2 rounded-sm harsh-border ${repaymentType === 'equal' ? 'bg-ink text-white' : 'bg-white'}`}
              >
                Equal installments
              </button>
              <button
                type="button"
                onClick={() => setRepaymentType('interest_only')}
                className={`text-xs px-3 py-2 rounded-sm harsh-border ${repaymentType === 'interest_only' ? 'bg-ink text-white' : 'bg-white'}`}
              >
                Interest-only + balloon
              </button>
            </div>
          </div>
```

- [ ] **Step 4: Branch the preview text**

Replace the existing preview block:

```tsx
          {total > 0 && (
            <p className="text-xs text-muted-text">
              Total to repay: <strong>GHS {total.toFixed(2)}</strong> over {months || '3'} monthly installments.
            </p>
          )}
```

with:

```tsx
          {total > 0 && (() => {
            const m = Math.max(1, parseInt(months) || 3)
            const p = parseFloat(principal) || 0
            const intAmt = parseFloat(interest) || 0
            const perMonthInterest = Math.round((intAmt / m) * 100) / 100
            const finalMonth = Math.round((perMonthInterest + p) * 100) / 100
            return repaymentType === 'interest_only' ? (
              <p className="text-xs text-muted-text">
                Interest <strong>GHS {perMonthInterest.toFixed(2)}</strong>/mo for {m} months; final month{' '}
                <strong>GHS {finalMonth.toFixed(2)}</strong> (incl. principal). Total GHS {total.toFixed(2)}.
              </p>
            ) : (
              <p className="text-xs text-muted-text">
                Total to repay: <strong>GHS {total.toFixed(2)}</strong> over {months || '3'} monthly installments.
              </p>
            )
          })()}
```

- [ ] **Step 5: Typecheck + build**

Run: `cd /Users/ebenezerbarning/Desktop/sb/serwaabroni && npx tsc --noEmit && npm run build`
Expected: tsc clean; build OK. (Pre-existing lint errors in Dashboard/Reports/supabaseApi are unrelated — do not "fix" them.)

- [ ] **Step 6: Commit**

```bash
cd /Users/ebenezerbarning/Desktop/sb/serwaabroni
git add src/components/CreateInjectionSheet.tsx
git commit -m "feat: repayment type toggle + balloon preview in capital sheet"
```

---

### Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole test suite**

Run: `cd /Users/ebenezerbarning/Desktop/sb/serwaabroni && npx vitest run`
Expected: all tests pass (existing 21 + new interest-only cases).

- [ ] **Step 2: Typecheck + build**

Run: `cd /Users/ebenezerbarning/Desktop/sb/serwaabroni && npx tsc --noEmit && npm run build`
Expected: clean tsc, successful build.

- [ ] **Step 3: Note manual steps for the user**

These cannot be done by the agent — surface them in the final summary:
1. Apply `src/db/migration_015_repayment_type.sql` in the Supabase SQL editor.
2. Smoke test in the live app: create an interest-only injection (e.g. 100,000 / 18,000 / 6 months), confirm the schedule shows 5 × GHS 3,000 then GHS 103,000, and that recording payments walks installments correctly.

---

## Self-Review Notes

- **Spec coverage:** migration (Task 2), generator (Task 1), service branch (Task 3), types (Task 2), UI toggle + preview (Task 4), tests (Task 1), risk/edge-fn untouched (no task — by design). All spec sections covered.
- **Type consistency:** `repayment_type: 'equal' | 'interest_only'` used identically in `supabase.ts`, `capitalApi.ts` (create input + update updates), and `CreateInjectionSheet.tsx`. Generator name `generateInterestOnlyInstallments` consistent across import, impl, tests, and both call sites.
- **No placeholders:** every code/step shows concrete content and exact commands.
