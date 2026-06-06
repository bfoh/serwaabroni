# Capital Tracking — Plan 3: Alerts + Weekly Report

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Warn the owner — in-app and by SMS — when an injection falls behind its repayment pace, and give her a weekly per-injection report of how the funded stock is performing.

**Architecture:** The weekly report is a pure function bucketing `batch_consumptions` by ISO week (computed on read — no new table), surfaced as a section in the injection detail screen. In-app risk is surfaced by an at-risk count badge on the Home "Capital & Loans" card (client recompute via the existing `computeRisk`). SMS risk alerts run in the existing `daily-tasks` edge function: it recomputes each active injection's risk server-side, and on the *transition* into `at_risk` (guarded by the `risk_alerted` flag so it fires once, not daily) sends the owner a `critical` SMS via the existing `dispatch`/`notification_log` pipeline; recovery back to on-track clears the flag.

**Tech Stack:** React 19 + TS + Vite, Vitest, Supabase (edge functions in Deno, `notification_log` dedupe, Arkesel SMS via `dispatch`).

**Depends on:** Plans 1 & 2 (batch_consumptions, capital_injections + `risk_alerted`/`risk_tier`, capitalApi, computeRisk). Migrations 012 & 013 must be applied.

**Spec:** `docs/superpowers/specs/2026-06-06-capital-tracking-design.md` (sections: Alerts; Weekly report).

**No new migration:** `risk_alerted` and `risk_tier` already exist on `capital_injections` (migration_013); `notification_log` already exists (migration_009).

---

### Task 1: Weekly report (pure) — TDD

Bucket an injection's consumptions into ISO weeks, each with profit + units sold,
a running cumulative, and the week-over-week profit delta.

**Files:**
- Create: `src/lib/capitalReport.ts`
- Test: `src/lib/capitalReport.test.ts`

- [ ] **Step 1: Write the failing tests** — create `src/lib/capitalReport.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildWeeklyReport, isoWeekKey, type ReportConsumption } from './capitalReport'

const c = (created_at: string, qty: number, profit: number): ReportConsumption => ({ created_at, qty, profit })

describe('isoWeekKey', () => {
  it('labels a date with its ISO year-week', () => {
    // 2026-01-05 is a Monday in ISO week 2 of 2026
    expect(isoWeekKey('2026-01-05T10:00:00.000Z')).toBe('2026-W02')
  })
  it('groups days within the same ISO week under one key', () => {
    expect(isoWeekKey('2026-01-05T00:00:00.000Z')).toBe(isoWeekKey('2026-01-11T23:00:00.000Z'))
  })
})

describe('buildWeeklyReport', () => {
  it('returns empty when there are no consumptions', () => {
    expect(buildWeeklyReport([])).toEqual([])
  })

  it('sums profit and units per week, newest first', () => {
    const rows = buildWeeklyReport([
      c('2026-01-05T10:00:00.000Z', 2, 20), // W02
      c('2026-01-06T10:00:00.000Z', 1, 10), // W02
      c('2026-01-13T10:00:00.000Z', 5, 50), // W03
    ])
    expect(rows.map((r) => r.week)).toEqual(['2026-W03', '2026-W02'])
    expect(rows[0]).toMatchObject({ week: '2026-W03', profit: 50, units: 5 })
    expect(rows[1]).toMatchObject({ week: '2026-W02', profit: 30, units: 3 })
  })

  it('reports week-over-week profit delta (this week minus the prior week)', () => {
    const rows = buildWeeklyReport([
      c('2026-01-05T10:00:00.000Z', 2, 30), // W02 profit 30
      c('2026-01-13T10:00:00.000Z', 5, 50), // W03 profit 50
    ])
    // newest first: W03 delta = 50 - 30 = 20 ; W02 delta = 30 - 0 = 30
    expect(rows[0]).toMatchObject({ week: '2026-W03', deltaVsPrev: 20 })
    expect(rows[1]).toMatchObject({ week: '2026-W02', deltaVsPrev: 30 })
  })

  it('accumulates a running cumulative profit oldest→newest', () => {
    const rows = buildWeeklyReport([
      c('2026-01-05T10:00:00.000Z', 2, 30), // W02
      c('2026-01-13T10:00:00.000Z', 5, 50), // W03
    ])
    // cumulative is total recovered up to and including that week
    expect(rows.find((r) => r.week === '2026-W02')!.cumulative).toBe(30)
    expect(rows.find((r) => r.week === '2026-W03')!.cumulative).toBe(80)
  })
})
```

