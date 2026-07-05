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
import { sendNotification } from '@/services/notify'
import { formatCurrency, formatDate, uid } from '@/lib/data'
import type { AgentMessage, BusinessSnapshot, ConfirmPreview, AgentResponse, Sale } from '@/lib/agent/types'

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
  receipt?: { customerName: string; customerPhone: string }
}

export async function runTurn(userText: string, deps: TurnDeps): Promise<TurnOutcome> {
  const messages: AgentMessage[] = [...deps.history, { role: 'user', content: userText }]
  const res = await deps.callAgent(messages, deps.snapshot)

  const call = res.toolCalls[0]
  if (!call) {
    return { reply: res.say || "I'm here. Tell me a sale, a restock, or ask about your business.", pending: null }
  }

  // Receipt request for the last sale — handled by the hook (needs the sale payload).
  if (call.name === 'send_receipt') {
    return {
      reply: res.say || '',
      pending: null,
      receipt: {
        customerName: String(call.input.customer_name ?? '').trim(),
        customerPhone: String(call.input.customer_phone ?? '').trim(),
      },
    }
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
  // When set, the receipt box is shown for the user to pick a send channel.
  const [receiptSales, setReceiptSales] = useState<Sale[] | null>(null)

  // Refs mirror state so the async conversation loop and the stable sendText
  // callback always read the latest values (no stale closures across turns).
  const messagesRef = useRef<AgentMessage[]>([])
  const pendingRef = useRef<ConfirmPreview | null>(null)
  const busyRef = useRef(false)
  const convRef = useRef(false)
  const storeRef = useRef(store)
  storeRef.current = store
  // Payload of the most recent cash sale, so a receipt can be sent if the buyer
  // asks for one right after.
  const lastSaleRef = useRef<{
    rows: Sale[]
    total: number
    refId: string
    date: string
  } | null>(null)
  // True when a money action paused a voice conversation, so we know to resume
  // listening after the user confirms it.
  const resumeAfterConfirmRef = useRef(false)

  const pushMessage = useCallback((msg: AgentMessage) => {
    messagesRef.current = [...messagesRef.current, msg]
    setMessages(messagesRef.current)
  }, [])

  // Handle a receipt request for the most recent cash sale.
  // Existing customer → open the receipt box so the user picks how to send it.
  // New customer → save them (with this purchase) and send the receipt by SMS.
  const handleReceipt = useCallback(
    async (
      receipt: { customerName: string; customerPhone: string },
      s: (typeof storeRef.current)['state'],
    ): Promise<string> => {
      const ctx = lastSaleRef.current
      const name = receipt.customerName.trim()
      const phone = receipt.customerPhone.trim()
      if (!ctx) return 'There is no recent sale to send a receipt for.'
      if (!phone) return "I need the buyer's phone number to send the receipt."

      const digits = (p: string) => p.replace(/\D/g, '')
      const existing = s.customers.find(
        (c) =>
          (c.phone && digits(c.phone) === digits(phone)) ||
          (!!name && c.name.toLowerCase() === name.toLowerCase()),
      )

      // Put the buyer's details on the receipt rows so the box shows them.
      const rows = ctx.rows.map((r) => ({ ...r, customer_name: name || null, customer_phone: phone }))

      if (existing) {
        if (existing.phone !== phone) void storeRef.current.updateCustomer(existing.id, { phone })
        // Stop listening and open the receipt box for the user to choose a channel.
        convRef.current = false
        setConversing(false)
        stopListening()
        setReceiptSales(rows)
        lastSaleRef.current = null
        return `Opening the receipt for ${existing.name}. Choose how to send it.`
      }

      // New customer: save them with this purchase and send the receipt by SMS.
      if (name) {
        void storeRef.current.addCustomer({
          id: uid(),
          name,
          phone,
          email: null,
          total_purchases: ctx.total,
          created_at: new Date().toISOString(),
        })
      }
      void sendNotification({
        type: 'receipt',
        data: {
          businessName: s.businessProfile?.business_name || 'Your vendor',
          ownerName: s.businessProfile?.owner_name,
          customerName: name || null,
          items: ctx.rows.map((r) => ({ name: r.product_name, qty: r.quantity, price: r.unit_price, total: r.total })),
          total: ctx.total,
          date: ctx.date,
        },
        phoneTo: phone,
        emailTo: null,
        refId: ctx.refId,
      })
      lastSaleRef.current = null
      return `Added ${name || 'the customer'} as a new customer and sent the receipt by SMS to ${phone}.`
    },
    [],
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

        // Receipt for the last sale: send via the existing notification flow.
        if (out.receipt) {
          const reply = await handleReceipt(out.receipt, s)
          pushMessage({ role: 'assistant', content: reply })
          await speak(reply)
          return
        }

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
    [pushMessage, handleReceipt],
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
          // Pause the loop so the user confirms the sale/restock explicitly, and
          // remember to resume listening once they do.
          convRef.current = false
          setConversing(false)
          resumeAfterConfirmRef.current = true
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
    const resume = resumeAfterConfirmRef.current
    resumeAfterConfirmRef.current = false
    try {
      await executePreview(previewToSave, execApi)
      // Clear the card and unblock immediately so it feels fast — speak after.
      setPending(null)
      pendingRef.current = null
      busyRef.current = false
      setBusy(false)

      let reply = describeSaved(previewToSave)
      // Cash sale → remember it (as receipt-ready rows) and offer a receipt.
      if (previewToSave.kind === 'sale' && previewToSave.sale) {
        const nowIso = new Date().toISOString()
        const groupId = uid()
        const rows: Sale[] = previewToSave.sale.items.map((i) => ({
          id: uid(),
          user_id: '',
          product_id: i.productId,
          product_name: i.productName,
          quantity: i.qty,
          unit_price: i.unitPrice,
          total: i.unitPrice * i.qty,
          profit: (i.unitPrice - i.unitCost) * i.qty,
          customer_name: null,
          customer_phone: null,
          payment_method: 'cash',
          sale_group_id: groupId,
          sale_unit: null,
          sale_unit_qty: null,
          created_at: nowIso,
        }))
        lastSaleRef.current = {
          rows,
          total: rows.reduce((sum, r) => sum + r.total, 0),
          refId: uid(),
          date: formatDate(nowIso),
        }
        reply += ' Would the buyer like a receipt? If yes, tell me their name and phone number.'
      }
      pushMessage({ role: 'assistant', content: reply })
      void speak(reply)

      // Resume the voice conversation (e.g. to hear the receipt answer) if the
      // sale came from a voice conversation.
      if (resume && speechSupported() && !convRef.current) {
        convRef.current = true
        setConversing(true)
        void runConversation()
      }
    } catch {
      setPending(null)
      pendingRef.current = null
      busyRef.current = false
      setBusy(false)
      const msg = 'I could not save it. Please try again.'
      pushMessage({ role: 'assistant', content: msg })
      void speak(msg)
    }
  }, [execApi, pushMessage, runConversation])

  const cancel = useCallback(() => {
    setPending(null)
    pendingRef.current = null
    resumeAfterConfirmRef.current = false
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

  const closeReceipt = useCallback(() => setReceiptSales(null), [])

  return {
    messages,
    pending,
    busy,
    conversing,
    receiptSales,
    sendText,
    toggleMic,
    stopConversation,
    confirm,
    cancel,
    greet,
    closeReceipt,
  }
}
