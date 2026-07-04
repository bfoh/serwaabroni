// src/components/agent/AgentSheet.tsx
import { useEffect, useRef, useState } from 'react'
import { Mic, Send } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useAgent } from '@/hooks/useAgent'
import { primeSpeech } from '@/lib/agent/speech'
import ConfirmCard from './ConfirmCard'

export default function AgentSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { messages, pending, busy, sendText, listen, confirm, cancel, greet } = useAgent()
  const [text, setText] = useState('')
  const greetedRef = useRef(false)

  // When the sheet opens: unlock speech (inside the open gesture) and, if this is
  // a fresh conversation, have SerwaaBroni greet the user out loud.
  useEffect(() => {
    if (open && !greetedRef.current) {
      greetedRef.current = true
      primeSpeech()
      if (messages.length === 0) greet()
    }
    if (!open) greetedRef.current = false
  }, [open, messages.length, greet])

  const submit = async () => {
    const t = text
    setText('')
    await sendText(t)
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="rounded-t-2xl h-[85vh] flex flex-col">
        <SheetHeader>
          <SheetTitle>SerwaaBroni</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto space-y-3 py-3">
          {messages.length === 0 && (
            <p className="text-sm text-muted-text text-center py-8">
              Tap the mic and speak, or type. Try: “Sold 5 Indomie for cash”, “Add 24 Milo to stock”, or “How are sales today?”
            </p>
          )}
          {messages.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
              <span
                className={`inline-block px-3 py-2 rounded-sm text-sm max-w-[85%] ${
                  m.role === 'user' ? 'bg-ink text-white' : 'bg-warm-gray text-ink'
                }`}
              >
                {m.content}
              </span>
            </div>
          ))}
          {pending && (
            <ConfirmCard preview={pending} busy={busy} onConfirm={confirm} onCancel={cancel} />
          )}
        </div>

        <div className="flex items-center gap-2 pt-2 pb-[env(safe-area-inset-bottom)]">
          <button
            onClick={() => { primeSpeech(); listen() }}
            disabled={busy}
            aria-label="Speak"
            className="btn-tactile w-12 h-12 shrink-0 rounded-full bg-accent-green text-white flex items-center justify-center disabled:opacity-50"
          >
            <Mic size={20} />
          </button>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="Type a message…"
            className="flex-1 harsh-border rounded-sm px-3 py-2 text-sm"
          />
          <button
            onClick={submit}
            disabled={busy || !text.trim()}
            aria-label="Send"
            className="btn-tactile w-12 h-12 shrink-0 rounded-full bg-ink text-white flex items-center justify-center disabled:opacity-50"
          >
            <Send size={18} />
          </button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
