import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase'
import type { AgentMessage, AgentResponse, BusinessSnapshot } from './types'

interface Deps {
  getToken: () => Promise<string | null>
  doFetch: typeof fetch
}

const defaultDeps: Deps = {
  getToken: async () => {
    const { data } = await supabase.auth.getSession()
    return data.session?.access_token ?? null
  },
  doFetch: (...args) => fetch(...args),
}

export async function callAgent(
  messages: AgentMessage[],
  snapshot: BusinessSnapshot,
  deps: Deps = defaultDeps,
): Promise<AgentResponse> {
  const token = await deps.getToken()
  if (!token) throw new Error('You are not signed in.')

  const res = await deps.doFetch(`${SUPABASE_URL}/functions/v1/serwaa-agent`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      apikey: SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ userJwt: token, messages, snapshot }),
  })

  const data = await res.json().catch(() => ({}) as Record<string, unknown>)
  if (!(res as Response).ok) {
    throw new Error((data as { error?: string }).error || 'The agent could not respond. Please try again.')
  }
  return {
    say: String((data as AgentResponse).say ?? ''),
    toolCalls: Array.isArray((data as AgentResponse).toolCalls) ? (data as AgentResponse).toolCalls : [],
  }
}