- [ ] **Step 2: Run to verify failure** — Run: `npm test` — Expected: FAIL (`./capitalReport` not found).

- [ ] **Step 3: Implement `src/lib/capitalReport.ts`**

```ts
export interface ReportConsumption {
  created_at: string
  qty: number
  profit: number
}

export interface WeeklyReportRow {
  week: string          // ISO year-week, e.g. "2026-W03"
  profit: number        // profit recovered that week
  units: number         // units of funded stock sold that week
  cumulative: number    // total recovered profit up to and including this week
  deltaVsPrev: number   // this week's profit minus the previous week's
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// ISO-8601 week key (UTC). Weeks start Monday; week 1 contains the year's first
// Thursday. Returns e.g. "2026-W03".
export function isoWeekKey(iso: string): string {
  const d = new Date(iso)
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  // Thursday of the current week decides the ISO year.
  const day = date.getUTCDay() || 7 // Sun=7
  date.setUTCDate(date.getUTCDate() + 4 - day)
  const isoYear = date.getUTCFullYear()
  const yearStart = new Date(Date.UTC(isoYear, 0, 1))
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${isoYear}-W${String(week).padStart(2, '0')}`
}

// Bucket consumptions into ISO weeks. Returns rows newest-week-first; cumulative
// and deltaVsPrev are computed in chronological order then the list is reversed.
export function buildWeeklyReport(consumptions: ReportConsumption[]): WeeklyReportRow[] {
  const byWeek = new Map<string, { profit: number; units: number }>()
  for (const c of consumptions) {
    const key = isoWeekKey(c.created_at)
    const agg = byWeek.get(key) || { profit: 0, units: 0 }
    agg.profit += c.profit
    agg.units += c.qty
    byWeek.set(key, agg)
  }

  const weeksAsc = Array.from(byWeek.keys()).sort() // ISO week keys sort chronologically
  const rows: WeeklyReportRow[] = []
  let cumulative = 0
  let prevProfit = 0
  for (const week of weeksAsc) {
    const { profit, units } = byWeek.get(week)!
    cumulative = round2(cumulative + profit)
    rows.push({
      week,
      profit: round2(profit),
      units,
      cumulative,
      deltaVsPrev: round2(profit - prevProfit),
    })
    prevProfit = profit
  }
  return rows.reverse() // newest first
}
```

- [ ] **Step 4: Run to verify pass** — Run: `npm test` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/capitalReport.ts src/lib/capitalReport.test.ts
git commit -m "feat: weekly capital report (pure, ISO-week buckets)"
```

---

### Task 2: Consumptions fetch + weekly report UI in injection detail

**Files:**
- Modify: `src/services/capitalApi.ts` (add `fetchConsumptions`)
- Modify: `src/pages/InjectionDetail.tsx` (load consumptions, render a report section)

- [ ] **Step 1: Add `fetchConsumptions` to `src/services/capitalApi.ts`** (after `fetchRecoveredProfit`):

```ts
import type { ReportConsumption } from '@/lib/capitalRisk' // placeholder; corrected below
```

Do NOT add the import above — instead add this function (it returns the shape
`buildWeeklyReport` expects, defined in `capitalReport.ts`):

```ts
export async function fetchConsumptions(injectionId: string): Promise<{ created_at: string; qty: number; profit: number }[]> {
  const uid = await uidOrThrow()
  const { data, error } = await supabase
    .from('batch_consumptions')
    .select('created_at, qty, profit')
    .eq('injection_id', injectionId)
    .eq('user_id', uid)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data as { created_at: string; qty: number; profit: number }[]) || []
}
```

- [ ] **Step 2: Load consumptions + render the report in `src/pages/InjectionDetail.tsx`.** Add imports:

```tsx
import { buildWeeklyReport, type WeeklyReportRow } from '@/lib/capitalReport'
```

Add the import of `fetchConsumptions` to the existing `@/services/capitalApi` import line.

Add state next to the others:

```tsx
  const [report, setReport] = useState<WeeklyReportRow[]>([])
```

In `load()`, extend the `Promise.all` to also fetch consumptions and build the report. Replace the existing `load` body with:

