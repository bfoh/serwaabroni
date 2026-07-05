import { useRef, useState } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useStore } from '@/lib/store'
import { receiveStock } from '@/services/batchApi'
import { parseCSV } from '@/lib/bulkImport/csv'
import { downloadTemplate } from '@/lib/bulkImport/template'
import { rowsFromMatrix, normalizeRow, type DraftRow } from '@/lib/bulkImport/rows'
import { saveBulkRows, type CashMode, type BulkSaveApi } from '@/lib/bulkImport/save'
import BulkReviewTable from './BulkReviewTable'

export default function BulkAddSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, addProduct, updateProduct, addDebt, showToast } = useStore()
  const [rows, setRows] = useState<DraftRow[]>([])
  const [importing, setImporting] = useState(false)
  const [modeKind, setModeKind] = useState<'opening' | 'purchase' | 'supplier_credit'>('opening')
  const [account, setAccount] = useState<'cash' | 'bank'>('cash')
  const [supplierName, setSupplierName] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const onFile = async (file: File) => {
    const text = await file.text()
    const raws = rowsFromMatrix(parseCSV(text))
    setRows(raws.map(normalizeRow))
    if (raws.length === 0) showToast('No rows found in that file', 'error')
  }

  const buildMode = (): CashMode | null => {
    if (modeKind === 'opening') return { kind: 'opening' }
    if (modeKind === 'purchase') return { kind: 'purchase', account }
    if (!supplierName.trim()) {
      showToast('Supplier name required for supplier credit', 'error')
      return null
    }
    return { kind: 'supplier_credit', supplierName: supplierName.trim(), supplierPhone: null }
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

          {rows.length > 0 && (
            <>
              <div className="bg-warm-gray/40 rounded-sm p-3 space-y-2">
                <p className="text-micro text-muted-text">This stock is…</p>
                <div className="flex flex-wrap gap-2">
                  {([['opening', 'Already mine (opening)'], ['purchase', 'A purchase'], ['supplier_credit', 'Supplier credit']] as const).map(([k, lbl]) => (
                    <button key={k} onClick={() => setModeKind(k)}
                      className={`text-xs px-3 py-1.5 rounded-sm border-2 border-ink ${modeKind === k ? 'bg-ink text-white' : 'bg-white'}`}>
                      {lbl}
                    </button>
                  ))}
                </div>
                {modeKind === 'purchase' && (
                  <div className="flex gap-2">
                    {(['cash', 'bank'] as const).map((a) => (
                      <button key={a} onClick={() => setAccount(a)}
                        className={`text-xs px-3 py-1.5 rounded-sm border-2 border-ink ${account === a ? 'bg-ink text-white' : 'bg-white'}`}>
                        {a === 'cash' ? 'Paid cash' : 'Paid bank'}
                      </button>
                    ))}
                  </div>
                )}
                {modeKind === 'supplier_credit' && (
                  <input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder="Supplier name"
                    className="w-full harsh-border rounded-sm px-3 py-2 text-sm" />
                )}
              </div>

              <BulkReviewTable rows={rows} products={state.products} onChange={setRows} onImport={onImport} importing={importing} />
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
