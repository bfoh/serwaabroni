import { useRef, useState } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useStore } from '@/lib/store'
import { postMovement, type NewMovement } from '@/services/cashApi'
import { parseCSV } from '@/lib/bulkImport/csv'
import { downloadSalesTemplate } from '@/lib/bulkSales/template'
import { rowsFromMatrix, normalizeSaleRow, matchSaleRow, type SaleRawRow, type SaleDraftRow } from '@/lib/bulkSales/rows'
import { saveBulkSales, type BulkSalesApi } from '@/lib/bulkSales/save'
import BulkSalesReviewTable from './BulkSalesReviewTable'

export default function BulkSalesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, addSaleBatch, addDebt, showToast } = useStore()
  const [rows, setRows] = useState<SaleDraftRow[]>([])
  const [importing, setImporting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const loadRaws = (raws: SaleRawRow[]) => {
    setRows(raws.map((r) => matchSaleRow(normalizeSaleRow(r), state.products)))
    if (raws.length === 0) showToast('No rows found', 'error')
  }

  const onFile = async (file: File) => {
    const text = await file.text()
    loadRaws(rowsFromMatrix(parseCSV(text)))
  }

  const onImport = async () => {
    setImporting(true)
    const api: BulkSalesApi = {
      addSaleBatch: addSaleBatch as BulkSalesApi['addSaleBatch'],
      addDebt: addDebt as BulkSalesApi['addDebt'],
      // Cast at the boundary: category is always 'sale' (a valid CashCategory).
      postMovement: (mv) => postMovement(mv as NewMovement),
    }
    try {
      const res = await saveBulkSales(rows, state.products, api)
      showToast(`Recorded ${res.recorded}${res.debts ? `, ${res.debts} on credit` : ''}${res.failed ? `, ${res.failed} skipped` : ''}`, res.failed ? 'error' : 'success')
      if (res.failed === 0) {
        setRows([])
        onClose()
      }
    } finally {
      setImporting(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="rounded-t-2xl h-[90vh] flex flex-col">
        <SheetHeader><SheetTitle>Bulk add sales</SheetTitle></SheetHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-3">
          <div className="flex flex-wrap gap-2">
            <button onClick={downloadSalesTemplate} className="btn-tactile border-2 border-ink bg-white text-xs uppercase tracking-wide px-3 py-2 rounded-sm">
              Download template
            </button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = '' }} />
            <button onClick={() => fileRef.current?.click()} className="btn-tactile border-2 border-ink bg-white text-xs uppercase tracking-wide px-3 py-2 rounded-sm">
              Upload filled CSV
            </button>
          </div>

          {rows.length > 0 ? (
            <BulkSalesReviewTable rows={rows} products={state.products} onChange={setRows} onImport={onImport} importing={importing} />
          ) : (
            <p className="text-sm text-muted-text text-center py-8">
              Download the template, fill it from your sales book, then upload it here. Each row is matched to a
              product; set the payment and the date the sale happened. Blank date = today.
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
