import { supabase } from '@/lib/supabase'

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
    const { data, error } = await supabase.functions.invoke('send-notification', { body: payload })
    if (error) {
      console.warn('sendNotification error:', error.message)
      return false
    }
    return !!data?.ok
  } catch (err) {
    console.warn('sendNotification failed:', err)
    return false
  }
}
