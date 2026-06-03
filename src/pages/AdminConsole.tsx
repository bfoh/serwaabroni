import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { ArrowLeft, Search, Shield, Ban, Trash2, Eye, Loader2 } from 'lucide-react'
import { formatCurrency } from '@/lib/data'
import { useStore } from '@/lib/store'
import {
  getPlatformSummary, listTenants, setTenantStatus, deleteTenant, getTenantDetail,
  type PlatformSummary, type TenantRow, type TenantDetail,
} from '@/services/adminApi'

// Turn a Supabase/Postgres error into a human message. A missing RPC (un-migrated
// DB) surfaces as a 404 / "Could not find function" — call that out specifically.
function adminErr(e: unknown, fallback: string): string {
  const msg = (e as { message?: string })?.message ?? ''
  if (/function|does not exist|not find|schema cache|404/i.test(msg)) {
    return 'Admin database functions not found. Run migration_005 in Supabase.'
  }
  if (/forbidden/i.test(msg)) return 'Not authorized — your account is not a super admin.'
  return msg || fallback
}

export default function AdminConsole() {
  const navigate = useNavigate()
  const { showToast } = useStore()
  const [summary, setSummary] = useState<PlatformSummary | null>(null)
  const [tenants, setTenants] = useState<TenantRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<TenantRow | null>(null)
  const [deleteText, setDeleteText] = useState('')
  const [drill, setDrill] = useState<{ tenant: TenantRow; detail: TenantDetail } | null>(null)

  async function load() {
    setLoading(true)
    try {
      const [s, t] = await Promise.all([getPlatformSummary(), listTenants()])
      setSummary(s)
      setTenants(t)
    } catch (e) {
      showToast(adminErr(e, 'Failed to load tenants'), 'error')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const filtered = tenants.filter((t) =>
    t.business_name.toLowerCase().includes(search.toLowerCase()) ||
    t.email.toLowerCase().includes(search.toLowerCase()))

  async function toggleSuspend(t: TenantRow) {
    const next = t.status === 'suspended' ? 'active' : 'suspended'
    const reason = next === 'suspended'
      ? (window.prompt('Reason for suspension?') ?? '') : ''
    if (next === 'suspended' && reason === '') return
    setBusyId(t.user_id)
    try { await setTenantStatus(t.user_id, next, reason); await load(); showToast(`Tenant ${next === 'suspended' ? 'suspended' : 'reactivated'}`, 'success') }
    catch (e) { showToast(adminErr(e, 'Failed to update tenant'), 'error') }
    finally { setBusyId(null) }
  }

  async function doDelete() {
    if (!confirmDelete) return
    setBusyId(confirmDelete.user_id)
    try { await deleteTenant(confirmDelete.user_id); await load(); showToast('Tenant deleted', 'success') }
    catch (e) { showToast(adminErr(e, 'Failed to delete tenant'), 'error') }
    finally { setBusyId(null); setConfirmDelete(null); setDeleteText('') }
  }

  async function openDrill(t: TenantRow) {
    setBusyId(t.user_id)
    try { setDrill({ tenant: t, detail: await getTenantDetail(t.user_id) }) }
    catch (e) { showToast(adminErr(e, 'Failed to load tenant'), 'error') }
    finally { setBusyId(null) }
  }

  if (drill) {
    return (
      <div className="h-full w-full overflow-y-auto bg-sand p-4">
        <button onClick={() => setDrill(null)}
          className="btn-tactile inline-flex items-center gap-1 text-xs text-muted-text mb-3">
          <ArrowLeft size={14} /> Back to tenants
        </button>
        <div className="rounded-sm border-2 border-accent-amber bg-accent-amber/10 px-3 py-2 mb-4">
          <p className="text-xs uppercase font-display text-ink">
            Viewing {drill.tenant.business_name} — read-only (admin)
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 mb-4">
          <Stat label="Sales" value={formatCurrency(drill.detail.totalSales)} />
          <Stat label="Profit" value={formatCurrency(drill.detail.totalProfit)} />
          <Stat label="Expenses" value={formatCurrency(drill.detail.totalExpenses)} />
        </div>
        <h2 className="font-display text-sm uppercase text-ink mb-2">Recent sales</h2>
        <div className="space-y-1">
          {drill.detail.sales.slice(0, 30).map((s) => (
            <div key={s.id} className="flex justify-between text-sm border-b border-ink/10 py-1">
              <span className="text-ink truncate">{s.product_name}</span>
              <span className="font-display text-ink">{formatCurrency(s.total)}</span>
            </div>
          ))}
          {drill.detail.sales.length === 0 && (
            <p className="text-sm text-muted-text">No sales.</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="h-full w-full overflow-y-auto bg-sand p-4 pb-24">
      <div className="flex items-center gap-2 mb-4">
        <button onClick={() => navigate('/')}
          className="btn-tactile w-9 h-9 flex items-center justify-center rounded-sm bg-warm-gray">
          <ArrowLeft size={16} />
        </button>
        <Shield size={18} className="text-ink" />
        <h1 className="font-display text-lg uppercase tracking-tight text-ink">Super Admin</h1>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin text-ink" /></div>
      ) : (
        <>
          {summary && (
            <div className="grid grid-cols-2 gap-2 mb-4">
              <Stat label="Tenants" value={String(summary.tenant_count)} />
              <Stat label="Suspended" value={String(summary.suspended_count)} />
              <Stat label="Gross revenue" value={formatCurrency(summary.gross_revenue)} />
              <Stat label="Total profit" value={formatCurrency(summary.total_profit)} />
            </div>
          )}

          <div className="relative mb-3">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-text" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search shop or email"
              className="w-full h-10 pl-9 pr-3 bg-white border-2 border-ink rounded-sm text-sm" />
          </div>

          <div className="space-y-2">
            {filtered.map((t) => (
              <div key={t.user_id} className="border-2 border-ink rounded-sm bg-white p-3">
                <div className="flex items-start justify-between">
                  <div className="min-w-0">
                    <p className="font-display text-sm text-ink truncate">{t.business_name}</p>
                    <p className="text-xs text-muted-text truncate">{t.email}</p>
                    <p className="text-xs text-muted-text mt-1">
                      {formatCurrency(t.total_sales)} sales · {t.sale_count} orders
                    </p>
                  </div>
                  <span className={`text-[10px] font-display uppercase px-2 py-0.5 rounded-sm ${
                    t.status === 'suspended'
                      ? 'bg-accent-red/15 text-accent-red'
                      : 'bg-accent-green/15 text-accent-green'}`}>
                    {t.status}
                  </span>
                </div>
                <div className="flex gap-2 mt-3">
                  <button onClick={() => openDrill(t)} disabled={busyId === t.user_id}
                    className="btn-tactile flex-1 h-8 bg-warm-gray rounded-sm text-xs flex items-center justify-center gap-1">
                    <Eye size={13} /> View
                  </button>
                  <button onClick={() => toggleSuspend(t)} disabled={busyId === t.user_id}
                    className="btn-tactile flex-1 h-8 bg-accent-amber/20 rounded-sm text-xs flex items-center justify-center gap-1">
                    <Ban size={13} /> {t.status === 'suspended' ? 'Unsuspend' : 'Suspend'}
                  </button>
                  <button onClick={() => { setConfirmDelete(t); setDeleteText('') }} disabled={busyId === t.user_id}
                    className="btn-tactile h-8 px-3 bg-accent-red/15 text-accent-red rounded-sm text-xs flex items-center justify-center">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
            {filtered.length === 0 && <p className="text-sm text-muted-text text-center py-8">No tenants.</p>}
          </div>
        </>
      )}

      {confirmDelete && (
        <>
          <div className="fixed inset-0 bg-black/50 z-[60]" onClick={() => setConfirmDelete(null)} />
          <div className="fixed inset-x-4 top-1/3 z-[61] bg-sand border-2 border-ink rounded-sm p-4">
            <h3 className="font-display text-lg uppercase text-ink">Delete tenant?</h3>
            <p className="text-sm text-muted-text mt-1">
              Permanently deletes <b>{confirmDelete.business_name}</b> and ALL its data. This cannot be undone.
            </p>
            <p className="text-xs text-muted-text mt-2">Type the shop name to confirm:</p>
            <input value={deleteText} onChange={(e) => setDeleteText(e.target.value)}
              className="w-full h-10 mt-1 px-3 bg-white border-2 border-ink rounded-sm text-sm" />
            <div className="flex gap-2 mt-3">
              <button onClick={() => setConfirmDelete(null)}
                className="btn-tactile flex-1 h-10 bg-warm-gray rounded-sm font-display text-xs uppercase">Cancel</button>
              <button onClick={doDelete}
                disabled={deleteText !== confirmDelete.business_name || busyId === confirmDelete.user_id}
                className="btn-tactile flex-1 h-10 bg-accent-red text-white rounded-sm font-display text-xs uppercase disabled:opacity-40 flex items-center justify-center gap-1">
                <Trash2 size={12} /> Delete
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-2 border-ink rounded-sm bg-white p-3">
      <p className="text-[10px] uppercase text-muted-text">{label}</p>
      <p className="font-display text-base text-ink mt-0.5">{value}</p>
    </div>
  )
}
