import type { Product, Debt, Sale, Expense } from '@/lib/supabase'
import { formatCurrency } from '@/lib/data'
import { generateAlerts } from '@/lib/alerts'
import type { ToolCall, ReadResult, BusinessSnapshot } from './types'

export interface ReadContext {
  products: Product[]
  sales: Sale[]
  debts: Debt[]
  expenses: Expense[]
  snapshot: BusinessSnapshot
}

export function runReadTool(call: ToolCall, ctx: ReadContext): ReadResult | null {
  const s = ctx.snapshot
  switch (call.name) {
    case 'get_summary': {
      const raw = String(call.input.period ?? 'daily')
      const period = raw === 'weekly' || raw === 'monthly' || raw === 'yearly' ? raw : 'daily'
      if (period === 'daily') {
        return {
          text: `Today's sales are ${formatCurrency(s.todaySales)} with profit ${formatCurrency(
            s.todayProfit,
          )}. Cash in hand ${formatCurrency(s.cashInHand)}, bank ${formatCurrency(s.cashInBank)}.`,
        }
      }
      const days = period === 'weekly' ? 7 : period === 'monthly' ? 30 : 365
      const label = period === 'weekly' ? 'This week' : period === 'monthly' ? 'This month' : 'This year'
      const cutoff = Date.now() - days * 86400000
      const inRange = ctx.sales.filter((x) => new Date(x.created_at).getTime() >= cutoff)
      const sales = inRange.reduce((sum, x) => sum + x.total, 0)
      const profit = inRange.reduce((sum, x) => sum + x.profit, 0)
      return {
        text: `${label} sales are ${formatCurrency(sales)} with profit ${formatCurrency(
          profit,
        )}. Cash in hand ${formatCurrency(s.cashInHand)}, bank ${formatCurrency(s.cashInBank)}.`,
      }
    }
    case 'get_low_stock': {
      if (s.lowStock.length === 0) return { text: 'All your stock levels are healthy right now.' }
      const list = s.lowStock.map((x) => `${x.name} (${x.qty} left)`).join(', ')
      return { text: `These items are low: ${list}. Please restock soon.` }
    }
    case 'get_debts': {
      const dir = (call.input.direction as string) === 'owing' ? 'owing' : 'owed'
      const list = ctx.debts.filter((x) => x.type === dir && !x.is_paid)
      if (list.length === 0) {
        return { text: dir === 'owed' ? 'Nobody owes you right now.' : "You don't owe anyone right now." }
      }
      const byPerson = new Map<string, number>()
      list.forEach((x) => byPerson.set(x.person_name, (byPerson.get(x.person_name) || 0) + x.amount))
      const lines = Array.from(byPerson, ([name, amt]) => `${name} ${formatCurrency(amt)}`).join(', ')
      const total = dir === 'owed' ? s.owedTotal : s.owingTotal
      return {
        text:
          dir === 'owed'
            ? `People owe you ${formatCurrency(total)} in total: ${lines}.`
            : `You owe ${formatCurrency(total)} in total: ${lines}.`,
      }
    }
    case 'get_top_products': {
      const top = [...ctx.snapshot.products].slice(0, 5).map((p) => p.name).join(', ')
      return { text: top ? `Your products include: ${top}.` : 'You have no products yet.' }
    }
    case 'get_alerts': {
      const alerts = generateAlerts(ctx.products, ctx.sales, ctx.debts, ctx.expenses)
      if (alerts.length === 0) return { text: 'No alerts. Everything looks good.' }
      return { text: alerts.slice(0, 4).map((a) => `${a.title}: ${a.message}`).join(' ') }
    }
    default:
      return null
  }
}
