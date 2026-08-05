// Pure decision logic shared by every service that needs to scope a query by
// the caller's TENANT (business) rather than their raw auth uid — required so
// an active Manager/Staff account (whose own uid differs from the owner's)
// reads/writes the owner's rows instead of an empty bucket under their own id.
// See docs/superpowers/specs/2026-08-03-staff-rbac-design.md §3.
export function resolveScopeId(
  authUid: string | null,
  rpcBusinessId: string | null,
  rpcError: boolean,
): string | null {
  if (!authUid) return null
  if (rpcError || !rpcBusinessId) return authUid
  return rpcBusinessId
}
