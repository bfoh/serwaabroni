# Scan-to-Sell (POS Barcode/QR) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a sale be built by scanning product barcodes/QRs supermarket-style, reusing one shared camera/decoder core for both the new sales scanner and the existing delivery scanner.

**Architecture:** Extract the decode utilities (`src/lib/scanner.ts`) and the camera+decode loop (`src/hooks/useScanCamera.ts`) into shared modules. Build a `SaleScanner` POS overlay on the hook and wire a SCAN button into `AddSaleSheet`. Then refactor the delivery `BarcodeScanner` onto the same utilities and hook, preserving its behavior.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind, framer-motion, lucide-react, native `BarcodeDetector`, `@undecaf/zbar-wasm`.

**Testing note:** No unit-test runner (scripts: `dev`, `build`, `lint`, `preview`). Verification = `npm run build` + `npm run lint` + manual scan. Do not add a test framework.

**Ordering rationale:** Tasks 1–4 ship the new sales feature with the delivery scanner untouched (independently testable/commit-able). Task 5 is a safe DRY extraction. Task 6 is the delicate delivery loop-swap (spec §4) — last, behind a manual gate, so the feature is already shipped if it needs iteration.

---

### Task 1: `src/lib/scanner.ts` — shared decode utilities

**Files:**
- Create: `src/lib/scanner.ts`

- [ ] **Step 1: Create the file**

```ts
// Shared barcode/QR decode utilities used by both the delivery scanner and the
// sales (POS) scanner. Single source for normalization, decoder selection, and
// the lazy ZBar loader.

// Native BarcodeDetector format strings.
export const NATIVE_FORMATS = [
  'qr_code', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128',
  'code_39', 'code_93', 'codabar', 'itf', 'data_matrix', 'aztec', 'pdf417',
]

// Minimal typing for the native BarcodeDetector API (not in TS DOM lib yet).
export interface NativeBarcodeDetector {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>
}
export interface BarcodeDetectorCtor {
  new (opts?: { formats?: string[] }): NativeBarcodeDetector
  getSupportedFormats?(): Promise<string[]>
}
export function getBarcodeDetectorCtor(): BarcodeDetectorCtor | null {
  const ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
  return ctor || null
}

// Lazy ZBar WASM loader (kept out of the main bundle).
let zbarMod: typeof import('@undecaf/zbar-wasm') | null = null
export const loadZbar = async () => (zbarMod ??= await import('@undecaf/zbar-wasm'))

// Normalize a scanned code for matching: trim, strip whitespace, and treat the
// EAN-13/UPC-A leading-zero variant as equal (a UPC-A scanned as EAN-13 gains a
// leading 0). Returns a canonical digit string for numeric codes, else the
// trimmed raw value.
export function normalizeBarcode(code: string | null | undefined): string {
  if (!code) return ''
  const trimmed = String(code).trim()
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length === 13 && digits.startsWith('0')) return digits.slice(1)
  if (digits.length >= 8) return digits
  return trimmed
}
```

> **IMPLEMENTER NOTE:** Before finalizing, open `src/components/BarcodeScanner.tsx`
> and copy its existing `normalizeBarcode` body verbatim into this file if it
> differs from the above, so delivery matching behavior is byte-for-byte
> preserved. (The version above mirrors the documented EAN/UPC leading-zero
> rule; the existing one is the source of truth.)

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: `✓ built` (file unused yet).

- [ ] **Step 3: Commit**

```bash
git add src/lib/scanner.ts
git commit -m "feat: shared scanner decode utilities"
```

---

### Task 2: `src/hooks/useScanCamera.ts` — shared camera + decode loop

**Files:**
- Create: `src/hooks/useScanCamera.ts`

- [ ] **Step 1: Create the hook**