```tsx
  const load = async () => {
    if (!id) return
    const [injection, insts, prof, funded, cons] = await Promise.all([
      fetchInjection(id), fetchInstallments(id), fetchRecoveredProfit(id), fetchFundedStock(id), fetchConsumptions(id),
    ])
    setInj(injection); setInstallments(insts); setRecovered(prof); setStock(funded)
    setReport(buildWeeklyReport(cons))
  }
```

Add a 5th card after the funded-stock card (before the closing `</div>` of the `px-5` container):

```tsx
        {/* 5. Weekly report */}
        <div className="bg-white harsh-border rounded-sm p-4">
          <p className="text-sm font-medium mb-2">Weekly report</p>
          {report.length === 0 && <p className="text-xs text-muted-text">No sales of this stock yet.</p>}
          <div className="space-y-1 text-sm">
            {report.map((w) => (
              <div key={w.week} className="flex justify-between">
                <span>{w.week.replace('-W', ' · week ')} — {w.units} sold</span>
                <span className="text-muted-text">
                  {formatCurrency(w.profit)} profit
                  {w.deltaVsPrev !== 0 && (
                    <span className={w.deltaVsPrev > 0 ? 'text-accent-green' : 'text-accent-red'}>
                      {' '}{w.deltaVsPrev > 0 ? '↑' : '↓'}{formatCurrency(Math.abs(w.deltaVsPrev))}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
```

- [ ] **Step 3: Typecheck + lint + build** — Run: `npx tsc -b --noEmit && npx eslint src/pages/InjectionDetail.tsx src/services/capitalApi.ts && npm run build` — Expected: no new errors; build succeeds.

- [ ] **Step 4: Manual smoke** (needs migrations applied + a sale of funded stock): open an injection that has sold some funded stock; the Weekly report lists each ISO week with units + profit and a ↑/↓ delta.

- [ ] **Step 5: Commit**

```bash
git add src/services/capitalApi.ts src/pages/InjectionDetail.tsx
git commit -m "feat: weekly report section on injection detail"
```

---

### Task 3: In-app risk surface — at-risk count on the Home card

Replace the static Dashboard "Capital & Loans" button with one that loads a small
summary and shows an at-risk badge — the in-app alert surface.

**Files:**
- Modify: `src/services/capitalApi.ts` (add `fetchCapitalSummary`)
- Create: `src/components/CapitalSummaryCard.tsx`
- Modify: `src/pages/Dashboard.tsx` (use the new card)

- [ ] **Step 1: Add `fetchCapitalSummary` to `src/services/capitalApi.ts`** (uses the same recovery query + `computeRisk` already imported in this file via capitalRisk — add the import):

At the top of `capitalApi.ts`, extend the capitalRisk import:

```ts
import { generateInstallments, computeRisk } from '@/lib/capitalRisk'
```

Then add:

```ts
export interface CapitalSummary {
  outstanding: number
  recovered: number
  atRiskCount: number
  activeCount: number
}

export async function fetchCapitalSummary(): Promise<CapitalSummary> {
  const injections = await fetchInjections()
  const active = injections.filter((i) => i.status !== 'repaid')
  const recoveredMap = await fetchRecoveredProfitMap(active.map((i) => i.id))
  const now = new Date().toISOString()

  let atRiskCount = 0
  for (const i of active) {
    const risk = computeRisk({
      injectionDate: i.injection_date,
      paybackMonths: i.payback_months,
      totalRepayable: i.total_repayable,
      recoveredProfit: recoveredMap[i.id] || 0,
      installments: [],
      now,
    })
    if (risk.tier === 'at_risk') atRiskCount++
  }

  return {
    outstanding: active.reduce((s, i) => s + (i.total_repayable - i.amount_repaid), 0),
    recovered: Object.values(recoveredMap).reduce((s, v) => s + v, 0),
    atRiskCount,
    activeCount: active.length,
  }
}
```

- [ ] **Step 2: Create `src/components/CapitalSummaryCard.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { Landmark } from 'lucide-react'
import { fetchCapitalSummary, type CapitalSummary } from '@/services/capitalApi'

export default function CapitalSummaryCard() {
  const navigate = useNavigate()
  const [summary, setSummary] = useState<CapitalSummary | null>(null)

  useEffect(() => {
    fetchCapitalSummary().then(setSummary).catch(() => {})
  }, [])

  return (
    <button
      onClick={() => navigate('/capital')}
      className="btn-tactile bg-warm-gray rounded-sm px-3 py-3 flex flex-col items-center gap-2 relative"
    >
      {summary && summary.atRiskCount > 0 && (
        <span className="absolute top-1 right-1 bg-accent-red text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">
          {summary.atRiskCount} at risk
        </span>
      )}
      <Landmark size={24} className="text-ink" />
      <span className="font-display text-[10px] text-ink uppercase tracking-wider text-center leading-tight">Capital<br/>& Loans</span>
    </button>
  )
}
```

