import { useCallback, useMemo, useRef, useState } from 'react'
import { useStore } from '@/lib/store'
import { buildSnapshot } from '@/lib/agent/snapshot'
import { callAgent as defaultCallAgent } from '@/lib/agent/client'
import { runReadTool, type ReadContext } from '@/lib/agent/readTools'
import { buildPreview, type PreviewContext } from '@/lib/agent/writeTools'
import { executePreview, type StoreExecApi } from '@/lib/agent/execute'
import { postMovement, type NewMovement } from '@/services/cashApi'
import { receiveStock } from '@/services/batchApi'
import { listenOnce, speak, speechSupported, stopListening, stopSpeaking } from '@/lib/agent/speech'
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
  const [conversing, setConversing] = useState(false)

  // Refs mirror state so the async conversation loop and the stable sendText
  // callback always read the latest values (no stale closures across turns).
  const messagesRef = useRef<AgentMessage[]>([])
  const pendingRef = useRef<ConfirmPreview | null>(null)
  const busyRef = useRef(false)
  const convRef = useRef(false)
  const storeRef = useRef(store)
  storeRef.current = store

  const pushMessage = useCallback((msg: AgentMessage) => {
    messagesRef.current = [...messagesRef.current, msg]
    setMessages(messagesRef.current)
  }, [])

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
      if (!clean || busyRef.current) return
      busyRef.current = true
      setBusy(true)
      const history = messagesRef.current
      pushMessage({ role: 'user', content: clean })
      const s = storeRef.current.state
      const snapshot = buildSnapshot({
        products: s.products,
        debts: s.debts,
        todaySales: s.todaySales ?? 0,
        todayProfit: s.todayProfit ?? 0,
        cashInHand: s.balance ?? 0,
        cashInBank: s.bankBalance ?? 0,
      })
      try {
        const readCtx: ReadContext = {
          products: s.products,
          sales: s.sales,
          debts: s.debts,
          expenses: s.expenses,
          snapshot,
        }
        const out = await runTurn(clean, {
          history,
          snapshot,
          readCtx,
          previewCtx: { products: s.products },
          callAgent: defaultCallAgent,
        })
        pushMessage({ role: 'assistant', content: out.reply })
        setPending(out.pending)
        pendingRef.current = out.pending
        await speak(out.reply)
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Something went wrong.'
        pushMessage({ role: 'assistant', content: msg })
        await speak(msg)
      } finally {
        busyRef.current = false
        setBusy(false)
      }
    },
    [pushMessage],
  )

  // Continuous voice conversation: listen → respond → listen again, until the
  // user stops it (taps the mic again / closes) or a money action needs an
  // explicit tap on the confirm card.
  const runConversation = useCallback(async () => {
    while (convRef.current) {
      let heard = ''
      try {
        heard = await listenOnce({ lang: 'en-GH' })
      } catch {
        heard = '' // silence / no-speech — keep listening
      }
      if (!convRef.current) break
      if (heard) {
        await sendText(heard)
        if (pendingRef.current) {
          // Pause the loop so the user confirms the sale/restock explicitly.
          convRef.current = false
          setConversing(false)
          break
        }
      } else {
        await new Promise((r) => setTimeout(r, 400))
      }
    }
  }, [sendText])

  const startConversation = useCallback(() => {
    if (convRef.current) return
    if (!speechSupported()) {
      pushMessage({ role: 'assistant', content: 'Voice is not available on this device. Please type instead.' })
      return
    }
    convRef.current = true
    setConversing(true)
    void runConversation()
  }, [runConversation, pushMessage])

  const stopConversation = useCallback(() => {
    convRef.current = false
    setConversing(false)
    stopListening()
    stopSpeaking()
  }, [])

  // Mic button: start a continuous conversation, or stop the running one.
  const toggleMic = useCallback(() => {
    if (convRef.current) stopConversation()
    else startConversation()
  }, [startConversation, stopConversation])

  const confirm = useCallback(async () => {
    if (!pendingRef.current) return
    const previewToSave = pendingRef.current
    busyRef.current = true
    setBusy(true)
    try {
      await executePreview(previewToSave, execApi)
      const done = describeSaved(previewToSave)
      pushMessage({ role: 'assistant', content: done })
      await speak(done)
    } catch {
      const msg = 'I could not save it. Please try again.'
      pushMessage({ role: 'assistant', content: msg })
      await speak(msg)
    } finally {
      setPending(null)
      pendingRef.current = null
      busyRef.current = false
      setBusy(false)
    }
  }, [execApi, pushMessage])

  const cancel = useCallback(() => {
    setPending(null)
    pendingRef.current = null
    pushMessage({ role: 'assistant', content: 'Okay, cancelled.' })
  }, [pushMessage])

  // Proactive spoken opener shown when the agent is first opened. English only,
  // greeting by time of day.
  const greet = useCallback(() => {
    const hour = new Date().getHours()
    const part = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
    const msg =
      `${part}! I'm SerwaaBroni. Tap the microphone to start talking to me. ` +
      'You can tell me a sale, a restock, or ask about your business.'
    if (messagesRef.current.length === 0) {
      messagesRef.current = [{ role: 'assistant', content: msg }]
      setMessages(messagesRef.current)
    }
    void speak(msg)
  }, [])

  return { messages, pending, busy, conversing, sendText, toggleMic, stopConversation, confirm, cancel, greet }
}
