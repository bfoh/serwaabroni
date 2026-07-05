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

// Parse the user's answer to "does the buyer want a receipt?" without the LLM,
// so the flow is reliable. Returns whether they declined, plus any name/phone.
export function parseReceiptReply(text: string): { negative: boolean; name: string; phone: string } {
  const t = text.trim()
  const hasDigits = /\d/.test(t)
  if (!hasDigits && /\b(no|nope|nah|skip|without|cancel|don'?t|do not)\b/i.test(t)) {
    return { negative: true, name: '', phone: '' }
  }
  const phoneMatch = t.match(/\+?\d[\d\s-]{7,}\d/)
  const phone = phoneMatch ? phoneMatch[0].replace(/\D/g, '') : ''
  let name = phoneMatch ? t.replace(phoneMatch[0], ' ') : t
  name = name
    .replace(
      /\b(her|his|their|the|customer'?s?|name|is|are|number|phone|mobile|contact|and|call|it'?s|send|receipt|to|please|yes|buyer)\b/gi,
      ' ',
    )
    .replace(/[^\p{L}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return { negative: false, name, phone }
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
  // True right after a cash sale while we wait for the buyer's receipt answer,
  // plus a draft that accumulates the name/phone across several replies.
  const awaitingReceiptRef = useRef(false)
  const receiptDraftRef = useRef<{ name: string; phone: string; askedName: boolean }>({
    name: '',
    phone: '',
    askedName: false,
  })

  const pushMessage = useCallback((msg: AgentMessage) => {
    messagesRef.current = [...messagesRef.current, msg]
    setMessages(messagesRef.current)
  }, [])

  // Handle the buyer's receipt details for the most recent cash sale. Saves a new
  // customer (or updates an existing one), then opens the receipt box so the user
  // picks how to send it (SMS / WhatsApp / print / download).
  const handleReceipt = useCallback(
    async (
      receipt: { customerName: string; customerPhone: string },
      s: (typeof storeRef.current)['state'],
    ): Promise<string> => {
      const ctx = lastSaleRef.current
      const name = receipt.customerName.trim()
      const phone = receipt.customerPhone.trim()
      if (!ctx) return 'There is no recent sale to send a receipt for.'
      if (!phone) return "I need the buyer's phone number for the receipt. Please say the name and number."

      const digits = (p: string) => p.replace(/\D/g, '')
      const existing = s.customers.find(
        (c) =>
          (c.phone && digits(c.phone) === digits(phone)) ||
          (!!name && c.name.toLowerCase() === name.toLowerCase()),
      )

      if (existing) {
        if (phone && existing.phone !== phone) void storeRef.current.updateCustomer(existing.id, { phone })
      } else {
        // New customer → save them with this purchase on record.
        void storeRef.current.addCustomer({
          id: uid(),
          name: name || 'Customer',
          phone,
          email: null,
          total_purchases: ctx.total,
          created_at: new Date().toISOString(),
        })
      }

      // Put the buyer's details on the receipt rows and open the box.
      const who = existing?.name || name
      const rows = ctx.rows.map((r) => ({ ...r, customer_name: who || null, customer_phone: phone }))
      convRef.current = false
      setConversing(false)
      stopListening()
      setReceiptSales(rows)
      lastSaleRef.current = null
      return `Here is the receipt for ${who || 'the customer'}. Choose how to send it.`
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
      if (!clean) return

      // Receipt answer (captured client-side, no LLM, so it's reliable and the
      // agent never claims it "can't access the customer database"). The name and
      // phone can arrive over several replies — accumulate them.
      if (awaitingReceiptRef.current) {
        pushMessage({ role: 'user', content: clean })
        const parsed = parseReceiptReply(clean)
        const draft = receiptDraftRef.current

        // "No" only cancels while we don't yet have a number.
        if (parsed.negative && !draft.phone) {
          awaitingReceiptRef.current = false
          lastSaleRef.current = null
          const reply = 'Okay, no receipt.'
          pushMessage({ role: 'assistant', content: reply })
          await speak(reply)
          return
        }

        if (parsed.name) draft.name = parsed.name
        if (parsed.phone) draft.phone = parsed.phone

        // Still need a phone number.
        if (!draft.phone) {
          const reply = draft.name
            ? `Got it, ${draft.name}. What is the phone number? Or say no.`
            : "Please say the buyer's name and phone number, or say no."
          pushMessage({ role: 'assistant', content: reply })
          await speak(reply)
          return
        }

        // Have a phone but no name yet — ask once, then proceed regardless.
        if (!draft.name && !draft.askedName) {
          draft.askedName = true
          const reply = 'And what is the customer name?'
          pushMessage({ role: 'assistant', content: reply })
          await speak(reply)
          return
        }

        awaitingReceiptRef.current = false
        const reply = await handleReceipt(
          { customerName: draft.name, customerPhone: draft.phone },
          storeRef.current.state,
        )
        receiptDraftRef.current = { name: '', phone: '', askedName: false }
        pushMessage({ role: 'assistant', content: reply })
        await speak(reply)
        return
      }

      if (busyRef.current) return
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
        awaitingReceiptRef.current = true
        receiptDraftRef.current = { name: '', phone: '', askedName: false }
        reply += ' Would the buyer like a receipt? If yes, tell me their name and phone number. If not, say no.'
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
    awaitingReceiptRef.current = false
    receiptDraftRef.current = { name: '', phone: '', askedName: false }
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

  const closeReceipt = useCallback(() => {
    setReceiptSales(null)
    awaitingReceiptRef.current = false
    lastSaleRef.current = null
    receiptDraftRef.current = { name: '', phone: '', askedName: false }
  }, [])

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
