import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase'

// Thin client wrapper around the send-notification edge function. All provider keys
// live server-side; the browser only describes WHAT to send, never holds credentials.

export type NotificationType = 'receipt' | 'debt_reminder' | 'daily_summary' | 'critical'
export type Channel = 'sms' | 'email' | 'whatsapp'

export interface NotifyData {
  businessName?: string
  ownerName?: string | null
  customerName?: string | null
  personName?: string | null
  amount?: number
  dueDate?: string
  date?: string
  items?: Array<{ name: string; qty: number; price: number; total: number }>
  total?: number
  title?: string
  message?: string
}

export interface NotifyPayload {
  type: NotificationType
  data: NotifyData
  channels?: Channel[]
  phoneTo?: string | null
  emailTo?: string | null
  refId?: string | null
}

// Fire-and-forget: returns false on any failure but never throws, so callers can
// trigger notifications without blocking the primary action (sale, payment, etc.).
export async function sendNotification(payload: NotifyPayload): Promise<boolean> {
  try {
    const { data: sess } = await supabase.auth.getSession()
    const userJwt = sess.session?.access_token
    if (!userJwt) return false
    // This project uses asymmetric (ES256) JWT signing keys, which the edge
    // gateway cannot parse in the Authorization header. Send the anon key
    // (legacy HS256) as Authorization and pass the user token in the body.
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-notification`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...payload, userJwt }),
    })
    const data = await res.json().catch(() => ({} as { ok?: boolean }))
    if (!res.ok) {
      console.warn('sendNotification error:', data)
      return false
    }
    return !!data?.ok
  } catch (err) {
    console.warn('sendNotification failed:', err)
    return false
  }
}
