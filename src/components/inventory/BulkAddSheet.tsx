import { useEffect, useRef, useState } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useStore } from '@/lib/store'
import { receiveStock } from '@/services/batchApi'
import { parseCSV } from '@/lib/bulkImport/csv'
import { downloadTemplate } from '@/lib/bulkImport/template'
import { rowsFromMatrix, normalizeRow, type DraftRow } from '@/lib/bulkImport/rows'
import { saveBulkRows, type CashMode, type BulkSaveApi } from '@/lib/bulkImport/save'
import { extractRowsFromImage } from '@/lib/bulkImport/vision'
import { templateForIndustry } from '@/lib/categories'
import BulkReviewTable from './BulkReviewTable'

export default function BulkAddSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, addProduct, updateProduct, addDebt, showToast } = useStore()
  const [rows, setRows] = useState<DraftRow[]>([])
  const [importing, setImporting] = useState(false)
  const [stockKind, setStockKind] = useState<'opening' | 'new'>('opening')
  const [injectionId, setInjectionId] = useState('')
  const [payKind, setPayKind] = useState<'cash' | 'bank' | 'unpaid'>('cash')
  const [supplierName, setSupplierName] = useState('')
  const [injections, setInjections] = useState<{ id: string; label: string }[]>([])
  const [tab, setTab] = useState<'template' | 'photo'>('template')
  const [reading, setReading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const photoRef = useRef<HTMLInputElement>(null)

  // Load active capital injections so a purchase can be tagged to its funding.
  useEffect(() => {
    if (!open) return
    import('@/services/capitalApi').then(({ fetchInjections }) =>
      fetchInjections()
        .then((list) =>
          setInjections(
            list.filter((i) => i.status !== 'repaid').map((i) => ({ id: i.id, label: i.lender_name || i.source })),
          ),
        )
        .catch(() => {}),
    )
  }, [open])

  const onFile = async (file: File) => {
    const text = await file.text()
    const raws = rowsFromMatrix(parseCSV(text))
    setRows(raws.map(normalizeRow))
    if (raws.length === 0) showToast('No rows found in that file', 'error')
  }

  const onPhoto = async (file: File) => {
    setReading(true)
    try {
      const raws = await extractRowsFromImage(file)
      setRows(raws.map(normalizeRow))
      if (raws.length === 0) showToast('No products found in the photo', 'error')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not read the photo', 'error')
    } finally {
      setReading(false)
    }
  }

  const buildMode = (): CashMode | null => {
    if (stockKind === 'opening') return { kind: 'opening' }
    if (payKind === 'unpaid') {
      if (!supplierName.trim()) {
        showToast('Supplier name required for supplier credit', 'error')
        return null
      }
      return { kind: 'supplier_credit', supplierName: supplierName.trim(), supplierPhone: null }
    }
    return { kind: 'purchase', account: payKind, injectionId: injectionId || null }
  }

  const onImport = async () => {
    const mode = buildMode()
    if (!mode) return
    setImporting(true)
    const api: BulkSaveApi = {
      addProduct: addProduct as BulkSaveApi['addProduct'],
      updateProduct: updateProduct as BulkSaveApi['updateProduct'],
      receiveStock,
      addDebt: addDebt as BulkSaveApi['addDebt'],
      findQty: (id) => state.products.find((p) => p.id === id)?.quantity ?? 0,
    }
    try {
      const res = await saveBulkRows(rows, state.products, mode, api)
      showToast(`Added ${res.added}, restocked ${res.restocked}${res.failed ? `, ${res.failed} failed` : ''}`, res.failed ? 'error' : 'success')
      if (res.failed === 0) {
        setRows([])
        onClose()
      } else {
        // Keep only the failed rows for retry.
        const failedNames = new Set(res.failures.map((f) => f.name))
        setRows((rs) => rs.filter((r) => failedNames.has(r.name)))
      }
    } finally {
      setImporting(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="rounded-t-2xl h-[90vh] flex flex-col">
        <SheetHeader><SheetTitle>Bulk add stock</SheetTitle></SheetHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-3">
          <div className="flex bg-warm-gray rounded-sm p-1">
            {(['template', 'photo'] as const).map((tk) => (
              <button key={tk} onClick={() => setTab(tk)}
                className={`flex-1 py-2 text-xs uppercase tracking-wide rounded-sm ${tab === tk ? 'bg-ink text-white' : 'text-ink'}`}>
                {tk === 'template' ? 'Template' : 'Photo'}
              </button>
            ))}
          </div>

          {tab === 'template' && (
            <div className="flex flex-wrap gap-2">
              <button onClick={downloadTemplate} className="btn-tactile border-2 border-ink bg-white text-xs uppercase tracking-wide px-3 py-2 rounded-sm">
                Download template
              </button>
              <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = '' }} />
              <button onClick={() => fileRef.current?.click()} className="btn-tactile border-2 border-ink bg-white text-xs uppercase tracking-wide px-3 py-2 rounded-sm">
                Upload filled CSV
              </button>
            </div>
          )}

          {tab === 'photo' && (
            <div className="flex flex-col items-start gap-2">
              <input ref={photoRef} type="file" accept="image/*" capture="environment" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void onPhoto(f); e.target.value = '' }} />
              <button onClick={() => photoRef.current?.click()} disabled={reading}
                className="btn-tactile border-2 border-ink bg-white text-xs uppercase tracking-wide px-3 py-2 rounded-sm disabled:opacity-50">
                {reading ? 'Reading photo…' : 'Take / upload photo'}
              </button>
              <p className="text-[11px] text-muted-text">Photograph a clear stock list (typed or handwritten). Review the result before importing.</p>
            </div>
          )}

          {rows.length > 0 && (
            <>
              <div className="bg-warm-gray/40 rounded-sm p-3 space-y-3">
                <div>
                  <p className="text-micro text-muted-text mb-1.5">This stock is…</p>
                  <div className="grid grid-cols-2 gap-2">
                    {([['opening', 'Already mine'], ['new', 'New stock']] as const).map(([k, lbl]) => (
                      <button key={k} onClick={() => setStockKind(k)}
                        className={`py-2 text-xs uppercase tracking-wide rounded-sm border-2 border-ink ${stockKind === k ? 'bg-ink text-white' : 'bg-white'}`}>
                        {lbl}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-text mt-1">
                    {stockKind === 'opening' ? 'Recording stock you already own — no cash is deducted.' : 'New stock bought — this posts the cost to your books.'}
                  </p>
                </div>

                {stockKind === 'new' && (
                  <>
                    <div>
                      <label className="text-micro text-muted-text mb-1.5 block">BOUGHT WITH CAPITAL</label>
                      <select value={injectionId}
                        onChange={(e) => { setInjectionId(e.target.value); if (e.target.value && payKind === 'unpaid') setPayKind('cash') }}
                        className="w-full harsh-border rounded-sm px-3 py-2 text-sm">
                        <option value="">Not funded by tracked capital</option>
                        {injections.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-micro text-muted-text mb-1.5 block">PAID FOR WITH</label>
                      <div className="grid grid-cols-2 gap-2">
                        {(['cash', 'bank'] as const).map((a) => (
                          <button key={a} onClick={() => setPayKind(a)}
                            className={`py-2 text-xs uppercase tracking-wide rounded-sm border-2 border-ink ${payKind === a ? 'bg-ink text-white' : 'bg-white'}`}>
                            {a === 'cash' ? 'Paid cash' : 'Paid bank'}
                          </button>
                        ))}
                      </div>
                      {!injectionId && (
                        <button onClick={() => setPayKind((p) => (p === 'unpaid' ? 'cash' : 'unpaid'))}
                          className={`mt-2 w-full py-2 text-xs uppercase tracking-wide rounded-sm border-2 border-ink ${payKind === 'unpaid' ? 'bg-ink text-white' : 'bg-white'}`}>
                          {payKind === 'unpaid' ? '✓ Unpaid (supplier credit)' : 'Unpaid (supplier credit)'}
                        </button>
                      )}
                      {payKind === 'unpaid' && !injectionId && (
                        <input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder="Supplier name (required)"
                          className="mt-2 w-full harsh-border rounded-sm px-3 py-2 text-sm" />
                      )}
                    </div>
                  </>
                )}
              </div>

              <BulkReviewTable
                rows={rows}
                products={state.products}
                categories={state.categories.length > 0 ? state.categories.map((c) => c.name) : templateForIndustry('Supermarket').map((c) => c.name)}
                onChange={setRows}
                onImport={onImport}
                importing={importing}
              />
            </>
          )}

          {rows.length === 0 && (
            <p className="text-sm text-muted-text text-center py-8">
              Download the template, fill it in a spreadsheet, then upload it here to review and import.
              For pack goods (e.g. a box of 40 sachets), set Pack Unit and Units Per Pack and enter the
              quantity and prices per box.
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
