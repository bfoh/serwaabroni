import type { ConfirmPreview } from '@/lib/agent/types'

export default function ConfirmCard({
  preview, busy, onConfirm, onCancel,
}: {
  preview: ConfirmPreview
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="bg-light harsh-border rounded-sm p-4 space-y-3">
      <p className="font-display text-sm uppercase tracking-wide text-ink">{preview.title}</p>

      <div className="space-y-1.5">
        {preview.lines.map((l, i) => (
          <div key={i} className="flex justify-between items-center text-sm">
            <span className="text-ink/80">{l.label}</span>
            <span className="font-medium">{l.value}</span>
          </div>
        ))}
      </div>

      {preview.warnings.length > 0 && (
        <div className="space-y-1">
          {preview.warnings.map((w, i) => (
            <p key={i} className="text-[11px] text-muted-text italic">{w}</p>
          ))}
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button
          onClick={onCancel}
          disabled={busy}
          className="btn-tactile flex-1 py-3 rounded-sm border-2 border-ink bg-white text-sm uppercase tracking-wide disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          disabled={busy}
          className="btn-tactile flex-1 py-3 rounded-sm bg-accent-green text-white text-sm uppercase tracking-wide disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Confirm ✓'}
        </button>
      </div>
    </div>
  )
}
