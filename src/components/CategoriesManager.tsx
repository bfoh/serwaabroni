import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Tag, Plus, Pencil, Trash2, RefreshCw } from 'lucide-react'
import { useStore } from '@/lib/store'
import { CURATED_ICONS } from '@/lib/categories'
import { CATEGORY_ICON_MAP } from '@/lib/categoryIconMap'

// Category list + add/rename/delete + reassign-then-delete flow, extracted
// from Settings' "Manage Categories" modal so it can also be reused as a
// full-screen onboarding step right after signup (see CategoriesSetupScreen).
export default function CategoriesManager() {
  const { state, showToast, addCategory, renameCategory, removeCategory, loadStarterCategories, reassignAndDeleteCategory } = useStore()
  const [newCatName, setNewCatName] = useState('')
  const [newCatIcon, setNewCatIcon] = useState(CURATED_ICONS[0])
  const [renamingCatId, setRenamingCatId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [reassignFrom, setReassignFrom] = useState<{ id: string; name: string; count: number } | null>(null)
  const [reassignTo, setReassignTo] = useState('')
  const [savingCategory, setSavingCategory] = useState(false)

  return (
    <div className="space-y-4">
      <button
        onClick={async () => {
          setSavingCategory(true)
          await loadStarterCategories(state.businessProfile?.industry || 'Supermarket')
          setSavingCategory(false)
        }}
        disabled={savingCategory}
        className="w-full h-10 bg-warm-gray rounded-sm font-display text-xs text-ink uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-50"
      >
        <RefreshCw size={14} /> Load starter categories
      </button>

      <div className="space-y-2">
        {state.categories.map((cat) => {
          const Icon = CATEGORY_ICON_MAP[cat.icon] || Tag
          const count = state.products.filter((p) => p.category === cat.name).length
          return (
            <div key={cat.id} className="flex items-center gap-3 bg-light harsh-border rounded-sm px-3 py-2.5">
              <Icon size={18} className="text-ink flex-shrink-0" />
              {renamingCatId === cat.id ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  className="flex-1 h-8 px-2 bg-white harsh-border rounded-sm text-sm"
                />
              ) : (
                <span className="flex-1 text-sm text-ink truncate">{cat.name}</span>
              )}
              <span className="text-[10px] text-muted-text">{count}</span>
              {renamingCatId === cat.id ? (
                <button
                  onClick={async () => {
                    if (renameValue.trim() && renameValue.trim() !== cat.name) {
                      await renameCategory(cat.id, renameValue.trim())
                    }
                    setRenamingCatId(null)
                  }}
                  className="w-7 h-7 flex items-center justify-center rounded-sm bg-accent-green/10"
                >
                  <Pencil size={12} className="text-accent-green" />
                </button>
              ) : (
                <button
                  onClick={() => { setRenamingCatId(cat.id); setRenameValue(cat.name) }}
                  className="w-7 h-7 flex items-center justify-center rounded-sm bg-warm-gray"
                >
                  <Pencil size={12} className="text-ink" />
                </button>
              )}
              {!cat.is_builtin && (
                <button
                  onClick={async () => {
                    const result = await removeCategory(cat.id)
                    if (result.blocked && result.reason === 'in-use') {
                      setReassignFrom({ id: cat.id, name: cat.name, count: result.count })
                      setReassignTo(state.categories.find((c) => c.id !== cat.id)?.name || '')
                    }
                  }}
                  className="w-7 h-7 flex items-center justify-center rounded-sm bg-accent-red/10"
                >
                  <Trash2 size={12} className="text-accent-red" />
                </button>
              )}
            </div>
          )
        })}
      </div>

      <div className="pt-2 border-t border-ink/10">
        <p className="text-[10px] text-muted-text uppercase tracking-wider mb-2">Add category</p>
        <input
          value={newCatName}
          onChange={(e) => setNewCatName(e.target.value)}
          placeholder="e.g. Frozen Foods"
          className="w-full h-10 px-3 bg-light harsh-border rounded-sm text-sm mb-2"
        />
        <div className="grid grid-cols-8 gap-1.5 mb-2">
          {CURATED_ICONS.map((iconKey) => {
            const Icon = CATEGORY_ICON_MAP[iconKey]
            return (
              <button
                key={iconKey}
                type="button"
                onClick={() => setNewCatIcon(iconKey)}
                className={`w-8 h-8 flex items-center justify-center rounded-sm border-2 ${newCatIcon === iconKey ? 'bg-ink border-ink' : 'bg-light border-ink'}`}
              >
                <Icon size={14} className={newCatIcon === iconKey ? 'text-white' : 'text-ink'} />
              </button>
            )
          })}
        </div>
        <button
          onClick={async () => {
            if (!newCatName.trim()) { showToast('Enter a category name', 'error'); return }
            setSavingCategory(true)
            await addCategory(newCatName.trim(), newCatIcon)
            setNewCatName('')
            setSavingCategory(false)
          }}
          disabled={savingCategory}
          className="w-full h-10 bg-ink text-white rounded-sm font-display text-xs uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <Plus size={14} /> Add Category
        </button>
      </div>

      {/* Reassign-then-delete Modal */}
      <AnimatePresence>
        {reassignFrom && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/60 z-[70]" onClick={() => setReassignFrom(null)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, x: '-50%', y: '-50%' }}
              animate={{ opacity: 1, scale: 1, x: '-50%', y: '-50%' }}
              exit={{ opacity: 0, scale: 0.95, x: '-50%', y: '-50%' }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-sand harsh-border rounded-sm z-[71] w-[85vw] max-w-sm p-5"
            >
              <h3 className="font-display text-lg text-ink uppercase mb-2">Move products first</h3>
              <p className="text-sm text-ink mb-4">
                {reassignFrom.count} product{reassignFrom.count === 1 ? '' : 's'} still use "{reassignFrom.name}". Choose where to move them before deleting it.
              </p>
              <select
                value={reassignTo}
                onChange={(e) => setReassignTo(e.target.value)}
                className="w-full h-11 px-3 bg-light harsh-border rounded-sm text-sm mb-4"
              >
                {state.categories.filter((c) => c.id !== reassignFrom.id).map((c) => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))}
              </select>
              <div className="flex gap-3">
                <button onClick={() => setReassignFrom(null)} className="flex-1 h-10 bg-warm-gray rounded-sm font-display text-xs uppercase">Cancel</button>
                <button
                  onClick={async () => {
                    if (!reassignTo) return
                    await reassignAndDeleteCategory(reassignFrom.id, reassignFrom.name, reassignTo)
                    setReassignFrom(null)
                  }}
                  className="flex-1 h-10 bg-accent-red text-white rounded-sm font-display text-xs uppercase flex items-center justify-center gap-1.5"
                >
                  <Trash2 size={12} /> Move & Delete
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