- [ ] **Step 3: Use it in `src/pages/Dashboard.tsx`.** Add the import:

```tsx
import CapitalSummaryCard from '@/components/CapitalSummaryCard'
```

Replace the inline Capital button added in Plan 2 Task 9 (the `<button onClick={() => navigate('/capital')} ...>Capital<br/>& Loans</button>`) with:

```tsx
        <CapitalSummaryCard />
```

If `navigate` is now unused in Dashboard after this swap, leave it — it is still used elsewhere if present; otherwise remove the `useNavigate` import and the `const navigate = useNavigate()` line to avoid an unused-var error. (Verify in Step 4.)

- [ ] **Step 4: Typecheck + lint + build** — Run: `npx tsc -b --noEmit && npx eslint src/pages/Dashboard.tsx src/components/CapitalSummaryCard.tsx src/services/capitalApi.ts && npm run build` — Expected: no new errors. If eslint flags `navigate`/`useNavigate` as unused in Dashboard, remove those two lines and re-run.

- [ ] **Step 5: Commit**

```bash
git add src/services/capitalApi.ts src/components/CapitalSummaryCard.tsx src/pages/Dashboard.tsx
git commit -m "feat: at-risk badge on Home capital card"
```

---

### Task 4: SMS risk alerts in the daily-tasks edge function

Recompute each active injection's risk server-side and, on the transition into
`at_risk` (once, guarded by `risk_alerted`), send the owner a `critical` SMS;
clear the flag when recovered. Reuses the existing `dispatch` + `notification_log`
dedupe; no template changes (the `critical` type already takes `title`/`message`).

**Files:**
- Modify: `supabase/functions/daily-tasks/index.ts`

- [ ] **Step 1: Add a risk-tier helper near the top of `daily-tasks/index.ts`** (after the `remaining` helper). This mirrors the tiering in `src/lib/capitalRisk.ts::computeRisk` (kept inline because the edge runtime is separate from the app bundle):

```ts
const DAY = 1000 * 60 * 60 * 24

// Mirror of src/lib/capitalRisk.ts tiering (profit-pace vs schedule). Keep in sync.
function riskTier(inj: {
  injection_date: string; payback_months: number; total_repayable: number
}, recoveredProfit: number, hasOverdue: boolean, now: number): 'on_track' | 'watch' | 'at_risk' {
  const start = new Date(inj.injection_date).getTime()
  const d = new Date(inj.injection_date)
  const deadline = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + inj.payback_months, d.getUTCDate())).getTime()
  const totalDays = Math.max(1, (deadline - start) / DAY)
  const daysElapsed = Math.max(1, (now - start) / DAY)
  const projected = (recoveredProfit / daysElapsed) * totalDays
  if (hasOverdue) return 'at_risk'
  if (projected >= inj.total_repayable) return 'on_track'
  if (projected >= 0.85 * inj.total_repayable) return 'watch'
  return 'at_risk'
}
```

