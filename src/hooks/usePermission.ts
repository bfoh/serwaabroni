import { useStore } from '@/lib/store'
import { canView as canViewFor, settingsAccessFor, type PermissionArea, type SettingsAccess } from '@/lib/permissions'

export function usePermission() {
  const { state } = useStore()
  const role = state.role
  return {
    role,
    isOwner: role === 'owner',
    isManager: role === 'manager',
    isStaff: role === 'staff',
    canView: (area: PermissionArea) => canViewFor(role, area),
    settingsAccess: settingsAccessFor(role) as SettingsAccess,
  }
}
