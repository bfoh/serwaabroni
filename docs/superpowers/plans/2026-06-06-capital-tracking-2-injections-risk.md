# Capital Tracking — Plan 2: Capital Injections, Repayment & Risk Engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner record a capital injection, auto-generate its monthly repayment schedule, and see — per injection — how much profit the funded stock has recovered, whether she is on track, and what to do if not.

**Architecture:** Two new tables (`capital_injections`, `repayment_installments`) plus an FK from `stock_batches.injection_id` (created nullable in Plan 1). A pure module (`capitalRisk.ts`) generates schedules and computes the risk tier + projection + action insight from numbers only — fully unit-tested. A thin `capitalApi.ts` does the I/O, including the one query that powers everything: cumulative profit per injection = `SUM(batch_consumptions.profit) WHERE injection_id`. Capital is its own route (`/capital`, `/capital/:id`), reachable from a Dashboard card and a Debts "Capital" entry, following the existing `/settings` route pattern. Receiving stock can now be tagged to an injection.

**Tech Stack:** React 19 + TS + Vite, react-router 7, Supabase + RLS, Vitest, date-fns (installment dates), Tailwind/shadcn, lucide-react icons.

**Depends on:** Plan 1 (batch ledger + `batch_consumptions.injection_id`). Do not start until Plan 1 is merged and its migration applied.

**Spec:** `docs/superpowers/specs/2026-06-06-capital-tracking-design.md` (sections: Data model → `capital_injections`/`repayment_installments`; Repayment & risk engine; UI / placement).

---

### Task 1: Database migration — injections + installments

**Files:**
- Create: `src/db/migration_013_capital_injections.sql`

- [ ] **Step 1: Write the migration**

```sql
-- migration_013: capital injections + repayment installment schedule
-- An injection is money put into the business (loan/personal/family/investment).
-- It has a fixed monthly installment schedule and is "recovered" by the profit of
-- the stock_batches it funded (stock_batches.injection_id, FK wired here).

CREATE TABLE IF NOT EXISTS capital_injections (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'other'
    CHECK (source IN ('microfinance','personal','family_friends','investment','other')),
  lender_name TEXT,
  principal DECIMAL(10,2) NOT NULL,
  interest_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  total_repayable DECIMAL(10,2) NOT NULL,
  amount_repaid DECIMAL(10,2) NOT NULL DEFAULT 0,
  injection_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  payback_months INTEGER NOT NULL DEFAULT 3,
  installment_count INTEGER NOT NULL DEFAULT 3,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','repaid','closed')),
  risk_tier TEXT NOT NULL DEFAULT 'on_track' CHECK (risk_tier IN ('on_track','watch','at_risk')),
  risk_alerted BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE capital_injections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own injections"
  ON capital_injections FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own injections"
  ON capital_injections FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own injections"
  ON capital_injections FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own injections"
  ON capital_injections FOR DELETE USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS repayment_installments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  injection_id UUID NOT NULL REFERENCES capital_injections(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  due_date TIMESTAMPTZ NOT NULL,
  amount_due DECIMAL(10,2) NOT NULL,
  amount_paid DECIMAL(10,2) NOT NULL DEFAULT 0,
  paid_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'due' CHECK (status IN ('due','paid','overdue'))
);

ALTER TABLE repayment_installments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own installments"
  ON repayment_installments FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own installments"
  ON repayment_installments FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own installments"
  ON repayment_installments FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own installments"
  ON repayment_installments FOR DELETE USING (auth.uid() = user_id);

-- Wire the FK reserved in Plan 1 (migration_012 left injection_id un-constrained).
ALTER TABLE stock_batches
  ADD CONSTRAINT fk_batches_injection
  FOREIGN KEY (injection_id) REFERENCES capital_injections(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_injections_user ON capital_injections(user_id);
CREATE INDEX IF NOT EXISTS idx_installments_injection ON repayment_installments(injection_id);

ALTER PUBLICATION supabase_realtime ADD TABLE capital_injections;
ALTER PUBLICATION supabase_realtime ADD TABLE repayment_installments;
```

- [ ] **Step 2: Apply in the Supabase SQL editor** and verify:

```sql
SELECT count(*) FROM capital_injections;        -- 0
SELECT count(*) FROM repayment_installments;     -- 0
-- FK exists:
SELECT conname FROM pg_constraint WHERE conname = 'fk_batches_injection';
```
Expected: both tables empty, the FK constraint listed.

- [ ] **Step 3: Commit**

```bash
git add src/db/migration_013_capital_injections.sql
git commit -m "feat: capital_injections + repayment_installments schema"
```

---

### Task 2: Types

**Files:**
- Modify: `src/lib/supabase.ts` (append after `BatchConsumption`)

- [ ] **Step 1: Add interfaces**

```ts
export type CapitalSource = 'microfinance' | 'personal' | 'family_friends' | 'investment' | 'other'
export type RiskTier = 'on_track' | 'watch' | 'at_risk'

export interface CapitalInjection {
  id: string
  user_id: string
  source: CapitalSource
  lender_name: string | null
  principal: number
  interest_amount: number
  total_repayable: number
  amount_repaid: number
  injection_date: string
  payback_months: number
  installment_count: number
  status: 'active' | 'repaid' | 'closed'
  risk_tier: RiskTier
  risk_alerted: boolean
  notes: string | null
  created_at: string
}

export interface RepaymentInstallment {
  id: string
  user_id: string
  injection_id: string
  seq: number
  due_date: string
  amount_due: number
  amount_paid: number
  paid_at: string | null
  status: 'due' | 'paid' | 'overdue'
}
```