- [ ] **Step 2: Add the capital-risk block** inside the `for (const profile of profiles ?? [])` loop, after the debt-reminders block (before the loop's closing brace). Add a counter `let riskAlerts = 0` next to `let summaries = 0` / `let reminders = 0`:

```ts
    // ---- Capital repayment-risk alerts to owner ----
    if (profile.notify_critical !== false && profile.phone) {
      const nowMs = Date.now()
      const { data: injections } = await admin
        .from('capital_injections')
        .select('id, injection_date, payback_months, total_repayable, amount_repaid, risk_alerted, lender_name, source')
        .eq('user_id', uid)
        .eq('status', 'active')

      for (const inj of injections ?? []) {
        // Recovered profit from this injection's funded stock.
        const { data: cons } = await admin
          .from('batch_consumptions').select('profit').eq('injection_id', inj.id).eq('user_id', uid)
        const recovered = (cons ?? []).reduce((s, r) => s + (r.profit || 0), 0)

        // Any overdue, underpaid installment?
        const { data: overdue } = await admin
          .from('repayment_installments')
          .select('id, amount_due, amount_paid')
          .eq('injection_id', inj.id)
          .eq('user_id', uid)
          .lte('due_date', new Date().toISOString())
        const hasOverdue = (overdue ?? []).some((i) => (i.amount_paid || 0) < (i.amount_due || 0))

        const tier = riskTier(inj, recovered, hasOverdue, nowMs)

        // Persist the recomputed tier so the app reflects it without opening each one.
        await admin.from('capital_injections').update({ risk_tier: tier }).eq('id', inj.id).eq('user_id', uid)

        if (tier === 'at_risk' && !inj.risk_alerted) {
          // Transition into at-risk → alert once.
          const gap = Math.max(0, inj.total_repayable - inj.amount_repaid)
          await dispatch({
            admin,
            userId: uid,
            type: 'critical',
            data: {
              businessName: profile.business_name,
              ownerName: profile.owner_name,
              title: `Loan ${inj.lender_name || inj.source} at risk`,
              message: `Repayment is behind pace (about GHS ${gap.toFixed(2)} still to recover). Open SerwaaBroni to see what to sell.`,
            },
            channels: channels.filter((ch) => ch !== 'email' || profile.email),
            phoneTo: profile.phone,
            emailTo: profile.email,
            senderId,
            refId: inj.id,
          })
          await admin.from('capital_injections').update({ risk_alerted: true }).eq('id', inj.id).eq('user_id', uid)
          riskAlerts++
        } else if (tier !== 'at_risk' && inj.risk_alerted) {
          // Recovered → reset so a future slip alerts again.
          await admin.from('capital_injections').update({ risk_alerted: false }).eq('id', inj.id).eq('user_id', uid)
        }
      }
    }
```

- [ ] **Step 3: Include the counter in the response.** Change the final `return json({ ok: true, summaries, reminders })` to:

```ts
  return json({ ok: true, summaries, reminders, riskAlerts })
```

- [ ] **Step 4: Deno type-check the function** (if the Supabase CLI/Deno is available):

Run: `deno check supabase/functions/daily-tasks/index.ts`
Expected: no errors. (If Deno is not installed locally, skip — this is verified on deploy.)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/daily-tasks/index.ts
git commit -m "feat: SMS capital risk alerts in daily-tasks (transition-guarded)"
```

- [ ] **Step 6: Deploy + verify (USER CHECKPOINT — requires Supabase CLI/dashboard).**

Deploy the updated function: `supabase functions deploy daily-tasks`. Trigger it
manually (or wait for the cron) and verify with an injection that is behind pace:
```sql
SELECT id, risk_tier, risk_alerted FROM capital_injections WHERE status = 'active';
SELECT type, channel, recipient, ref_id, status FROM notification_log
  WHERE type = 'critical' ORDER BY sent_at DESC LIMIT 5;
```
Expected: at-risk injections have `risk_tier='at_risk'`, `risk_alerted=true`, and a
`critical` SMS row in `notification_log`. A second run the same day sends no
duplicate (dedupe + flag).

---

## Self-review notes (already reconciled)

- **Spec coverage:** weekly in-app report grouped by week with WoW delta (Task 1, 2); in-app risk surface via Home at-risk badge (Task 3); SMS on risk transition, deduped, owner-targeted, with recovery reset (Task 4). The all-injections summary (outstanding/recovered/at-risk) lives on the Capital header (Plan 2) + Home card (Task 3).
- **Type consistency:** `ReportConsumption`/`WeeklyReportRow`/`buildWeeklyReport`/`isoWeekKey` (Task 1) consumed in Task 2; `fetchConsumptions` returns exactly the `ReportConsumption` shape. `CapitalSummary`/`fetchCapitalSummary` (Task 3) consumed by `CapitalSummaryCard`. Task 2 Step 1 explicitly warns NOT to add a wrong placeholder import.
- **Dedupe correctness:** transition guard via `risk_alerted` (fires once per slip) + `notification_log` daily uniqueness (refId = injection id) — together they prevent repeat SMS.
- **Edge duplication:** `riskTier` in the edge function intentionally mirrors `computeRisk` tiering; comment flags the sync requirement. Acceptable because the Deno edge runtime cannot import the app's `src/` bundle.
- **Out of scope (unchanged from spec):** PDF export, monthly cadence (weekly only), per-installment SMS for non-critical states.
