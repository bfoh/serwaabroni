import { ArrowRight } from 'lucide-react'
import CategoriesManager from '@/components/CategoriesManager'

interface CategoriesSetupScreenProps {
  onDone: () => void
}

// Shown once, immediately after a brand-new owner picks their industry
// (see IndustryPicker -> chooseIndustry -> store.tsx's showCategoriesSetup
// flag). Lets them review/rename/add/remove the starter categories that
// were just seeded before landing on the dashboard for the first time.
export default function CategoriesSetupScreen({ onDone }: CategoriesSetupScreenProps) {
  return (
    <div className="flex-1 overflow-y-auto bg-sand px-6 py-10 flex flex-col items-center">
      <h1 className="font-display text-2xl text-ink uppercase tracking-tight text-center mb-2">Set up your categories</h1>
      <p className="text-sm text-muted-text text-center mb-6">
        We've started you off with categories for your trade — rename, add, or remove any of them. You can always change these later in Settings.
      </p>
      <div className="w-full max-w-sm mb-8">
        <CategoriesManager />
      </div>
      <button
        onClick={onDone}
        className="w-full max-w-sm h-14 bg-ink text-white font-display text-sm uppercase tracking-wider rounded-sm flex items-center justify-center gap-2"
      >
        Continue <ArrowRight size={18} />
      </button>
    </div>
  )
}