- [ ] **Step 2: Typecheck** — Run: `npx tsc -b --noEmit` — Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/supabase.ts
git commit -m "feat: CapitalInjection + RepaymentInstallment types"
```

---

### Task 3: Schedule generator (pure) — TDD

**Files:**
- Create: `src/lib/capitalRisk.ts`
- Test: `src/lib/capitalRisk.test.ts`

- [ ] **Step 1: Write the failing tests** — create `src/lib/capitalRisk.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { generateInstallments } from './capitalRisk'

describe('generateInstallments', () => {
  it('splits the total into equal monthly amounts', () => {
    const rows = generateInstallments(900, 3, '2026-01-15T00:00:00.000Z')
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.amount_due)).toEqual([300, 300, 300])
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3])
  })

  it('puts the rounding remainder on the last installment so the sum is exact', () => {
    const rows = generateInstallments(1000, 3, '2026-01-15T00:00:00.000Z')
    const sum = rows.reduce((s, r) => s + r.amount_due, 0)
    expect(sum).toBeCloseTo(1000, 2)
    expect(rows[0].amount_due).toBe(333.33)
    expect(rows[2].amount_due).toBeCloseTo(333.34, 2)
  })

  it('spaces due dates one month apart from the injection date', () => {
    const rows = generateInstallments(900, 3, '2026-01-15T00:00:00.000Z')
    expect(rows[0].due_date.slice(0, 10)).toBe('2026-02-15')
    expect(rows[1].due_date.slice(0, 10)).toBe('2026-03-15')
    expect(rows[2].due_date.slice(0, 10)).toBe('2026-04-15')
  })
})
```

- [ ] **Step 2: Run to verify failure** — Run: `npm test` — Expected: FAIL (`generateInstallments` not found).

- [ ] **Step 3: Implement the generator** — create `src/lib/capitalRisk.ts`:

```ts
import { addMonths } from 'date-fns'

