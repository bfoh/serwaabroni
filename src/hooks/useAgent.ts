import { useCallback, useMemo, useState } from 'react'
import { useStore } from '@/lib/store'
import { buildSnapshot } from '@/lib/agent/snapshot'
import { callAgent as defaultCallAgent } from '@/lib/agent/client'
import { runReadTool, type ReadContext } from '@/lib/agent/readTools'
import { buildPreview, type PreviewContext } from '@/lib/agent/writeTools'
import { executePreview, type StoreExecApi } from '@/lib/agent/execute'
import { postMovement, type NewMovement } from '@/services/cashApi'
import { receiveStock } from '@/services/batchApi'
import { listenOnce, speak, speechSupported } from '@/lib/agent/speech'
import { formatCurrency } from '@/lib/data'
import type { AgentMessage, BusinessSnapshot, ConfirmPreview, AgentResponse } from '@/lib/agent/types'

interface TurnDeps {
  history: AgentMessage[]
  snapshot: BusinessSnapshot
  readCtx: ReadContext
  previewCtx: PreviewContext
  callAgent: (messages: AgentMessage[], snapshot: BusinessSnapshot) => Promise<AgentResponse>
}

export interface TurnOutcome {
  reply: string
  pending: ConfirmPreview | null
}

export async function runTurn(userText: string, deps: TurnDeps): Promise<TurnOutcome> {
  const messages: AgentMessage[] = [...deps.history, { role: 'user', content: userText }]
  const res = await deps.callAgent(messages, deps.snapshot)

  const call = res.toolCalls[0]
  if (!call) {
    return { reply: res.say || "I'm here. Tell me a sale, a restock, or ask about your business.", pending: null }
  }

  // Read tool → answer immediately.
  const read = runReadTool(call, deps.readCtx)
  if (read) return { reply: read.text, pending: null }

  // Write tool → build a confirm preview or a clarify question.
  const preview = buildPreview(call, deps.previewCtx)
  if ('error' in preview) return { reply: preview.error, pending: null }
  const spoken = res.say ? `${res.say} Please confirm.` : `Please confirm this ${preview.kind.replace('_', ' ')}.`
  return { reply: spoken, pending: preview }
}

function describeSaved(p: ConfirmPreview): string {
  if (p.kind === 'sale' && p.sale) {
    const total = p.sale.items.reduce((sum, i) => sum + i.unitPrice * i.qty, 0)
    return `Done — sale of ${formatCurrency(total)} saved.`
  }
  if (p.kind === 'credit_sale' && p.credit) {
    const total = p.credit.items.reduce((sum, i) => sum + i.unitPrice * i.qty, 0)
    return `Done — ${p.credit.customerName} now owes ${formatCurrency(total)}.`
  }
  if (p.kind === 'new_product' && p.newProduct) return `Done — added ${p.newProduct.name}.`
  if (p.kind === 'add_stock' && p.addStock) return `Done — restocked ${p.addStock.qty} ${p.addStock.productName}.`
  return 'Done. Saved.'
}

export function useAgent() {
  const store = useStore()
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [pending, setPending] = useState<ConfirmPreview | null>(null)
  const [busy, setBusy] = useState(false)

  const snapshot = useMemo(
    () =>
      buildSnapshot({
        products: store.state.products,
        debts: store.state.debts,
        todaySales: store.state.todaySales ?? 0,
        todayProfit: store.state.todayProfit ?? 0,
        cashInHand: store.state.balance ?? 0,
        cashInBank: store.state.bankBalance ?? 0,
      }),
    [store.state.products, store.state.debts, store.state.todaySales, store.state.todayProfit, store.state.balance, store.state.bankBalance],
  )

  const execApi: StoreExecApi = useMemo(
    () => ({
      addSaleBatch: store.addSaleBatch as StoreExecApi['addSaleBatch'],
      addDebt: store.addDebt as StoreExecApi['addDebt'],
      addProduct: store.addProduct as StoreExecApi['addProduct'],
      updateProduct: store.updateProduct as StoreExecApi['updateProduct'],
      findProductQty: (id: string) => store.state.products.find((p) => p.id === id)?.quantity ?? 0,
      // Cast at the boundary: the executor types category as a plain string to
      // stay decoupled from cashApi; here it is always a valid CashCategory ('sale').
      postMovement: (mv) => postMovement(mv as NewMovement),
      receiveStock: (params) => receiveStock(params),
    }),
    [store],
  )

  const sendText = useCallback(
    async (text: string) => {
      const clean = text.trim()
      if (!clean || busy) return
      setBusy(true)
      setMessages((m) => [...m, { role: 'user', content: clean }])
      try {
        const readCtx: ReadContext = {
          products: store.state.products,
          sales: store.state.sales,
          debts: store.state.debts,
          expenses: store.state.expenses,
          snapshot,
        }
        const out = await runTurn(clean, {
          history: messages,
          snapshot,
          readCtx,
          previewCtx: { products: store.state.products },
          callAgent: defaultCallAgent,
        })
        setMessages((m) => [...m, { role: 'assistant', content: out.reply }])
        setPending(out.pending)
        speak(out.reply)
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Something went wrong.'
        setMessages((m) => [...m, { role: 'assistant', content: msg }])
        speak(msg)
      } finally {
        setBusy(false)
      }
    },
    [busy, messages, snapshot, store.state],
  )

  const listen = useCallback(async () => {
    if (!speechSupported()) {
      setMessages((m) => [...m, { role: 'assistant', content: 'Voice is not available on this device. Please type.' }])
      return
    }
    try {
      const heard = await listenOnce({ lang: 'en-GH' })
      if (heard) await sendText(heard)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not hear you.'
      setMessages((m) => [...m, { role: 'assistant', content: msg }])
    }
  }, [sendText])

  const confirm = useCallback(async () => {
    if (!pending) return
    const previewToSave = pending
    setBusy(true)
    try {
      await executePreview(previewToSave, execApi)
      const done = describeSaved(previewToSave)
      setMessages((m) => [...m, { role: 'assistant', content: done }])
      speak(done)
    } catch {
      const msg = 'I could not save it. Please try again.'
      setMessages((m) => [...m, { role: 'assistant', content: msg }])
      speak(msg)
    } finally {
      setPending(null)
      setBusy(false)
    }
  }, [pending, execApi])

  const cancel = useCallback(() => {
    setPending(null)
    setMessages((m) => [...m, { role: 'assistant', content: 'Okay, cancelled.' }])
  }, [])

  // Proactive spoken opener shown when the agent is first opened.
  const greet = useCallback(() => {
    const msg =
      "Maakye! I'm SerwaaBroni. Tell me a sale, a restock, or ask about your business — for example, how are sales today?"
    setMessages((m) => (m.length === 0 ? [{ role: 'assistant', content: msg }] : m))
    speak(msg)
  }, [])

  return { messages, pending, busy, sendText, listen, confirm, cancel, greet }
}
