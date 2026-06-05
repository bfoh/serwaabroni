import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { type Channel, sendEmail, sendSMS, sendWhatsApp } from './providers.ts'
import { buildEmail, buildSMS, type NotificationData, type NotificationType } from './templates.ts'

export interface DispatchArgs {
  admin: SupabaseClient
  userId: string
  type: NotificationType
  data: NotificationData
  channels: Channel[]
  emailTo?: string | null
  phoneTo?: string | null
  refId?: string | null
  senderId?: string // SMS sender ID override (already resolved/sanitized)
}

export interface ChannelResult {
  channel: Channel
  ok: boolean
  skipped?: boolean
  error?: string
}

async function alreadySentToday(
  admin: SupabaseClient,
  userId: string,
  type: string,
  channel: string,
  recipient: string,
  refId: string | null,
): Promise<boolean> {
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)
  const { data } = await admin
    .from('notification_log')
    .select('id')
    .eq('user_id', userId)
    .eq('type', type)
    .eq('channel', channel)
    .eq('recipient', recipient)
    .eq('status', 'sent')
    .gte('sent_at', startOfDay.toISOString())
    .filter('ref_id', refId ? 'eq' : 'is', refId ?? null)
    .limit(1)
  return !!data && data.length > 0
}

function recipientName(d: NotificationData): string {
  return d.customerName ?? d.personName ?? d.ownerName ?? ''
}

// Send a notification across the requested channels, skipping channels with no
// recipient or one already contacted today, and recording every attempt.
export async function dispatch(args: DispatchArgs): Promise<ChannelResult[]> {
  const { admin, userId, type, data, channels, emailTo, phoneTo, refId = null, senderId } = args
  const results: ChannelResult[] = []

  for (const channel of channels) {
    const recipient = channel === 'email' ? emailTo : phoneTo
    if (!recipient) continue // no contact for this channel — skip silently

    if (await alreadySentToday(admin, userId, type, channel, recipient, refId)) {
      results.push({ channel, ok: true, skipped: true })
      continue
    }

    let res: { ok: boolean; error?: string }
    if (channel === 'email') {
      const { subject, html } = buildEmail(type, data)
      res = await sendEmail(recipient, recipientName(data), subject, html)
    } else if (channel === 'whatsapp') {
      res = await sendWhatsApp(recipient, buildSMS(type, data))
    } else {
      res = await sendSMS(recipient, buildSMS(type, data), senderId)
    }

    await admin.from('notification_log').insert({
      user_id: userId,
      type,
      channel,
      recipient,
      ref_id: refId,
      status: res.ok ? 'sent' : 'failed',
      error: res.error ?? null,
    })

    results.push({ channel, ok: res.ok, error: res.error })
  }

  return results
}
