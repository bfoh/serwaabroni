import { useState } from 'react'
import { Mic } from 'lucide-react'
import AgentSheet from '@/components/agent/AgentSheet'
import '../App.css'

export default function Home() {
  const [count, setCount] = useState(0)
  const [agentOpen, setAgentOpen] = useState(false)

  return (
    <>
      <h1>Vite + React</h1>
      <div className="card">
        <button onClick={() => setCount((count) => count + 1)}>
          count is {count}
        </button>
        <p>
          Edit <code>src/App.tsx</code> and save to test HMR
        </p>
      </div>

      {/* SerwaaBroni agent */}
      <button
        onClick={() => setAgentOpen(true)}
        aria-label="Open SerwaaBroni"
        className="fixed right-4 bottom-24 z-40 w-14 h-14 rounded-full bg-accent-green text-white shadow-lg flex items-center justify-center btn-tactile"
      >
        <Mic size={24} />
      </button>
      <AgentSheet open={agentOpen} onClose={() => setAgentOpen(false)} />
    </>
  )
}
