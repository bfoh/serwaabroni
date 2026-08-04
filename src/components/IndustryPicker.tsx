import { useState } from 'react'
import { Loader2, ArrowRight } from 'lucide-react'
import { useStore } from '@/lib/store'
import { INDUSTRIES } from '@/lib/categories'

export default function IndustryPicker() {
  const { showToast, chooseIndustry } = useStore()
  const [selected, setSelected] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const handleContinue = async () => {
    if (!selected) { showToast('Pick your business type', 'error'); return }
    setSaving(true)
    try {
      await chooseIndustry(selected)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto bg-sand px-6 py-10 flex flex-col items-center">
      <h1 className="font-display text-2xl text-ink uppercase tracking-tight text-center mb-2">What do you sell?</h1>
      <p className="text-sm text-muted-text text-center mb-6">
        We'll set up starter categories for your trade — you can change them anytime in Settings.
      </p>
      <div className="w-full max-w-sm grid grid-cols-2 gap-3 mb-8">
        {INDUSTRIES.map((industry) => (
          <button
            key={industry}
            type="button"
            onClick={() => setSelected(industry)}
            className={`py-5 px-3 rounded-sm border-2 font-display text-xs uppercase tracking-wider text-center ${
              selected === industry ? 'bg-ink text-white border-ink' : 'bg-light text-ink border-ink'
            }`}
          >
            {industry}
          </button>
        ))}
      </div>
      <button
        onClick={handleContinue}
        disabled={saving || !selected}
        className="w-full max-w-sm h-14 bg-ink text-white font-display text-sm uppercase tracking-wider rounded-sm flex items-center justify-center gap-2 disabled:opacity-50"
      >
        {saving ? <Loader2 size={20} className="animate-spin" /> : <>Continue <ArrowRight size={18} /></>}
      </button>
    </div>
  )
}
