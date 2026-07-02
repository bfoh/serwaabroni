// send-notification: authenticated endpoint the app calls to send a single
// notification (receipt, debt reminder, critical alert) across the owner's enabled
// channels. Respects per-shop preferences in business_profiles and de-dupes per day.
//
// Invoke from the client:
//   supabase.functions.invoke('send-notification', { body: { type, data, refId, phoneTo, emailTo } })

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'
import { type Channel, resolveSender } from '../_shared/providers.ts'
import { dispatch } from '../_shared/dispatch.ts'
import type { NotificationData, NotificationType } from '../_shared/templates.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const TYPE_PREF: Record<NotificationType, string> = {
  receipt: 'notify_receipts',
  debt_reminder: 'notify_debt_reminders',
  daily_summary: 'notify_daily_summary',
  critical: 'notify_critical',
}

const CHANNEL_PREF: Record<Channel, string> = {
  sms: 'notify_sms',
  email: 'notify_email',
  whatsapp: 'notify_whatsapp',
}

interface Body {
  type: NotificationType
  data: NotificationData
  channels?: Channel[]
  phoneTo?: string | null
  emailTo?: string | null
  refId?: string | null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let body: Body & { userJwt?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }
  if (!body?.type || !body?.data) return json({ error: 'Missing type or data' }, 400)

  // The caller's token arrives in the body (the gateway can't parse ES256 Bearer
  // tokens). Validate it via GoTrue to identify the caller.
  if (!body.userJwt) return json({ error: 'Unauthorized' }, 401)
  const userClient = createClient(SUPABASE_URL, ANON_KEY)
  const { data: userData, error: userErr } = await userClient.auth.getUser(body.userJwt)
  if (userErr || !userData?.user) return json({ error: 'Unauthorized', detail: userErr?.message ?? null }, 401)
  const userId = userData.user.id

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  // Load owner preferences (service role: prefs gate sends regardless of RLS).
  const { data: profile } = await admin
    .from('business_profiles')
    .select('*')
    .eq('user_id', userId)
    .single()

  const prefs = (profile ?? {}) as Record<string, unknown>

  // Gate by notification type preference.
  const typePref = TYPE_PREF[body.type]
  if (prefs[typePref] === false) {
    return json({ ok: true, skipped: true, reason: `${typePref} disabled` })
  }

  // Resolve channels: requested (or all) ∩ enabled.
  const requested: Channel[] = body.channels ?? ['sms', 'email', 'whatsapp']
  const channels = requested.filter((ch) => prefs[CHANNEL_PREF[ch]] !== false)

  const results = await dispatch({
    admin,
    userId,
    type: body.type,
    data: body.data,
    channels,
    emailTo: body.emailTo ?? null,
    phoneTo: body.phoneTo ?? null,
    refId: body.refId ?? null,
    senderId: resolveSender(prefs.sms_sender_id as string | null),
  })

  return json({ ok: true, results })
})
