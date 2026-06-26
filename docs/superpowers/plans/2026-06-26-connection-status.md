# Connection & Sync Status Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the shop owner when she is online/offline and how many changes are still waiting to sync.

**Architecture:** A pure `connectionStatus()` mapping holds all text/variant logic and is unit-tested. The store gains a reactive `pendingSync` count sourced from the existing offline queue. A thin `ConnectionBar` component reads `isOnline` + `pendingSync` from the store, tracks a local reconnect `phase`, and renders the mapping. No new polling or timers beyond one reconnect-confirmation timeout.

**Tech Stack:** React + TypeScript, Vite, Vitest (node env), framer-motion, Tailwind. Existing store is a `useReducer` context in `src/lib/store.tsx`.

## Global Constraints

- Currency/locale, palette: reuse existing Tailwind tokens — `accent-red` (offline), `accent-green` (synced), amber tone `#d97706`/`amber-600` (syncing). Use `harsh-border rounded-sm` to match `Toast`.
- Pure logic lives in `src/lib/*.ts` with a colocated `*.test.ts` (node env, no DOM). Components and store wiring are not unit-tested in this codebase — verify them with `npx tsc -b` + `npx vite build`.
- Pluralisation: exactly `1 change`, otherwise `N changes`.
- No new dependencies.

---

### Task 1: `connectionStatus()` pure mapping + tests

**Files:**
- Create: `src/lib/connectionStatus.ts`
- Test: `src/lib/connectionStatus.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export type ConnVariant = 'hidden' | 'offline' | 'syncing' | 'synced'
  export interface ConnStatus { variant: ConnVariant; text: string }
  export function connectionStatus(isOnline: boolean, pending: number, phase: 'idle' | 'reconnected'): ConnStatus
  ```

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/connectionStatus.test.ts
import { describe, it, expect } from 'vitest'
import { connectionStatus } from './connectionStatus'

