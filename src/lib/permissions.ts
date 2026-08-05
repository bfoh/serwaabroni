// Pure RBAC matrix — single source of truth for role-gated UI decisions.
// Mirrors docs/superpowers/specs/2026-08-03-staff-rbac-design.md §5. The actual
// enforcement lives in Postgres RLS (migrations 023-027); this only decides
// what the UI shows/hides so users aren't shown actions the DB will reject.
export type Role = 'owner' | 'manager' | 'staff'

export type PermissionArea =
  | 'sales'
  | 'stockView'
  | 'stockEdit'
  | 'customersDebts'
  | 'voiceAgent'
  | 'expenses'
  | 'reports'
  | 'cashFlow'
  | 'capital'
  | 'staffManage'
  | 'costPrice'

const MATRIX: Record<PermissionArea, Record<Role, boolean>> = {
  sales:          { owner: true, manager: true, staff: true },
  stockView:      { owner: true, manager: true, staff: true },
  stockEdit:      { owner: true, manager: true, staff: true },
  customersDebts: { owner: true, manager: true, staff: true },
  voiceAgent:     { owner: true, manager: true, staff: true },
  expenses:       { owner: true, manager: true, staff: false },
  reports:        { owner: true, manager: true, staff: false },
  cashFlow:       { owner: true, manager: false, staff: false },
  capital:        { owner: true, manager: false, staff: false },
  staffManage:    { owner: true, manager: false, staff: false },
  costPrice:      { owner: true, manager: true, staff: false },
}

export function canView(role: Role | null | undefined, area: PermissionArea): boolean {
  if (!role) return false
  return MATRIX[area][role]
}

export type SettingsAccess = 'edit' | 'view' | 'none'

// Business settings: Owner edits, Manager views only, Staff has no access at all.
export function settingsAccessFor(role: Role | null | undefined): SettingsAccess {
  if (role === 'owner') return 'edit'
  if (role === 'manager') return 'view'
  return 'none'
}

// BottomNav shows the Reports tab only to roles allowed to view it.
export function visibleMainTabKeys(role: Role | null | undefined): Array<'home' | 'stock' | 'debts' | 'reports'> {
  const tabs: Array<'home' | 'stock' | 'debts' | 'reports'> = ['home', 'stock', 'debts']
  if (canView(role, 'reports')) tabs.push('reports')
  return tabs
}