export interface GeneratedInstallment {
  seq: number
  due_date: string
  amount_due: number
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// Equal monthly installments; the last absorbs the rounding remainder so the
// installments sum exactly to total.
export function generateInstallments(
  total: number,
  count: number,
  injectionDateIso: string
): GeneratedInstallment[] {
  const base = round2(total / count)
  const start = new Date(injectionDateIso)
  const rows: GeneratedInstallment[] = []
  for (let i = 1; i <= count; i++) {
    const amount = i === count ? round2(total - base * (count - 1)) : base
    rows.push({
      seq: i,
      due_date: addMonths(start, i).toISOString(),
      amount_due: amount,
    })
  }
  return rows
}
```

- [ ] **Step 4: Run to verify pass** — Run: `npm test` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/capitalRisk.ts src/lib/capitalRisk.test.ts
git commit -m "feat: installment schedule generator"
```

---

### Task 4: Risk engine (pure) — TDD

Given an injection's numbers, the recovered profit, and its installments, compute
the tier, the projection, the shortfall, and the required weekly profit to recover.

**Files:**
- Modify: `src/lib/capitalRisk.ts` (add `computeRisk`)
- Modify: `src/lib/capitalRisk.test.ts` (add `computeRisk` tests)

- [ ] **Step 1: Append failing tests** to `src/lib/capitalRisk.test.ts`:

```ts
import { computeRisk, type RiskInput } from './capitalRisk'

const base: RiskInput = {
  injectionDate: '2026-01-01T00:00:00.000Z',
  paybackMonths: 5,
  totalRepayable: 5750,
  recoveredProfit: 2760,
  installments: [],
  now: '2026-04-01T00:00:00.000Z', // ~90 days into a ~150 day term
}

describe('computeRisk', () => {
  it('projects recovery from the current profit pace', () => {
    const r = computeRisk(base)
    // pace = 2760/90 ≈ 30.67/day; term ≈ 150 days → projected ≈ 4600
    expect(r.projected).toBeGreaterThan(4400)
    expect(r.projected).toBeLessThan(4800)
    expect(r.tier).toBe('at_risk') // projected < 85% of 5750 (=4887)
    expect(r.shortfall).toBeGreaterThan(0)
  })

  it('is on_track when projected meets the total and nothing is overdue', () => {
    const r = computeRisk({ ...base, recoveredProfit: 3600 }) // pace 40/day → ~6000
    expect(r.tier).toBe('on_track')
    expect(r.shortfall).toBe(0)
  })

  it('is watch when projected lands between 85% and 100% of the total', () => {
    const r = computeRisk({ ...base, recoveredProfit: 3150 }) // ~5250 projected (91%)
    expect(r.tier).toBe('watch')
  })

  it('escalates to at_risk when an installment is overdue and underpaid', () => {
    const r = computeRisk({
      ...base,
      recoveredProfit: 3600, // would be on_track on pace alone
      installments: [
        { due_date: '2026-02-01T00:00:00.000Z', amount_due: 1150, amount_paid: 0 },
      ],
    })
    expect(r.tier).toBe('at_risk')
  })

  it('guards day zero (no divide-by-zero)', () => {
    const r = computeRisk({ ...base, now: base.injectionDate, recoveredProfit: 0 })
    expect(Number.isFinite(r.projected)).toBe(true)
  })

  it('reports the weekly profit needed to close the gap', () => {
    const r = computeRisk(base)
    expect(r.requiredProfitPerWeek).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run to verify failure** — Run: `npm test` — Expected: FAIL (`computeRisk` not found).

- [ ] **Step 3: Implement `computeRisk`** — append to `src/lib/capitalRisk.ts`:

```ts
import { addMonths as _addMonths } from 'date-fns' // already imported above; keep single import

export interface RiskInstallment {
  due_date: string
  amount_due: number
  amount_paid: number
}

export interface RiskInput {
  injectionDate: string
  paybackMonths: number
  totalRepayable: number
  recoveredProfit: number
  installments: RiskInstallment[]
  now: string
}

export type RiskTier = 'on_track' | 'watch' | 'at_risk'

export interface RiskResult {
  tier: RiskTier
  recoveredProfit: number
  projected: number
  recoveryRatio: number      // recoveredProfit / totalRepayable
  linearTargetNow: number    // where recovery "should" be by now
  shortfall: number          // max(0, total - projected)
  daysLeft: number
  requiredProfitPerWeek: number // to close the shortfall by the deadline
  hasOverdueInstallment: boolean
}

const DAY = 1000 * 60 * 60 * 24

export function computeRisk(input: RiskInput): RiskResult {
  const start = new Date(input.injectionDate).getTime()
  const deadline = addMonths(new Date(input.injectionDate), input.paybackMonths).getTime()
  const now = new Date(input.now).getTime()

  const totalDays = Math.max(1, (deadline - start) / DAY)
  const daysElapsed = Math.max(1, (now - start) / DAY)
  const daysLeft = Math.max(0, (deadline - now) / DAY)

  const pace = input.recoveredProfit / daysElapsed
  const projected = round2(pace * totalDays)
  const linearTargetNow = round2(input.totalRepayable * (daysElapsed / totalDays))
  const recoveryRatio = input.totalRepayable > 0 ? input.recoveredProfit / input.totalRepayable : 0
  const shortfall = Math.max(0, round2(input.totalRepayable - projected))

  const hasOverdueInstallment = input.installments.some(
    (i) => new Date(i.due_date).getTime() <= now && i.amount_paid < i.amount_due
  )

  let tier: RiskTier
  if (hasOverdueInstallment) tier = 'at_risk'
  else if (projected >= input.totalRepayable) tier = 'on_track'
  else if (projected >= 0.85 * input.totalRepayable) tier = 'watch'
  else tier = 'at_risk'

  const weeksLeft = Math.max(daysLeft / 7, 0.5)
  const requiredProfitPerWeek = round2(shortfall / weeksLeft)

  return {
    tier,
    recoveredProfit: round2(input.recoveredProfit),
    projected,
    recoveryRatio,
    linearTargetNow,
    shortfall,
    daysLeft: Math.round(daysLeft),
    requiredProfitPerWeek,
    hasOverdueInstallment,
  }
}
```

Then fix the duplicate import: ensure the file has exactly one `import { addMonths } from 'date-fns'` at the top (delete the `_addMonths` alias line you just added and use the existing `addMonths`).

- [ ] **Step 4: Run to verify pass** — Run: `npm test` — Expected: PASS (all `computeRisk` + `generateInstallments` green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/capitalRisk.ts src/lib/capitalRisk.test.ts
git commit -m "feat: capital risk engine (tier, projection, insight)"
```

---

### Task 5: Capital service layer

**Files:**
- Create: `src/services/capitalApi.ts`

- [ ] **Step 1: Implement `src/services/capitalApi.ts`**

```ts
import { supabase } from '@/lib/supabase'
import type { CapitalInjection, RepaymentInstallment, CapitalSource } from '@/lib/supabase'
import { generateInstallments } from '@/lib/capitalRisk'

async function uidOrThrow(): Promise<string> {
  const { data } = await supabase.auth.getUser()
  const uid = data.user?.id
  if (!uid) throw new Error('Not authenticated')
  return uid
}

export async function fetchInjections(): Promise<CapitalInjection[]> {
  const uid = await uidOrThrow()
  const { data, error } = await supabase
    .from('capital_injections')
    .select('*')
    .eq('user_id', uid)
    .order('injection_date', { ascending: false })
  if (error) throw error
  return (data as CapitalInjection[]) || []
}

export async function fetchInjection(id: string): Promise<CapitalInjection | null> {
  const uid = await uidOrThrow()
  const { data, error } = await supabase
    .from('capital_injections').select('*').eq('id', id).eq('user_id', uid).single()
  if (error && error.code !== 'PGRST116') throw error
  return (data as CapitalInjection) ?? null
}

export async function createInjection(input: {
  source: CapitalSource
  lender_name: string | null
  principal: number
  interest_amount: number
  injection_date: string
  payback_months: number
  installment_count: number
  notes: string | null
}): Promise<CapitalInjection> {
  const uid = await uidOrThrow()
  const total_repayable = Math.round((input.principal + input.interest_amount) * 100) / 100

  const { data, error } = await supabase
    .from('capital_injections')
    .insert({ ...input, user_id: uid, total_repayable })
    .select()
    .single()
  if (error) throw error
  const injection = data as CapitalInjection

  // Generate the schedule.
  const rows = generateInstallments(total_repayable, input.installment_count, input.injection_date)
    .map((r) => ({ ...r, user_id: uid, injection_id: injection.id }))
  const { error: insErr } = await supabase.from('repayment_installments').insert(rows)
  if (insErr) throw insErr

  return injection
}

export async function fetchInstallments(injectionId: string): Promise<RepaymentInstallment[]> {
  const uid = await uidOrThrow()
  const { data, error } = await supabase
    .from('repayment_installments')
    .select('*')
    .eq('injection_id', injectionId)
    .eq('user_id', uid)
    .order('seq', { ascending: true })
  if (error) throw error
  return (data as RepaymentInstallment[]) || []
}

// Cumulative profit recovered from the stock this injection funded — the one
// query that powers the risk engine and the report.
export async function fetchRecoveredProfit(injectionId: string): Promise<number> {
  const uid = await uidOrThrow()
  const { data, error } = await supabase
    .from('batch_consumptions')
    .select('profit')
    .eq('injection_id', injectionId)
    .eq('user_id', uid)
  if (error) throw error
  return (data || []).reduce((s, r: { profit: number }) => s + (r.profit || 0), 0)
}

// Recovered profit for several injections at once (for the list view). Returns a
// map injectionId -> profit.
export async function fetchRecoveredProfitMap(injectionIds: string[]): Promise<Record<string, number>> {
  const uid = await uidOrThrow()
  if (injectionIds.length === 0) return {}
  const { data, error } = await supabase
    .from('batch_consumptions')
    .select('injection_id, profit')
    .in('injection_id', injectionIds)
    .eq('user_id', uid)
  if (error) throw error
  const map: Record<string, number> = {}
  for (const r of (data as { injection_id: string; profit: number }[]) || []) {
    map[r.injection_id] = (map[r.injection_id] || 0) + (r.profit || 0)
  }
  return map
}

// Stock bought with this injection + how much of each batch has sold.
export interface FundedStockRow {
  product_id: string
  product_name: string
  qty_purchased: number
  qty_sold: number
  turnover: number
  profit: number
}

export async function fetchFundedStock(injectionId: string): Promise<FundedStockRow[]> {
  const uid = await uidOrThrow()
  const { data: batches, error } = await supabase
    .from('stock_batches')
    .select('id, product_id, qty_purchased, qty_remaining, products(name)')
    .eq('injection_id', injectionId)
    .eq('user_id', uid)
  if (error) throw error

  const { data: cons } = await supabase
    .from('batch_consumptions')
    .select('batch_id, qty, unit_price, profit')
    .eq('injection_id', injectionId)
    .eq('user_id', uid)

  const consByBatch = new Map<string, { qty: number; turnover: number; profit: number }>()
  for (const c of (cons as { batch_id: string; qty: number; unit_price: number; profit: number }[]) || []) {
    const agg = consByBatch.get(c.batch_id) || { qty: 0, turnover: 0, profit: 0 }
    agg.qty += c.qty
    agg.turnover += c.qty * c.unit_price
    agg.profit += c.profit
    consByBatch.set(c.batch_id, agg)
  }

  return ((batches as unknown as {
    id: string; product_id: string; qty_purchased: number; products: { name: string } | null
  }[]) || []).map((b) => {
    const agg = consByBatch.get(b.id) || { qty: 0, turnover: 0, profit: 0 }
    return {
      product_id: b.product_id,
      product_name: b.products?.name ?? 'Unknown',
      qty_purchased: b.qty_purchased,
      qty_sold: agg.qty,
      turnover: Math.round(agg.turnover * 100) / 100,
      profit: Math.round(agg.profit * 100) / 100,
    }
  })
}

// Record a repayment against the earliest unpaid installment(s), and bump the
// injection's amount_repaid. Mirrors the Debts partial-payment flow.
export async function recordInstallmentPayment(injectionId: string, amount: number): Promise<void> {
  const uid = await uidOrThrow()
  const installments = await fetchInstallments(injectionId)
  let left = amount
  const nowIso = new Date().toISOString()

  for (const inst of installments) {
    if (left <= 0) break
    const owed = inst.amount_due - inst.amount_paid
    if (owed <= 0) continue
    const pay = Math.min(owed, left)
    const newPaid = inst.amount_paid + pay
    const fully = newPaid >= inst.amount_due
    await supabase
      .from('repayment_installments')
      .update({ amount_paid: newPaid, status: fully ? 'paid' : 'due', paid_at: fully ? nowIso : inst.paid_at })
      .eq('id', inst.id).eq('user_id', uid)
    left -= pay
  }

  const injection = await fetchInjection(injectionId)
  if (injection) {
    const newRepaid = Math.round((injection.amount_repaid + (amount - Math.max(0, left))) * 100) / 100
    const status = newRepaid >= injection.total_repayable ? 'repaid' : injection.status
    await supabase
      .from('capital_injections')
      .update({ amount_repaid: newRepaid, status })
      .eq('id', injectionId).eq('user_id', uid)
  }
}

export async function updateInjectionRisk(injectionId: string, tier: string): Promise<void> {
  const uid = await uidOrThrow()
  await supabase.from('capital_injections').update({ risk_tier: tier }).eq('id', injectionId).eq('user_id', uid)
}
```

- [ ] **Step 2: Typecheck** — Run: `npx tsc -b --noEmit` — Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/services/capitalApi.ts
git commit -m "feat: capital service (CRUD, recovery query, installment payments)"
```

---

### Task 6: Capital list screen + route

**Files:**
- Create: `src/pages/Capital.tsx`
- Modify: `src/App.tsx` (add `/capital` and `/capital/:id` routes near `/settings`)

- [ ] **Step 1: Create `src/pages/Capital.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { ArrowLeft, Plus, AlertTriangle } from 'lucide-react'
import { formatCurrency } from '@/lib/data'
import { fetchInjections, fetchRecoveredProfitMap } from '@/services/capitalApi'
import { computeRisk } from '@/lib/capitalRisk'
import type { CapitalInjection, RiskTier } from '@/lib/supabase'
import CreateInjectionSheet from '@/components/CreateInjectionSheet'

const SOURCE_LABEL: Record<string, string> = {
  microfinance: 'Microfinance loan',
  personal: 'Personal money',
  family_friends: 'Family / friends',
  investment: 'Investment',
  other: 'Other',
}

const TIER_STYLE: Record<RiskTier, { dot: string; label: string; cls: string }> = {
  on_track: { dot: '🟢', label: 'On track', cls: 'bg-green-100 text-green-800' },
  watch: { dot: '🟡', label: 'Watch', cls: 'bg-amber-100 text-amber-800' },
  at_risk: { dot: '🔴', label: 'At risk', cls: 'bg-red-100 text-red-800' },
}

export default function Capital() {
  const navigate = useNavigate()
  const [injections, setInjections] = useState<CapitalInjection[]>([])
  const [recovered, setRecovered] = useState<Record<string, number>>({})
  const [showCreate, setShowCreate] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const list = await fetchInjections()
      setInjections(list)
      setRecovered(await fetchRecoveredProfitMap(list.map((i) => i.id)))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const totalOutstanding = injections
    .filter((i) => i.status !== 'repaid')
    .reduce((s, i) => s + (i.total_repayable - i.amount_repaid), 0)
  const totalRecovered = Object.values(recovered).reduce((s, v) => s + v, 0)

  return (
    <div className="min-h-screen bg-light pb-24">
      <header className="bg-ink text-white px-5 pt-6 pb-5">
        <button onClick={() => navigate('/')} className="flex items-center gap-1 text-white/70 text-sm mb-3">
          <ArrowLeft size={16} /> Back
        </button>
        <h1 className="font-display text-xl">Capital & Loans</h1>
        <div className="flex gap-6 mt-3">
          <div><p className="text-xs text-white/60">Outstanding</p><p className="font-display text-lg">{formatCurrency(totalOutstanding)}</p></div>
          <div><p className="text-xs text-white/60">Recovered (profit)</p><p className="font-display text-lg text-accent-green">{formatCurrency(totalRecovered)}</p></div>
        </div>
      </header>

      <div className="px-5 py-4 space-y-3">
        {loading && <p className="text-sm text-muted-text">Loading…</p>}
        {!loading && injections.length === 0 && (
          <div className="text-center py-12 text-muted-text">
            <p className="text-sm">No capital tracked yet.</p>
            <p className="text-xs mt-1">Add a loan or investment to start tracing every pesewa.</p>
          </div>
        )}
        {injections.map((inj) => {
          const recoveredProfit = recovered[inj.id] || 0
          const risk = computeRisk({
            injectionDate: inj.injection_date,
            paybackMonths: inj.payback_months,
            totalRepayable: inj.total_repayable,
            recoveredProfit,
            installments: [],
            now: new Date().toISOString(),
          })
          const tier = inj.status === 'repaid' ? 'on_track' : risk.tier
          const style = TIER_STYLE[tier]
          const pct = Math.min(100, Math.round((recoveredProfit / inj.total_repayable) * 100))
          return (
            <button
              key={inj.id}
              onClick={() => navigate(`/capital/${inj.id}`)}
              className="w-full text-left bg-white harsh-border rounded-sm p-4"
            >
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-xs text-muted-text">{SOURCE_LABEL[inj.source]}</p>
                  <p className="font-medium text-sm">{inj.lender_name || formatCurrency(inj.principal)}</p>
                </div>
                <span className={`text-[11px] font-medium px-2 py-1 rounded-full ${style.cls}`}>
                  {style.dot} {inj.status === 'repaid' ? 'Repaid' : style.label}
                </span>
              </div>
              <div className="mt-3 h-2 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-accent-green" style={{ width: `${pct}%` }} />
              </div>
              <div className="flex justify-between text-[11px] text-muted-text mt-1">
                <span>{formatCurrency(recoveredProfit)} recovered ({pct}%)</span>
                <span>of {formatCurrency(inj.total_repayable)}</span>
              </div>
              {tier === 'at_risk' && inj.status !== 'repaid' && (
                <p className="flex items-center gap-1 text-[11px] text-accent-red mt-2">
                  <AlertTriangle size={12} /> Behind — tap to see what to do
                </p>
              )}
            </button>
          )
        })}
      </div>

      <button
        onClick={() => setShowCreate(true)}
        className="fixed bottom-6 right-5 w-14 h-14 rounded-full bg-accent-red text-white flex items-center justify-center shadow-lg"
        aria-label="Add capital"
      >
        <Plus size={26} />
      </button>

      <CreateInjectionSheet open={showCreate} onClose={() => setShowCreate(false)} onCreated={load} />
    </div>
  )
}
```

- [ ] **Step 2: Register the routes.** In `src/App.tsx`, after the `/settings` `<Route>` block, add:

```tsx
          <Route
            path="/capital"
            element={state.isAuthenticated ? <Capital /> : <Navigate to="/login" replace />}
          />
          <Route
            path="/capital/:id"
            element={state.isAuthenticated ? <InjectionDetail /> : <Navigate to="/login" replace />}
          />
```

And add the imports at the top of `src/App.tsx` (with the other page imports):

```tsx
import Capital from '@/pages/Capital'
import InjectionDetail from '@/pages/InjectionDetail'
```

> Note: `/*` (MainApp) is the catch-all and is declared last, so `/capital` must be declared *before* the `path="/*"` route. Place these new routes above the `path="/*"` route.

- [ ] **Step 3: Typecheck** — Run: `npx tsc -b --noEmit` — Expected: errors only for the not-yet-created `CreateInjectionSheet` and `InjectionDetail` (created in Tasks 7–8). That is fine for now; do not commit until Task 8.

---

### Task 7: Create-injection form

**Files:**
- Create: `src/components/CreateInjectionSheet.tsx`

- [ ] **Step 1: Create `src/components/CreateInjectionSheet.tsx`**

```tsx
import { useState } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { createInjection } from '@/services/capitalApi'
import type { CapitalSource } from '@/lib/supabase'

const SOURCES: { value: CapitalSource; label: string }[] = [
  { value: 'microfinance', label: 'Microfinance loan' },
  { value: 'personal', label: 'Personal money' },
  { value: 'family_friends', label: 'Family / friends' },
  { value: 'investment', label: 'Investment' },
  { value: 'other', label: 'Other' },
]

export default function CreateInjectionSheet({
  open, onClose, onCreated,
}: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [source, setSource] = useState<CapitalSource>('microfinance')
  const [lender, setLender] = useState('')
  const [principal, setPrincipal] = useState('')
  const [interest, setInterest] = useState('')
  const [months, setMonths] = useState('3')
  const [saving, setSaving] = useState(false)

  const reset = () => {
    setSource('microfinance'); setLender(''); setPrincipal(''); setInterest(''); setMonths('3')
  }

  const submit = async () => {
    const p = parseFloat(principal)
    if (!p || p <= 0) return
    const m = Math.max(1, parseInt(months) || 3)
    setSaving(true)
    try {
      await createInjection({
        source,
        lender_name: lender.trim() || null,
        principal: p,
        interest_amount: parseFloat(interest) || 0,
        injection_date: new Date().toISOString(),
        payback_months: m,
        installment_count: m, // monthly installments, one per month
        notes: null,
      })
      reset()
      onCreated()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const total = (parseFloat(principal) || 0) + (parseFloat(interest) || 0)

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="rounded-t-2xl">
        <SheetHeader><SheetTitle>Add capital</SheetTitle></SheetHeader>
        <div className="space-y-3 p-4">
          <div className="grid grid-cols-2 gap-2">
            {SOURCES.map((s) => (
              <button
                key={s.value}
                onClick={() => setSource(s.value)}
                className={`text-xs px-3 py-2 rounded-sm harsh-border ${source === s.value ? 'bg-ink text-white' : 'bg-white'}`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <input className="w-full harsh-border rounded-sm px-3 py-2 text-sm" placeholder="Lender / source name (optional)"
            value={lender} onChange={(e) => setLender(e.target.value)} />
          <input className="w-full harsh-border rounded-sm px-3 py-2 text-sm" type="number" inputMode="decimal"
            placeholder="Principal received (GHS)" value={principal} onChange={(e) => setPrincipal(e.target.value)} />
          <input className="w-full harsh-border rounded-sm px-3 py-2 text-sm" type="number" inputMode="decimal"
            placeholder="Interest amount (GHS, optional)" value={interest} onChange={(e) => setInterest(e.target.value)} />
          <input className="w-full harsh-border rounded-sm px-3 py-2 text-sm" type="number" inputMode="numeric"
            placeholder="Payback months" value={months} onChange={(e) => setMonths(e.target.value)} />
          {total > 0 && (
            <p className="text-xs text-muted-text">
              Total to repay: <strong>GHS {total.toFixed(2)}</strong> over {months || '3'} monthly installments.
            </p>
          )}
          <button onClick={submit} disabled={saving || !principal}
            className="w-full bg-accent-red text-white rounded-sm py-3 text-sm font-medium disabled:opacity-50">
            {saving ? 'Saving…' : 'Add capital & build schedule'}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 2: Typecheck** — Run: `npx tsc -b --noEmit` — Expected: only `InjectionDetail` still missing.

---

### Task 8: Injection detail screen

**Files:**
- Create: `src/pages/InjectionDetail.tsx`

- [ ] **Step 1: Create `src/pages/InjectionDetail.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router'
import { ArrowLeft, AlertTriangle } from 'lucide-react'
import { formatCurrency, formatDate } from '@/lib/data'
import {
  fetchInjection, fetchInstallments, fetchRecoveredProfit, fetchFundedStock,
  recordInstallmentPayment, updateInjectionRisk, type FundedStockRow,
} from '@/services/capitalApi'
import { computeRisk } from '@/lib/capitalRisk'
import type { CapitalInjection, RepaymentInstallment, RiskTier } from '@/lib/supabase'

const TIER: Record<RiskTier, { dot: string; label: string; cls: string }> = {
  on_track: { dot: '🟢', label: 'ON TRACK', cls: 'bg-green-100 text-green-800' },
  watch: { dot: '🟡', label: 'WATCH', cls: 'bg-amber-100 text-amber-800' },
  at_risk: { dot: '🔴', label: 'AT RISK', cls: 'bg-red-100 text-red-800' },
}

export default function InjectionDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [inj, setInj] = useState<CapitalInjection | null>(null)
  const [installments, setInstallments] = useState<RepaymentInstallment[]>([])
  const [recovered, setRecovered] = useState(0)
  const [stock, setStock] = useState<FundedStockRow[]>([])
  const [payInput, setPayInput] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    if (!id) return
    const [injection, insts, prof, funded] = await Promise.all([
      fetchInjection(id), fetchInstallments(id), fetchRecoveredProfit(id), fetchFundedStock(id),
    ])
    setInj(injection); setInstallments(insts); setRecovered(prof); setStock(funded)
  }
  useEffect(() => { load() }, [id])

  if (!inj) return <div className="min-h-screen bg-light p-5 text-sm text-muted-text">Loading…</div>

  const risk = computeRisk({
    injectionDate: inj.injection_date,
    paybackMonths: inj.payback_months,
    totalRepayable: inj.total_repayable,
    recoveredProfit: recovered,
    installments: installments.map((i) => ({ due_date: i.due_date, amount_due: i.amount_due, amount_paid: i.amount_paid })),
    now: new Date().toISOString(),
  })
  const tier = inj.status === 'repaid' ? 'on_track' : risk.tier
  const style = TIER[tier]
  const pct = Math.min(100, Math.round((recovered / inj.total_repayable) * 100))
  const targetPct = Math.min(100, Math.round((risk.linearTargetNow / inj.total_repayable) * 100))

  // Persist the freshly computed tier so the list/alerts stay in sync.
  useEffect(() => {
    if (inj && tier !== inj.risk_tier && inj.status !== 'repaid') {
      updateInjectionRisk(inj.id, tier).catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tier])

  const pay = async () => {
    const amt = parseFloat(payInput)
    if (!amt || amt <= 0) return
    setBusy(true)
    try { await recordInstallmentPayment(inj.id, amt); setPayInput(''); await load() }
    finally { setBusy(false) }
  }

  return (
    <div className="min-h-screen bg-light pb-12">
      <header className="bg-ink text-white px-5 pt-6 pb-4">
        <button onClick={() => navigate('/capital')} className="flex items-center gap-1 text-white/70 text-sm mb-3">
          <ArrowLeft size={16} /> Capital
        </button>
      </header>

      <div className="px-5 -mt-2 space-y-3">
        {/* 1. Header card */}
        <div className="bg-white harsh-border rounded-sm p-4">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs uppercase text-muted-text">{inj.source.replace('_', ' / ')}</p>
              <p className="font-display text-xl">{formatCurrency(inj.principal)}
                {inj.interest_amount > 0 && <span className="text-sm text-muted-text"> + {formatCurrency(inj.interest_amount)} interest</span>}</p>
              <p className="text-xs text-muted-text">Repay {formatCurrency(inj.total_repayable)} over {inj.payback_months} months</p>
            </div>
            <span className={`text-[11px] font-bold px-3 py-1 rounded-full ${style.cls}`}>{style.dot} {style.label}</span>
          </div>
        </div>

        {/* 2. Recovery card */}
        <div className="bg-white harsh-border rounded-sm p-4">
          <p className="text-sm font-medium mb-2">Recovery from this stock's profit</p>
          <div className="relative h-5 bg-gray-200 rounded-full overflow-hidden">
            <div className="h-full bg-accent-green" style={{ width: `${pct}%` }} />
            <div className="absolute top-0 h-full border-l-2 border-dashed border-ink" style={{ left: `${targetPct}%` }} />
          </div>
          <div className="flex justify-between text-[11px] text-muted-text mt-1">
            <span><strong className="text-accent-green">{formatCurrency(recovered)}</strong> recovered ({pct}%)</span>
            <span>target by now: {targetPct}%</span>
          </div>
          {risk.shortfall > 0 && inj.status !== 'repaid' && (
            <div className="mt-3 bg-amber-50 border border-amber-200 rounded-sm p-3 text-xs text-amber-800 flex gap-2">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>At this pace you'll recover <strong>{formatCurrency(risk.projected)}</strong> by the deadline —
                <strong> {formatCurrency(risk.shortfall)} short</strong>. Aim for <strong>{formatCurrency(risk.requiredProfitPerWeek)}/week</strong> profit to stay on track.</span>
            </div>
          )}
        </div>

        {/* 3. Schedule card */}
        <div className="bg-white harsh-border rounded-sm p-4">
          <p className="text-sm font-medium mb-2">Repayment schedule</p>
          <div className="space-y-1 text-sm">
            {installments.map((i) => {
              const paid = i.amount_paid >= i.amount_due
              const overdue = !paid && new Date(i.due_date).getTime() <= Date.now()
              return (
                <div key={i.id} className="flex justify-between">
                  <span>{paid ? '✅' : overdue ? '🔴' : '🔔'} {formatDate(i.due_date)} · {formatCurrency(i.amount_due)}</span>
                  <span className={paid ? 'text-accent-green' : overdue ? 'text-accent-red' : 'text-muted-text'}>
                    {paid ? 'paid' : overdue ? 'overdue' : 'upcoming'}
                  </span>
                </div>
              )
            })}
          </div>
          {inj.status !== 'repaid' && (
            <div className="flex gap-2 mt-3">
              <input className="flex-1 harsh-border rounded-sm px-3 py-2 text-sm" type="number" inputMode="decimal"
                placeholder="Record payment (GHS)" value={payInput} onChange={(e) => setPayInput(e.target.value)} />
              <button onClick={pay} disabled={busy || !payInput}
                className="bg-accent-red text-white rounded-sm px-4 text-sm disabled:opacity-50">Pay</button>
            </div>
          )}
        </div>

        {/* 4. Funded stock card */}
        <div className="bg-white harsh-border rounded-sm p-4">
          <p className="text-sm font-medium mb-2">Stock bought with this capital</p>
          {stock.length === 0 && <p className="text-xs text-muted-text">No stock tagged to this injection yet. Tag it when you receive stock in Inventory.</p>}
          <div className="space-y-1 text-sm">
            {stock.map((s) => (
              <div key={s.product_id} className="flex justify-between">
                <span>{s.product_name} — {s.qty_purchased} bought</span>
                <span className="text-muted-text">{s.qty_sold} sold · {s.qty_purchased > 0 ? Math.round((s.qty_sold / s.qty_purchased) * 100) : 0}%</span>
              </div>
            ))}
          </div>
          {stock.length > 0 && (
            <div className="border-t border-gray-200 mt-2 pt-2 flex justify-between text-sm font-medium">
              <span>Turnover so far</span>
              <span>{formatCurrency(stock.reduce((s, x) => s + x.turnover, 0))} · profit {formatCurrency(stock.reduce((s, x) => s + x.profit, 0))}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck + lint** — Run: `npx tsc -b --noEmit && npm run lint` — Expected: no errors (Capital, CreateInjectionSheet, InjectionDetail all resolve now).

- [ ] **Step 3: Build** — Run: `npm run build` — Expected: build succeeds.

- [ ] **Step 4: Manual smoke**

`npm run dev`. Visit `/capital`, add a microfinance injection (principal 5000, interest 750, 5 months). Verify it appears with a schedule of 5 installments. Open it, record a 1150 payment, confirm the first installment flips to paid and recovery/risk render. In Supabase:
```sql
SELECT seq, amount_due, amount_paid, status FROM repayment_installments ORDER BY seq;
```
Expected: 5 rows summing to 5750; first shows amount_paid 1150.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/pages/Capital.tsx src/pages/InjectionDetail.tsx src/components/CreateInjectionSheet.tsx
git commit -m "feat: capital screens (list, create, injection detail) + routes"
```

---

### Task 9: Tag stock to an injection when receiving + Home/Debts entry points

**Files:**
- Modify: `src/pages/Inventory.tsx` (extend the restock UI from Plan 1 Task 8 with an injection picker)
- Modify: `src/pages/Dashboard.tsx` (add a "Capital & Loans" card)
- Modify: `src/pages/Debts.tsx` (add a "Capital" entry that navigates to `/capital`)

- [ ] **Step 1: Injection picker on restock.** In `src/pages/Inventory.tsx`, add state near `restockUnitCost` (from Plan 1):

```ts
  const [restockInjectionId, setRestockInjectionId] = useState<string>('')
  const [activeInjections, setActiveInjections] = useState<{ id: string; lender_name: string | null; source: string }[]>([])
```

In the existing `useEffect` that loads inventory data (or add one), load active injections:

```ts
  useEffect(() => {
    import('@/services/capitalApi').then(({ fetchInjections }) =>
      fetchInjections().then((list) =>
        setActiveInjections(list.filter((i) => i.status !== 'repaid').map((i) => ({ id: i.id, lender_name: i.lender_name, source: i.source })))
      ).catch(() => {})
    )
  }, [])
```

- [ ] **Step 2: Pass the injection into `receiveStock`.** In `handleSaveRestock` (modified in Plan 1), change the `receiveStock` call to include the chosen injection:

```ts
      await receiveStock({
        productId: product.id,
        qty: editQty,
        unitCost,
        injectionId: restockInjectionId || null,
      })
```

And reset it alongside the others at the end of `handleSaveRestock`:

```ts
    setRestockInjectionId('')
```

- [ ] **Step 3: Add the picker to the restock UI**, just below the unit-cost input added in Plan 1:

```tsx
                      {activeInjections.length > 0 && (
                        <select
                          value={restockInjectionId}
                          onChange={(e) => setRestockInjectionId(e.target.value)}
                          className="w-full harsh-border rounded-sm px-3 py-2 text-sm mb-2"
                        >
                          <option value="">Not funded by tracked capital</option>
                          {activeInjections.map((i) => (
                            <option key={i.id} value={i.id}>
                              Bought with: {i.lender_name || i.source}
                            </option>
                          ))}
                        </select>
                      )}
```

- [ ] **Step 4: Home dashboard card.** In `src/pages/Dashboard.tsx`, add a navigate import and a Capital card. At the top imports add:

```tsx
import { useNavigate } from 'react-router'
```

Inside the component, add `const navigate = useNavigate()` near the other hooks. Then add this card into the existing quick-link grid (the `grid grid-cols-3 gap-3` section around line 96):

```tsx
        <button onClick={() => navigate('/capital')} className="card-tactile bg-white harsh-border rounded-sm p-3 text-left">
          <p className="text-[10px] text-muted-text uppercase">Capital</p>
          <p className="font-display text-sm">Loans & ROI</p>
        </button>
```

- [ ] **Step 5: Debts "Capital" entry.** In `src/pages/Debts.tsx`, add `import { useNavigate } from 'react-router'`, `const navigate = useNavigate()` in the component, and a button next to the Owed/Owing tab toggle:

```tsx
        <button onClick={() => navigate('/capital')} className="text-xs px-3 py-1.5 rounded-sm harsh-border bg-white">
          Capital →
        </button>
```

- [ ] **Step 6: Typecheck + lint + build** — Run: `npx tsc -b --noEmit && npm run lint && npm run build` — Expected: all pass.

- [ ] **Step 7: Manual smoke**

`npm run dev`. In Inventory, restock a product and tag it to the injection from Task 8; sell some of it; open the injection detail and confirm the product shows under "Stock bought with this capital" with sold units, and recovery profit increased. Confirm the Home "Capital" card and the Debts "Capital →" button both open `/capital`.

- [ ] **Step 8: Commit**

```bash
git add src/pages/Inventory.tsx src/pages/Dashboard.tsx src/pages/Debts.tsx
git commit -m "feat: tag funded stock on restock + Home/Debts entry points"
```

---

## Self-review notes (already reconciled)

- **Spec coverage:** `capital_injections`/`repayment_installments` tables + FK (Task 1, 2); schedule generation, equal installments with rounding on the last (Task 3); profit-pace risk tiers + projection + action insight, overdue-installment escalation (Task 4); recovered-profit query `SUM(batch_consumptions.profit) WHERE injection_id` (Task 5); manual installment payments mirroring Debts (Task 5, 8); injection list + detail (4 cards: header, recovery bar w/ target marker + insight, schedule, funded stock) (Task 6, 8); create-injection (Task 7); tag stock to injection on receive (Task 9); Home card + Debts entry (Task 9). Alerts + weekly report + daily job are Plan 3.
- **Type consistency:** `RiskTier` is exported from `src/lib/supabase.ts` (Task 2) and re-declared in `capitalRisk.ts` (Task 4) — they are structurally identical string unions; UI imports `RiskTier` from `@/lib/supabase`. `computeRisk`/`RiskInput`/`RiskResult` (Task 4) and `generateInstallments` (Task 3) are consumed unchanged in `capitalApi.ts` (Task 5) and the screens (Task 6, 8). `FundedStockRow` defined in Task 5, imported in Task 8.
- **Routing:** `/capital` + `/capital/:id` declared before the `/*` MainApp catch-all (Task 6 Step 2 note).
- **Risk caching:** `risk_tier` persisted opportunistically from the detail screen (Task 8); Plan 3's daily job becomes the authoritative recompute for alerting.
