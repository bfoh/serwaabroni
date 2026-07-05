// Twi speech proxy: Khaya ASR + translate + TTS. Holds KHAYA_API_KEY. No DB writes.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const KHAYA_API_KEY = Deno.env.get('KHAYA_API_KEY') ?? ''
const TRANSLATE_URL = Deno.env.get('KHAYA_TRANSLATE_URL') ?? 'https://translation-api.ghananlp.org/v1/translate'
const ASR_URL = Deno.env.get('KHAYA_ASR_URL') ?? 'https://translation-api.ghananlp.org/asr/v3/transcribe'
const TTS_URL = Deno.env.get('KHAYA_TTS_URL') ?? 'https://translation-api.ghananlp.org/tts/v2/tts'
// TTS v2 speakers are multilingual: male_low | male_high | female.
const TWI_SPEAKER = Deno.env.get('KHAYA_TWI_SPEAKER') ?? 'female'
// Language codes: translate uses the 2-letter code ('tw'); ASR v3 / TTS v2 use
// ISO 639-3 ('twi'). All overridable if a given product expects otherwise.
const TW_CODE = Deno.env.get('KHAYA_TRANSLATE_TW') ?? 'tw'
const ASR_LANG = Deno.env.get('KHAYA_ASR_LANG') ?? 'twi'
const TTS_LANG = Deno.env.get('KHAYA_TTS_LANG') ?? 'twi'

const KEY_HEADER = { 'Ocp-Apim-Subscription-Key': KHAYA_API_KEY }

interface Body {
  userJwt?: string
  action?: 'transcribe' | 'speak'
  audioBase64?: string
  mimeType?: string
  text?: string
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
function bytesToB64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

// Khaya translate. lang is 'tw-en' or 'en-tw'.
async function translate(text: string, lang: string): Promise<string> {
  const res = await fetch(TRANSLATE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...KEY_HEADER },
    body: JSON.stringify({ in: text, lang }),
  })
  if (!res.ok) throw new Error(`translate ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = await res.json().catch(() => null)
  // Khaya returns either a bare string or { translated_text } / { text }.
  if (typeof data === 'string') return data
  return String((data?.translated_text ?? data?.text ?? data?.out ?? '') || '')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    let body: Body
    try {
      body = await req.json()
    } catch {
      return json({ error: 'Invalid JSON' }, 400)
    }
    if (!body.userJwt) return json({ error: 'Unauthorized' }, 401)
    if (!KHAYA_API_KEY) return json({ error: 'twi_not_configured' }, 501)

    const userClient = createClient(SUPABASE_URL, ANON_KEY)
    const { data: userData, error: userErr } = await userClient.auth.getUser(body.userJwt)
    if (userErr || !userData?.user) return json({ error: 'Unauthorized' }, 401)

    if (body.action === 'transcribe') {
      if (!body.audioBase64 || !body.mimeType) return json({ error: 'Missing audio' }, 400)
      const asrRes = await fetch(`${ASR_URL}?language=${ASR_LANG}`, {
        method: 'POST',
        headers: { 'Content-Type': body.mimeType, ...KEY_HEADER },
        body: b64ToBytes(body.audioBase64),
      })
      if (!asrRes.ok) return json({ error: 'ASR error', detail: (await asrRes.text()).slice(0, 200) }, 502)
      const asrData = await asrRes.json().catch(() => null)
      const twi = typeof asrData === 'string' ? asrData : String(asrData?.text ?? asrData?.transcription ?? '')
      const english = twi ? await translate(twi, `${TW_CODE}-en`) : ''
      return json({ twi, english })
    }

    if (body.action === 'speak') {
      const text = String(body.text ?? '').trim()
      if (!text) return json({ error: 'Missing text' }, 400)
      const twi = await translate(text, `en-${TW_CODE}`)
      const ttsRes = await fetch(TTS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...KEY_HEADER },
        body: JSON.stringify({ text: twi, language: TTS_LANG, speaker_id: TWI_SPEAKER }),
      })
      if (!ttsRes.ok) return json({ error: 'TTS error', detail: (await ttsRes.text()).slice(0, 200) }, 502)
      const ctype = ttsRes.headers.get('content-type') ?? ''
      let audioBase64: string
      let mimeType: string
      if (ctype.includes('application/json')) {
        const d = await ttsRes.json()
        audioBase64 = String(d?.audio ?? d?.audioContent ?? d?.data ?? '')
        mimeType = String(d?.mimeType ?? 'audio/wav')
      } else {
        audioBase64 = bytesToB64(new Uint8Array(await ttsRes.arrayBuffer()))
        mimeType = ctype || 'audio/wav'
      }
      return json({ twi, audioBase64, mimeType })
    }

    return json({ error: 'Unknown action' }, 400)
  } catch (e) {
    return json({ error: 'Speech error', detail: e instanceof Error ? e.message : String(e) }, 500)
  }
})