```ts
import { useEffect, useRef, useState } from 'react'
import {
  NATIVE_FORMATS,
  getBarcodeDetectorCtor,
  loadZbar,
  type NativeBarcodeDetector,
} from '@/lib/scanner'

interface UseScanCameraOptions {
  videoRef: React.RefObject<HTMLVideoElement | null>
  active: boolean
  paused?: boolean
  onResult: (code: string) => void
}
interface UseScanCameraResult {
  stream: MediaStream | null
  error: string | null
}

// Owns the rear-camera stream and the per-frame decode loop (native
// BarcodeDetector, else ZBar WASM). Starts when `active` is true, holds decoding
// while `paused`, and tears everything down when `active` goes false / unmounts.
export function useScanCamera({ videoRef, active, paused, onResult }: UseScanCameraOptions): UseScanCameraResult {
  const streamRef = useRef<MediaStream | null>(null)
  const detectorRef = useRef<NativeBarcodeDetector | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const decodeModeRef = useRef<'native' | 'zbar'>('zbar')
  const rafRef = useRef<number | null>(null)
  const pausedRef = useRef(false)
  const onResultRef = useRef(onResult)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { onResultRef.current = onResult }, [onResult])
  useEffect(() => { pausedRef.current = !!paused }, [paused])

  useEffect(() => {
    if (!active) return
    let cancelled = false

    const decodeFromVideo = async (): Promise<string | null> => {
      const video = videoRef.current
      if (!video || video.readyState < 2) return null
      if (decodeModeRef.current === 'native' && detectorRef.current) {
        const codes = await detectorRef.current.detect(video)
        return (codes && codes.length > 0 && codes[0].rawValue) || null
      }
      const vw = video.videoWidth, vh = video.videoHeight
      if (!vw || !vh) return null
      const scale = Math.min(1, 1280 / Math.max(vw, vh))
      const w = Math.round(vw * scale), h = Math.round(vh * scale)
      let canvas = canvasRef.current
      if (!canvas) { canvas = document.createElement('canvas'); canvasRef.current = canvas }
      if (canvas.width !== w) canvas.width = w
      if (canvas.height !== h) canvas.height = h
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return null
      ctx.drawImage(video, 0, 0, w, h)
      const imageData = ctx.getImageData(0, 0, w, h)
      const zbar = await loadZbar()
      const symbols = await zbar.scanImageData(imageData)
      if (symbols && symbols.length > 0) return symbols[0].decode() || null
      return null
    }

    const loop = () => {
      const tick = async () => {
        if (cancelled || !streamRef.current) return
        if (!pausedRef.current) {
          try {
            const code = await decodeFromVideo()
            if (code) onResultRef.current(code)
          } catch { /* transient decode error — keep scanning */ }
        }
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    }

    const start = async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            advanced: [{ focusMode: 'continuous' }],
          } as unknown as MediaTrackConstraints,
          audio: false,
        })
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return }
        streamRef.current = s
        setStream(s)
        const video = videoRef.current
        if (video) {
          video.srcObject = s
          video.setAttribute('playsinline', 'true')
          video.muted = true
          await video.play().catch(() => {})
        }
        try {
          await s.getVideoTracks()[0].applyConstraints({
            advanced: [{ focusMode: 'continuous' }],
          } as unknown as MediaTrackConstraints)
        } catch { /* device has no focus control */ }

        const Ctor = getBarcodeDetectorCtor()
        if (Ctor) {
          try {
            let formats = NATIVE_FORMATS
            if (Ctor.getSupportedFormats) {
              const supported = await Ctor.getSupportedFormats()
              const filtered = NATIVE_FORMATS.filter((f) => supported.includes(f))
              if (filtered.length) formats = filtered
            }
            detectorRef.current = new Ctor({ formats })
            decodeModeRef.current = 'native'
          } catch {
            detectorRef.current = null
            decodeModeRef.current = 'zbar'
          }
        } else {
          decodeModeRef.current = 'zbar'
        }
        if (decodeModeRef.current === 'zbar') {
          const zbar = await loadZbar()
          zbar.getInstance().catch(() => {})
        }
        loop()
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Camera error')
      }
    }

    start()

    return () => {
      cancelled = true
      if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
      detectorRef.current = null
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => { try { t.stop() } catch { /* ignore */ } })
        streamRef.current = null
      }
      if (videoRef.current) { try { videoRef.current.srcObject = null } catch { /* ignore */ } }
      setStream(null)
    }
  }, [active, videoRef])

  return { stream, error }
}
```

