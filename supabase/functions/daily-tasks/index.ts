// daily-tasks: scheduled by pg_cron once a day. For every shop it sends the owner a
// daily summary and reminds debtors of overdue/due balances. Guarded by a shared
// secret header (no user JWT). Per-day de-dupe lives in dispatch().
//
// Schedule (run in the SQL editor once):
//   select cron.schedule('serwaabroni-daily', '0 18 * * *', $$
//     select net.http_post(
//       url    := 'https://<ref>.supabase.co/functions/v1/daily-tasks',
//       headers:= jsonb_build_object('Content-Type','application/json','X-Cron-Secret','<CRON_SECRET>'),
//       body   := '{}'::jsonb) $$);

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'
import { type Channel, resolveSender } from '../_shared/providers.ts'
import { dispatch } from '../_shared/dispatch.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? ''

const ownerChannels = (p: Record<string, unknown>): Channel[] =>
  (['sms', 'email', 'whatsapp'] as Channel[]).filter(
    (ch) => p[`notify_${ch}`] !== false,
  )

const remaining = (d: { amount: number; amount_paid?: number }) =>
  Math.max(0, d.amount - (d.amount_paid ?? 0))

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (CRON_SECRET && req.headers.get('X-Cron-Secret') !== CRON_SECRET) {
    return json({ error: 'Forbidden' }, 403)
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)
  const todayLabel = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

  const { data: profiles, error } = await admin.from('business_profiles').select('*')
  if (error) return json({ error: error.message }, 500)

  let summaries = 0
  let reminders = 0
  let riskAlerts = 0

  for (const profile of profiles ?? []) {
    const uid = profile.user_id as string
    const channels = ownerChannels(profile)
    const senderId = resolveSender(profile.sms_sender_id)

    // ---- Daily summary to owner ----
    if (profile.notify_daily_summary !== false && (profile.phone || profile.email)) {
      const [{ data: sales }, { data: debts }, { data: products }] = await Promise.all([
        admin.from('sales').select('total, profit').eq('user_id', uid).gte('created_at', startOfDay.toISOString()),
        admin.from('debts').select('amount, amount_paid, type, is_paid').eq('user_id', uid).eq('type', 'owed').eq('is_paid', false),
        admin.from('products').select('quantity, low_stock_threshold').eq('user_id', uid),
      ])

      const totalSales = (sales ?? []).reduce((s, r) => s + (r.total || 0), 0)
      const totalProfit = (sales ?? []).reduce((s, r) => s + (r.profit || 0), 0)
      const pendingDebts = (debts ?? []).reduce((s, d) => s + remaining(d), 0)
      const lowStockCount = (products ?? []).filter((p) => (p.quantity || 0) <= (p.low_stock_threshold || 0)).length

      // Skip silent days with nothing to report.
      if (totalSales > 0 || pendingDebts > 0 || lowStockCount > 0) {
        await dispatch({
          admin,
          userId: uid,
          type: 'daily_summary',
          data: {
            businessName: profile.business_name,
            ownerName: profile.owner_name,
            date: todayLabel,
            totalSales,
            totalProfit,
            salesCount: (sales ?? []).length,
            pendingDebts,
            lowStockCount,
          },
          channels,
          phoneTo: profile.phone,
          emailTo: profile.email,
          senderId,
          refId: startOfDay.toISOString().slice(0, 10), // one summary per day
        })
        summaries++
      }
    }

    // ---- Debt reminders to debtors (overdue or due today) ----
    if (profile.notify_debt_reminders !== false) {
      const { data: owed } = await admin
        .from('debts')
        .select('id, person_name, phone, amount, amount_paid, due_date')
        .eq('user_id', uid)
        .eq('type', 'owed')
        .eq('is_paid', false)
        .not('due_date', 'is', null)
        .lte('due_date', new Date().toISOString())

      for (const debt of owed ?? []) {
        if (!debt.phone) continue
        const debtorChannels = channels.filter((ch) => ch !== 'email') // debtors have phone only
        if (debtorChannels.length === 0) continue
        await dispatch({
          admin,
          userId: uid,
          type: 'debt_reminder',
          data: {
            businessName: profile.business_name,
            ownerName: profile.owner_name,
            personName: debt.person_name,
            amount: remaining(debt),
            dueDate: debt.due_date ? new Date(debt.due_date).toLocaleDateString('en-GB') : undefined,
          },
          channels: debtorChannels,
          phoneTo: debt.phone,
          senderId,
          refId: debt.id,
        })
        reminders++
      }
    }

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
        const recovered = (cons ?? []).reduce((s: number, r: { profit: number }) => s + (r.profit || 0), 0)

        // Any overdue, underpaid installment?
        const { data: overdue } = await admin
          .from('repayment_installments')
          .select('id, amount_due, amount_paid')
          .eq('injection_id', inj.id)
          .eq('user_id', uid)
          .lte('due_date', new Date().toISOString())
        const hasOverdue = (overdue ?? []).some(
          (i: { amount_due: number; amount_paid: number }) => (i.amount_paid || 0) < (i.amount_due || 0),
        )

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
            channels,
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
  }

  return json({ ok: true, summaries, reminders, riskAlerts })
})
