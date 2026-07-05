import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase'

export class TwiNotConfiguredError extends Error {
  constructor() {
    super('Twi voice is not set up yet.')
    this.name = 'TwiNotConfiguredError'
  }
}
export function isTwiNotConfigured(e: unknown): boolean {
  return e instanceof TwiNotConfiguredError
}

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))

export function normalizeTranscribe(data: unknown): { twi: string; english: string } {
  const o = (data ?? {}) as Record<string, unknown>
  return { twi: str(o.twi), english: str(o.english) }
}
export function normalizeSpeak(data: unknown): { twi: string; audioBase64: string; mimeType: string } {
  const o = (data ?? {}) as Record<string, unknown>
  return { twi: str(o.twi), audioBase64: str(o.audioBase64), mimeType: str(o.mimeType) || 'audio/wav' }
}

interface Deps {
  getToken: () => Promise<string | null>
  doFetch: typeof fetch
}
const defaultDeps: Deps = {
  getToken: async () => {
    const { data } = await supabase.auth.getSession()
    return data.session?.access_token ?? null
  },
  doFetch: (...a) => fetch(...a),
}

async function callSpeech(payload: Record<string, unknown>, deps: Deps): Promise<unknown> {
  const token = await deps.getToken()
  if (!token) throw new Error('You are not signed in.')
  const res = await deps.doFetch(`${SUPABASE_URL}/functions/v1/serwaa-speech`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      apikey: SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...payload, userJwt: token }),
  })
  const r = res as Response
  const data = await r.json().catch(() => ({}) as Record<string, unknown>)
  if (r.status === 501 || (data as { error?: string }).error === 'twi_not_configured') {
    throw new TwiNotConfiguredError()
  }
  if (!r.ok) throw new Error((data as { error?: string }).error || 'Twi speech failed.')
  return data
}

export async function transcribeTwi(
  audioBase64: string,
  mimeType: string,
  deps: Deps = defaultDeps,
): Promise<{ twi: string; english: string }> {
  return normalizeTranscribe(await callSpeech({ action: 'transcribe', audioBase64, mimeType }, deps))
}

export async function speakTwi(
  text: string,
  deps: Deps = defaultDeps,
): Promise<{ twi: string; audioBase64: string; mimeType: string }> {
  return normalizeSpeak(await callSpeech({ action: 'speak', text }, deps))
}

export function playBase64Audio(base64: string, mimeType: string): Promise<void> {
  return new Promise((resolve) => {
    if (!base64) return resolve()
    try {
      const audio = new Audio(`data:${mimeType};base64,${base64}`)
      audio.onended = () => resolve()
      audio.onerror = () => resolve()
      void audio.play().catch(() => resolve())
      // Safety net if the events never fire.
      setTimeout(resolve, 20000)
    } catch {
      resolve()
    }
  })
}