- [ ] **Step 2: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: `✓ built`; no new errors in the new files.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useScanCamera.ts
git commit -m "feat: useScanCamera shared camera/decode hook"
```

---

### Task 3: `src/components/SaleScanner.tsx` — POS overlay

**Files:**
- Create: `src/components/SaleScanner.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { useRef, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Check } from 'lucide-react'
import { useStore } from '@/lib/store'
import { formatCurrency } from '@/lib/data'
import { normalizeBarcode } from '@/lib/scanner'
import { useScanCamera } from '@/hooks/useScanCamera'
import type { Product } from '@/lib/supabase'

interface SaleScannerProps {
  isOpen: boolean
  onClose: () => void
  onProductScanned: (product: Product) => void
  itemCount: number
  total: number
}

const COOLDOWN_MS = 1200

export default function SaleScanner({ isOpen, onClose, onProductScanned, itemCount, total }: SaleScannerProps) {
  const { state, showToast } = useStore()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const lastCodeRef = useRef<{ code: string; at: number }>({ code: '', at: 0 })
  const [flash, setFlash] = useState(false)

  const handleCode = useCallback((raw: string) => {
    const target = normalizeBarcode(raw)
    if (!target) return
    const now = Date.now()
    if (lastCodeRef.current.code === target && now - lastCodeRef.current.at < COOLDOWN_MS) return
    lastCodeRef.current = { code: target, at: now }

    const product = state.products.find(
      (p) => normalizeBarcode(p.barcode) === target || normalizeBarcode(p.qr_code) === target
    )
    if (product) {
      if (product.quantity < 1) { showToast(`${product.name} is out of stock`, 'error'); return }
      onProductScanned(product)
      setFlash(true)
      setTimeout(() => setFlash(false), 250)
      try { navigator.vibrate?.(60) } catch { /* no haptics */ }
      showToast(`Added ${product.name}`, 'success')
    } else {
      showToast('Not in inventory', 'error')
    }
  }, [state.products, onProductScanned, showToast])

  const { error } = useScanCamera({ videoRef, active: isOpen, onResult: handleCode })

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[65] bg-black flex flex-col"
        >
          <video ref={videoRef} playsInline muted className="absolute inset-0 w-full h-full object-cover" />

          {/* green flash on a successful add */}
          {flash && <div className="absolute inset-0 bg-accent-green/40 pointer-events-none" />}

          {/* reticle */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-64 h-40 border-2 border-white/80 rounded-lg" />
          </div>

          {/* header */}
          <div className="relative z-10 flex items-center justify-between px-5 pt-safe py-4 bg-black/50">
            <div className="text-white">
              <p className="font-display text-lg uppercase tracking-tight">{itemCount} {itemCount === 1 ? 'item' : 'items'}</p>
              <p className="text-accent-green text-sm">{formatCurrency(total)}</p>
            </div>
            <button onClick={onClose} className="btn-tactile h-11 px-4 bg-white rounded-sm font-display text-sm uppercase tracking-wider text-ink flex items-center gap-2">
              <Check size={18} /> Done
            </button>
          </div>

          {/* hint / error */}
          <div className="absolute bottom-0 left-0 right-0 z-10 px-5 pb-safe pt-4 bg-black/50 text-center">
            {error ? (
              <div className="text-white">
                <p className="text-sm">Camera unavailable</p>
                <p className="text-xs text-white/60 mt-1">{error}</p>
                <button onClick={onClose} className="mt-3 h-11 px-5 bg-white rounded-sm font-display text-sm uppercase text-ink inline-flex items-center gap-2">
                  <X size={16} /> Close
                </button>
              </div>
            ) : (
              <p className="text-white/80 text-sm pb-2">Point at a product barcode or QR</p>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
```

(`pt-safe`/`pb-safe` exist from the mobile-hardening work. `z-[65]` sits above the sheet panel `z-[61]` so the scanner covers the New Sale sheet while open.)

- [ ] **Step 2: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: `✓ built`; no new errors. (`SaleScanner` unused until Task 4.)

- [ ] **Step 3: Commit**

```bash
git add src/components/SaleScanner.tsx
git commit -m "feat: SaleScanner POS overlay"
```

---

### Task 4: Wire SCAN into `AddSaleSheet`

**Files:**
- Modify: `src/components/AddSaleSheet.tsx` (imports, state, grid header button, render SaleScanner)

- [ ] **Step 1: Add imports**

Change line 3 to include `ScanLine`:

```tsx
import { X, Minus, Plus, Check, User, Phone, Trash2, ArrowLeft, ScanLine } from 'lucide-react'
```

Add after the existing imports (after line 6 `import ProductIcon from './ProductIcon'`):

```tsx
import SaleScanner from './SaleScanner'
```

- [ ] **Step 2: Add scanner open state**

After the existing `const [searchQuery, setSearchQuery] = useState('')` line, add:

```tsx
  const [showScan, setShowScan] = useState(false)
```

- [ ] **Step 3: Add a SCAN button beside the search input**

Replace the grid-view search block:

```tsx
                      <div className="mb-4">
                        <input
                          type="text"
                          placeholder="Search products..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="w-full h-12 px-4 bg-light harsh-border rounded-sm text-base font-body focus:outline-none focus:ring-2 focus:ring-ink"
                        />
                      </div>
```

with:

```tsx
                      <div className="mb-4 flex gap-2">
                        <input
                          type="text"
                          placeholder="Search products..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="flex-1 h-12 px-4 bg-light harsh-border rounded-sm text-base font-body focus:outline-none focus:ring-2 focus:ring-ink"
                        />
                        <button
                          type="button"
                          onClick={() => setShowScan(true)}
                          aria-label="Scan barcode"
                          className="btn-tactile w-12 h-12 flex-shrink-0 bg-ink rounded-sm flex items-center justify-center"
                        >
                          <ScanLine size={22} className="text-white" />
                        </button>
                      </div>
```

- [ ] **Step 4: Render SaleScanner**

Immediately before the final closing of the sheet (right after the sticky CONFIRM SALE footer block, before `</motion.div>` that closes the sheet panel), add:

```tsx
                <SaleScanner
                  isOpen={showScan}
                  onClose={() => setShowScan(false)}
                  onProductScanned={(p) => addToCart(p.id)}
                  itemCount={itemCount}
                  total={total}
                />
```

(Place it inside the sheet's root so it unmounts with the sheet; `addToCart`,
`itemCount`, `total` already exist in this component.)

- [ ] **Step 5: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: `✓ built`; no new errors in `AddSaleSheet.tsx`.

- [ ] **Step 6: Commit**

```bash
git add src/components/AddSaleSheet.tsx
git commit -m "feat: scan-to-sell button and overlay in New Sale"
```

- [ ] **Step 7: Manual checkpoint (sales feature works, delivery untouched)**

`npm run dev` → New Sale → SCAN → scan a stocked product with a barcode → green
flash + "Added", tally rises; rescan after ~1.2s → qty 2; unknown code → "Not in
inventory"; Done → cart correct → CONFIRM records sale + decrements stock.

---

### Task 5: Delivery scanner uses shared utilities (safe DRY)

**Files:**
- Modify: `src/components/BarcodeScanner.tsx` (delete local copies, import from `@/lib/scanner`)

- [ ] **Step 1: Import shared utilities**

Add to the import block (near the existing `import type { Html5Qrcode }` line):

```ts
import {
  NATIVE_FORMATS,
  getBarcodeDetectorCtor,
  loadZbar,
  normalizeBarcode,
  type NativeBarcodeDetector,
  type BarcodeDetectorCtor,
} from '@/lib/scanner'
```

- [ ] **Step 2: Delete the now-duplicated local definitions**

Remove from `BarcodeScanner.tsx`:
- the local `normalizeBarcode` function,
- the local `NATIVE_FORMATS` const,
- the local `NativeBarcodeDetector`/`BarcodeDetectorCtor` interfaces and
  `getBarcodeDetectorCtor` function,
- the local `let zbarMod …; const loadZbar = …` lazy loader.

Leave `loadHtml5` (upload path) in place.

- [ ] **Step 3: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: `✓ built`; no new errors. Delivery still references the same names,
now imported. No behavior change.

- [ ] **Step 4: Commit**

```bash
git add src/components/BarcodeScanner.tsx
git commit -m "refactor: delivery scanner uses shared scanner utilities"
```

---

### Task 6: Delivery scanner adopts `useScanCamera` (spec §4)

**Files:**
- Modify: `src/components/BarcodeScanner.tsx` (replace inline camera lifecycle with the hook; torch via returned stream)

- [ ] **Step 1: Add the hook call near the top of the component**

After the existing refs/state (just after `const resetManual = …` block, before
`pauseScanning`), add:

```tsx
  const cameraActive = isOpen && scanMode === 'camera'
  const { stream: scanStream, error: scanError } = useScanCamera({
    videoRef,
    active: cameraActive,
    paused: showItemSheet || isProcessingRef.current,
    onResult: (code) => onScanSuccessRef.current(code),
  })
```

Import the hook at the top:

```ts
import { useScanCamera } from '@/hooks/useScanCamera'
```

- [ ] **Step 2: Surface camera errors from the hook**

Add an effect after the hook call to mirror the hook's error into the existing
error UI state:

```tsx
  useEffect(() => {
    if (scanError) {
      setCameraError(scanError)
      setCameraBlocked(
        /permission|not allowed|Permission denied|NotAllowed|Permissions policy/i.test(scanError)
      )
    }
  }, [scanError])
```

- [ ] **Step 3: Remove the replaced camera-lifecycle code**

Delete these now-superseded pieces (the hook owns them):
- `decodeFromVideo`, `runDetectLoop`, `startCameraScanner`, `startScanner`,
  `stopScanner` (the native pipeline; keep nothing that references
  `detectorRef`/`decodeModeRef`/`rafRef`/`streamRef`/`engineRef` for the live
  camera),
- the `useEffect` keyed on `[isOpen, startScanner, stopScanner]` that started/
  stopped the camera,
- the now-unused refs: `detectorRef`, `canvasRef`, `decodeModeRef`, `rafRef`,
  `streamRef`, `engineRef`, and the `engine`/`setEngine` state.

Keep: `isProcessingRef`, `isPausedRef` is replaced by the hook's `paused`
(remove `isPausedRef` and its uses in pause/resume — see Step 4), `videoRef`,
`onScanSuccessRef`, `isScanning`/`setIsScanning`, `torchOn`.

- [ ] **Step 4: Simplify pause/resume to drive the hook**

The hook pauses via the `paused` prop (`showItemSheet || isProcessingRef.current`).
Replace `pauseScanning`/`resumeScanning` bodies with:

```tsx
  const pauseScanning = useCallback(() => { isProcessingRef.current = true }, [])
  const resumeScanning = useCallback(() => { isProcessingRef.current = false }, [])
```

(`paused` recomputes from `isProcessingRef`/`showItemSheet` on the next render;
the existing `onScanSuccess` already flips `isProcessingRef` while a sheet is up.)
Ensure `pauseScanning`/`resumeScanning`/`showItemSheet` cause a re-render so
`paused` updates — they already toggle component state (`showItemSheet`,
`setIsScanning`); if needed, add `const [, force] = useState(0)` is NOT required
because `showItemSheet` state change re-renders. For the `isProcessingRef`-only
transitions, also set a state flag: add `const [busy, setBusy] = useState(false)`
and set it in pause/resume, and compute `paused: showItemSheet || busy`.

Final hook `paused` expression:

```tsx
    paused: showItemSheet || busy,
```

and:

```tsx
  const [busy, setBusy] = useState(false)
  const pauseScanning = useCallback(() => { isProcessingRef.current = true; setBusy(true) }, [])
  const resumeScanning = useCallback(() => { isProcessingRef.current = false; setBusy(false) }, [])
```

- [ ] **Step 5: Set `isScanning` from camera activity**

Where `startScanner`/`stopScanner` used to toggle `isScanning`, instead drive it
from the hook lifecycle:

```tsx
  useEffect(() => { setIsScanning(cameraActive && !scanError) }, [cameraActive, scanError])
```

Replace any remaining `startScanner()` call sites (the retry buttons at the
camera-error UI and the "switch to camera" buttons) with
`() => { setCameraError(null); setScanMode('camera') }` — turning the camera on
is now just setting `scanMode==='camera'` while `isOpen`, which flips
`cameraActive` and starts the hook.

- [ ] **Step 6: Point torch at the hook's stream**

In `toggleTorch`, replace the native branch condition `engineRef.current === 'native' && streamRef.current` with `scanStream`, and use `scanStream.getVideoTracks()[0]`:

```tsx
      if (scanStream) {
        await scanStream.getVideoTracks()[0].applyConstraints({
          advanced: [{ torch: next }],
        } as unknown as MediaTrackConstraints)
        setTorchOn(next)
      }
```

Remove the `engineRef.current === 'fallback'` torch branch (the live fallback
engine no longer exists).

- [ ] **Step 7: Clean the video JSX**

The `<video ref={videoRef} … />` stays. Remove the `engine === 'native'`
conditional on the fallback `#scanner-camera` div (delete that fallback preview
div, since the html5-qrcode live engine is gone; upload still uses the hidden
`upload-scanner-hidden` element, which stays).

- [ ] **Step 8: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: `✓ built`; no unused-symbol errors (all removed refs/state gone). No
references remain to `detectorRef`/`decodeModeRef`/`rafRef`/`streamRef`/
`engineRef`/`engine`/`isPausedRef`.

Run: `grep -nE "detectorRef|decodeModeRef|rafRef|streamRef|engineRef|isPausedRef|setEngine" src/components/BarcodeScanner.tsx`
Expected: no matches.

- [ ] **Step 9: Commit**

```bash
git add src/components/BarcodeScanner.tsx
git commit -m "refactor: delivery scanner adopts useScanCamera (spec §4)"
```

---

### Task 7: Manual verification (full)

**Files:** none.

- [ ] **Step 1: Sales scan** — New Sale → SCAN → scan stocked product (barcode and a QR-coded product) → added; rescan → qty+1; unknown → toast; Done → cart → CONFIRM → stock down, sale recorded (grouped receipt if multi).
- [ ] **Step 2: Stock cap** — scanning past stock does not exceed available.
- [ ] **Step 3: Delivery regression** — open delivery scanner: live camera scans, item sheet opens, torch toggles, manual/NEW-BARCODE entry works, photo upload works, DB lookup works.
- [ ] **Step 4: iOS path** — on a browser without `BarcodeDetector`, both scanners still decode via ZBar (loaded lazily on open).
- [ ] **Step 5: Build** — `npm run build` clean; ZBar/html5-qrcode remain lazy chunks.
- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "chore: verify scan-to-sell + delivery refactor" --allow-empty
```

---

## Self-Review

**Spec coverage:**
- Unit 1 `lib/scanner.ts` (normalizeBarcode, NATIVE_FORMATS, detector ctor, loadZbar) → Task 1 ✓
- Unit 2 `useScanCamera` (getUserMedia, decoder pick, RAF loop, paused, teardown, returns stream/error) → Task 2 ✓
- Unit 3 `SaleScanner` (continuous, cooldown, match by barcode/qr, found→add+flash+vibrate+toast, unknown→toast, Done, error UI) → Task 3 ✓
- Unit 4 AddSaleSheet (SCAN button, render SaleScanner, addToCart) → Task 4 ✓
- Unit 5 delivery refactor (shared utils + adopt hook, preserve item sheet/torch/manual/upload/lookup) → Tasks 5 + 6 ✓
- Continuous POS + qty increment + stock cap → Tasks 3/4 (addToCart caps) + Task 7 ✓
- Unknown code toast + keep scanning → Task 3 ✓
- No sale-write/stock/receipt change → only cart entry; verified Task 7 ✓

**Placeholder scan:** none — full code for new files; exact before/after for edits; explicit grep checks.

**Type consistency:** `useScanCamera` option/result shapes defined in Task 2 are used identically in Task 3 (`{ videoRef, active, onResult }`, reads `error`) and Task 6 (`{ videoRef, active, paused, onResult }`, reads `stream`,`error`). `normalizeBarcode`/`NATIVE_FORMATS`/`getBarcodeDetectorCtor`/`loadZbar`/`NativeBarcodeDetector`/`BarcodeDetectorCtor` exported in Task 1, imported in Tasks 2/3/6. `SaleScanner` props (`isOpen,onClose,onProductScanned,itemCount,total`) defined Task 3, passed identically Task 4. `Product` type matched on `barcode`/`qr_code` (existing fields).

**Risk note:** Task 6 is the delicate one (removing refs/engine/fallback, torch rewire). Tasks 1–5 already deliver the working sales feature and the safe DRY extraction, each committed, so Task 6 can be iterated or reverted without losing the feature.
