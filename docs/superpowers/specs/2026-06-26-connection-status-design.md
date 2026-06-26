# Connection & Sync Status Indicator — Design

Date: 2026-06-26
Status: Approved (pending spec review)

## Problem

The app already tracks connectivity (`state.isOnline`, fed by `navigator.onLine`
and the `online`/`offline` window events) and queues failed writes for retry
(`serwaabroni_sync_queue` via `offline.ts`). But **no part of the UI surfaces
either fact**. A shop owner on a flaky mobile connection has no way to know she
is offline, and no reassurance that a payment she just recorded is safely
captured and waiting to upload. This is the trust gap left over from the
payment-revert fix: the data is now safe, but the user can't see that it is.

## Goal

Show connectivity at a glance, and — while offline or syncing — show how many
changes are still waiting to reach the server.

Non-goals (YAGNI):
- No manual "sync now" button (auto-sync already runs on reconnect/focus).
- No per-record sync status.
- No history/log of past disconnections.
- No persistence of the indicator state across reloads.

## User-visible behaviour

A single thin bar, fixed at the top of the viewport, with four states:

| Condition | Visible? | Variant | Text |
|---|---|---|---|
| Online, queue empty | No | — | (hidden) |
| Offline | Yes | offline (red) | `Offline — N change(s) will sync when reconnected` (drop `— …` when N=0) |
| Just reconnected, queue draining | Yes | syncing (amber) | `Back online — syncing N…` |
| Just reconnected, queue emptied | Yes, ~2s then hide | synced (green) | `All changes synced` |

Pluralisation: `1 change`, `2 changes`.

The "synced" confirmation only appears if there was something to sync (i.e. we
came back online with pending > 0). Coming back online with an empty queue just
hides the bar — no needless toast-like flash.

## Architecture

Three units, each independently testable:

### 1. `connectionStatus()` — pure mapping (the testable core)

Location: `src/lib/connectionStatus.ts`

```ts
export type ConnVariant = 'hidden' | 'offline' | 'syncing' | 'synced'
export interface ConnStatus { variant: ConnVariant; text: string }

export function connectionStatus(
  isOnline: boolean,
  pending: number,
  phase: 'idle' | 'reconnected',
): ConnStatus
```

Rules:
- `!isOnline` → `offline`; text includes pending count when `pending > 0`.
- `isOnline && phase === 'reconnected' && pending > 0` → `syncing`.
- `isOnline && phase === 'reconnected' && pending === 0` → `synced`.
- otherwise → `hidden`.

This function holds ALL the text/variant logic so the component is a dumb
renderer. Unit tests target this function.

### 2. Store wiring — `pendingSync` count

`src/lib/store.tsx` + `src/services/offline.ts`

- `offline.ts`: add `export function getQueueLength(): number` (returns
  `getQueue().length`) so the store can read a count without owning queue
  internals.
- `store.tsx`:
  - Add `pendingSync: number` to `AppState` (initial `getQueueLength()`).
  - Add action `{ type: 'SET_PENDING_SYNC'; value: number }` and reducer case.
  - Helper inside the provider: `const syncPending = () => dispatch({ type:
    'SET_PENDING_SYNC', value: getQueueLength() })`.
  - Call `syncPending()` immediately after every `queueOperation(...)` call
    (the three debt CRUD catch branches added by the payment fix) and after
    each `syncQueue()` completes (in `refreshData` and in the `setupAutoSync`
    callback). No polling, no new timers.

### 3. `ConnectionBar` component — thin renderer

`src/components/ConnectionBar.tsx`, rendered in `App.tsx` alongside `<Toast />`.

- Reads `state.isOnline` and `state.pendingSync` from the store.
- Tracks a local `phase`: flips to `reconnected` when `isOnline` transitions
  `false → true`; a `setTimeout` clears it back to `idle` after the `synced`
  confirmation (~2s) or as soon as the bar would otherwise hide.
- Calls `connectionStatus(isOnline, pendingSync, phase)`; renders nothing when
  variant is `hidden`.
- Styling matches the app's existing harsh-border / accent-colour palette
  (accent-red for offline, an amber tone for syncing, accent-green for synced).
  Positioned fixed top, above page content, with `pt-safe` for notch safety.

## Data flow

```
navigator online/offline events ──► store.isOnline (existing effect)
queueOperation()/syncQueue()    ──► store.pendingSync (SET_PENDING_SYNC)
store {isOnline, pendingSync} + local phase ──► connectionStatus() ──► ConnectionBar render
```

## Error handling / edge cases

- `getQueueLength()` swallows storage/parse errors (returns 0), same as the
  existing queue readers.
- Rapid online/offline flapping: `phase` is driven off the latest transition;
  the confirmation timeout is cleared and reset on each change so stale timers
  never fire.
- If `syncQueue()` partially fails, `pendingSync` reflects the remaining count;
  the bar shows the still-pending number rather than a false "all synced".
- Going offline again while a `synced` confirmation is showing immediately
  switches the bar to the `offline` variant.

## Testing

- `src/lib/connectionStatus.test.ts` (node, pure):
  - hidden when online + idle + empty.
  - offline with 0 / 1 / N pending (text + pluralisation).
  - syncing when reconnected with pending > 0.
  - synced when reconnected with pending === 0.
  - offline takes priority over phase.
- Manual/Playwright check is optional and gated on a working local backend
  (see prior session: this checkout lacks a valid Supabase key); the pure tests
  are the source of truth.

## Files touched

- `src/lib/connectionStatus.ts` (new)
- `src/lib/connectionStatus.test.ts` (new)
- `src/components/ConnectionBar.tsx` (new)
- `src/services/offline.ts` (add `getQueueLength`)
- `src/lib/store.tsx` (add `pendingSync` state, action, `syncPending()` calls)
- `src/App.tsx` (render `<ConnectionBar />`)