describe('connectionStatus', () => {
  it('is hidden when online, idle, nothing pending', () => {
    expect(connectionStatus(true, 0, 'idle')).toEqual({ variant: 'hidden', text: '' })
  })

  it('shows offline with no count when queue empty', () => {
    expect(connectionStatus(false, 0, 'idle')).toEqual({ variant: 'offline', text: 'Offline' })
  })

  it('shows offline with singular count', () => {
    expect(connectionStatus(false, 1, 'idle')).toEqual({
      variant: 'offline', text: 'Offline — 1 change will sync when reconnected',
    })
  })

  it('shows offline with plural count', () => {
    expect(connectionStatus(false, 3, 'idle')).toEqual({
      variant: 'offline', text: 'Offline — 3 changes will sync when reconnected',
    })
  })

  it('offline takes priority over a reconnected phase', () => {
    expect(connectionStatus(false, 2, 'reconnected').variant).toBe('offline')
  })

  it('shows syncing when reconnected with pending work', () => {
    expect(connectionStatus(true, 2, 'reconnected')).toEqual({
      variant: 'syncing', text: 'Back online — syncing 2…',
    })
  })

  it('shows synced confirmation when reconnected and queue drained', () => {
    expect(connectionStatus(true, 0, 'reconnected')).toEqual({
      variant: 'synced', text: 'All changes synced',
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/connectionStatus.test.ts`
Expected: FAIL — `connectionStatus` is not defined / module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/connectionStatus.ts
export type ConnVariant = 'hidden' | 'offline' | 'syncing' | 'synced'

export interface ConnStatus {
  variant: ConnVariant
  text: string
}

const changes = (n: number) => `${n} ${n === 1 ? 'change' : 'changes'}`

// Map raw connectivity + queue depth + reconnect phase to what the bar shows.
// Offline always wins; 'reconnected' is a short-lived phase the component sets
// when the network flips back so we can show a sync/confirmation message.
export function connectionStatus(
  isOnline: boolean,
  pending: number,
  phase: 'idle' | 'reconnected',
): ConnStatus {
  if (!isOnline) {
    return {
      variant: 'offline',
      text: pending > 0 ? `Offline — ${changes(pending)} will sync when reconnected` : 'Offline',
    }
  }
  if (phase === 'reconnected') {
    return pending > 0
      ? { variant: 'syncing', text: `Back online — syncing ${pending}…` }
      : { variant: 'synced', text: 'All changes synced' }
  }
  return { variant: 'hidden', text: '' }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/connectionStatus.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/connectionStatus.ts src/lib/connectionStatus.test.ts
git commit -m "feat: connectionStatus pure mapping for online/offline bar"
```

---

### Task 2: `pendingSync` count wired through store

**Files:**
- Modify: `src/services/offline.ts` (add `getQueueLength`)
- Modify: `src/lib/store.tsx` (state field, action, reducer case, `syncPending()` calls)

**Interfaces:**
- Consumes: `getQueue()` from `offline.ts` (already exported).
- Produces:
  - `offline.ts`: `export function getQueueLength(): number`
  - `store.tsx` `AppState`: new field `pendingSync: number`
  - `store.tsx` `Action`: new `{ type: 'SET_PENDING_SYNC'; value: number }`

- [ ] **Step 1: Add `getQueueLength` to `offline.ts`**

Add immediately after the `getQueue` function:

```ts
// Number of writes still waiting to reach the server. Drives the sync indicator.
export function getQueueLength(): number {
  return getQueue().length
}
```

- [ ] **Step 2: Add `pendingSync` to store state + action**

In `src/lib/store.tsx`:

Import — extend the existing offline import to include `getQueueLength`:

```ts
import { cacheOfflineData, queueOperation, syncQueue, getQueue, getQueueLength, mergeDebts, setupAutoSync } from '@/services/offline'
```

In `interface AppState`, add after `isOnline: boolean`:

```ts
  pendingSync: number
```

In the `Action` union, add after the `SET_ONLINE` line:

```ts
  | { type: 'SET_PENDING_SYNC'; value: number }
```

In `initialState`, add after `isOnline: navigator.onLine,`:

```ts
  pendingSync: 0,
```

In `appReducer`, add after the `SET_ONLINE` case:

```ts
    case 'SET_PENDING_SYNC': return { ...state, pendingSync: action.value }
```

- [ ] **Step 3: Recompute `pendingSync` wherever the queue changes**

In `StoreProvider`, just below `const t = useCallback(...)` (before `refreshData`), add a stable helper:

```ts
  const syncPending = useCallback(() => {
    dispatch({ type: 'SET_PENDING_SYNC', value: getQueueLength() })
  }, [])
```

In `refreshData`, immediately after the `try { await syncQueue() } catch {...}` block, add:

```ts
        syncPending()
```

In the three debt CRUD catch branches, add `syncPending()` right after each `queueOperation('debts', ...)` call:
- `addDebt` catch — after `queueOperation('debts', 'insert', { ...debt })`
- `updateDebt` catch — after `queueOperation('debts', 'update', { id, ...updates })`
- `removeDebt` offline branch — after `queueOperation('debts', 'delete', { id })`

In the `setupAutoSync` effect callback, change it to refresh the count too:

```ts
    const teardown = setupAutoSync((result) => {
      syncPending()
      if (result.success > 0) refreshData()
    })
```

Add `syncPending` to that effect's dependency array: `[state.isAuthenticated, refreshData, syncPending]`.

Also call `syncPending()` once on mount: add a line `syncPending()` inside the existing "Load data after auth" effect's `if (state.isAuthenticated)` branch, right before `refreshData()`.

- [ ] **Step 4: Verify it compiles and builds**

Run: `npx tsc -b`
Expected: no errors.

Run: `npx vitest run`
Expected: all tests pass (Task 1 tests included).

- [ ] **Step 5: Commit**

```bash
git add src/services/offline.ts src/lib/store.tsx
git commit -m "feat: track pending-sync count in store from offline queue"
```

---

### Task 3: `ConnectionBar` component rendered globally

**Files:**
- Create: `src/components/ConnectionBar.tsx`
- Modify: `src/App.tsx` (render `<ConnectionBar />`)

**Interfaces:**
- Consumes: `useStore()` → `state.isOnline`, `state.pendingSync`; `connectionStatus()` from `src/lib/connectionStatus.ts`.
- Produces: default-exported `ConnectionBar` React component.

- [ ] **Step 1: Create the component**

```tsx
// src/components/ConnectionBar.tsx
import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { WifiOff, RefreshCw, CheckCircle } from 'lucide-react'
import { useStore } from '@/lib/store'
import { connectionStatus, type ConnVariant } from '@/lib/connectionStatus'

const VARIANT_STYLE: Record<Exclude<ConnVariant, 'hidden'>, string> = {
  offline: 'bg-accent-red text-white',
  syncing: 'bg-amber-600 text-white',
  synced: 'bg-accent-green text-white',
}

export default function ConnectionBar() {
  const { state } = useStore()
  const { isOnline, pendingSync } = state
  const [phase, setPhase] = useState<'idle' | 'reconnected'>('idle')
  const prevOnline = useRef(isOnline)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // When the network flips offline->online, enter the 'reconnected' phase so the
  // bar shows "syncing"/"synced", then drop back to idle (which hides it).
  useEffect(() => {
    const clear = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null } }
    if (!prevOnline.current && isOnline) {
      setPhase('reconnected')
    }
    if (!isOnline) {
      clear()
      setPhase('idle') // offline variant doesn't depend on phase
    }
    prevOnline.current = isOnline
    return clear
  }, [isOnline])

  // Once reconnected and the queue is drained, show the confirmation briefly
  // then return to idle so the bar auto-hides.
  useEffect(() => {
    if (phase === 'reconnected' && isOnline && pendingSync === 0) {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setPhase('idle'), 2000)
    }
    return () => { if (timer.current) { clearTimeout(timer.current); timer.current = null } }
  }, [phase, isOnline, pendingSync])

  const { variant, text } = connectionStatus(isOnline, pendingSync, phase)

  return (
    <AnimatePresence>
      {variant !== 'hidden' && (
        <motion.div
          initial={{ opacity: 0, y: -40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -40 }}
          transition={{ duration: 0.2 }}
          className={`fixed top-0 left-0 right-0 z-[80] flex items-center justify-center gap-2 px-4 py-1.5 pt-safe text-xs font-medium font-body ${VARIANT_STYLE[variant]}`}
        >
          {variant === 'offline' && <WifiOff size={14} strokeWidth={2.5} />}
          {variant === 'syncing' && <RefreshCw size={14} strokeWidth={2.5} className="animate-spin" />}
          {variant === 'synced' && <CheckCircle size={14} strokeWidth={2.5} />}
          <span>{text}</span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
```

- [ ] **Step 2: Render it in `App.tsx`**

In `src/App.tsx`, add the import near the other component imports (next to `import Toast from '@/components/Toast'`):

```ts
import ConnectionBar from '@/components/ConnectionBar'
```

In the returned JSX, add `<ConnectionBar />` immediately before `<Toast />` (line ~159):

```tsx
      <ConnectionBar />
      <Toast />
```

- [ ] **Step 3: Verify it compiles and builds**

Run: `npx tsc -b`
Expected: no errors.

Run: `npx vite build`
Expected: build succeeds.

- [ ] **Step 4: Manual smoke (optional)**

Run `npm run dev`, open the app, then in browser DevTools toggle **Network → Offline**: a red "Offline" bar appears at top. Toggle back online: amber "syncing"/green "synced" then auto-hide. (Full pending-count behaviour needs a working backend; the count logic is covered by Task 1 tests.)

- [ ] **Step 5: Commit**

```bash
git add src/components/ConnectionBar.tsx src/App.tsx
git commit -m "feat: global connection/sync status bar"
```

---

## Self-Review

- **Spec coverage:** offline/online/syncing/synced states → Task 1 `connectionStatus` + Task 3 render; pending count → Task 2 store wiring; reuse of `isOnline` + queue → Tasks 2/3; pure-logic testing → Task 1; component/store verified by build → Tasks 2/3. All spec sections mapped.
- **Placeholder scan:** no TBD/TODO; all code shown in full.
- **Type consistency:** `connectionStatus(isOnline, pending, phase)` signature and `ConnVariant`/`ConnStatus` identical across Tasks 1 and 3; `pendingSync` / `SET_PENDING_SYNC` consistent across Task 2; `getQueueLength` defined in Task 2 Step 1 and imported in Task 2 Step 2.
- **Scope:** single cohesive feature, one plan.
