# Lazy-Load Scanner Libraries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `html5-qrcode` and `@undecaf/zbar-wasm` out of the main bundle by loading them dynamically only when used.

**Architecture:** Convert the two static runtime imports in `BarcodeScanner.tsx` to memoized dynamic `import()` loaders. ZBar loads only on the iOS/ZBar live path; `html5-qrcode` loads only on photo upload; Android's native `BarcodeDetector` path loads neither. Vite code-splits each dynamic import into its own chunk.

**Tech Stack:** React 19, TypeScript, Vite, html5-qrcode, @undecaf/zbar-wasm.

**Testing note:** No unit-test runner (scripts: `dev`, `build`, `lint`, `preview`). Verification = `npm run build` (inspect chunks) + `npm run lint` + manual scan. Do not add a test framework.

**Build-order note:** Task 1 removes the static imports, which makes the tree reference now-undefined `getInstance`/`scanImageData`/`SUPPORTED_FORMATS`. The tree compiles again only after Task 2. Commit Tasks 1+2 together (Task 2 Step 5).

---

### Task 1: Replace static imports with type import + dynamic loaders

**Files:**
- Modify: `src/components/BarcodeScanner.tsx:8-9` (imports)
- Modify: `src/components/BarcodeScanner.tsx:101-115` (delete top-level `SUPPORTED_FORMATS`)
- Add module-level loaders after the imports.

- [ ] **Step 1: Swap the imports**

Change lines 8-9:

```ts
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode'
import { scanImageData, getInstance } from '@undecaf/zbar-wasm'
```

to:

```ts
import type { Html5Qrcode } from 'html5-qrcode'

// Heavy scanner deps are loaded on demand so they stay out of the main bundle.
let zbarMod: typeof import('@undecaf/zbar-wasm') | null = null
const loadZbar = async () => (zbarMod ??= await import('@undecaf/zbar-wasm'))

let html5Mod: typeof import('html5-qrcode') | null = null
const loadHtml5 = async () => (html5Mod ??= await import('html5-qrcode'))
```

- [ ] **Step 2: Delete the top-level `SUPPORTED_FORMATS` const**

Remove the entire block at lines ~101-115:

```ts
const SUPPORTED_FORMATS = [
  Html5QrcodeSupportedFormats.QR_CODE,
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.UPC_EAN_EXTENSION,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.CODE_93,
  Html5QrcodeSupportedFormats.CODABAR,
  Html5QrcodeSupportedFormats.ITF,
  Html5QrcodeSupportedFormats.DATA_MATRIX,
  Html5QrcodeSupportedFormats.AZTEC,
]
```

(Keep the comment block above it if present; only the `const SUPPORTED_FORMATS = [...]` is removed. `NATIVE_FORMATS` below it stays.)

- [ ] **Step 3: Do not build yet**

The build will fail until Task 2 rewires the call sites (`getInstance`, `scanImageData`, `SUPPORTED_FORMATS` are now undefined). Proceed directly to Task 2.

---

### Task 2: Rewire call sites to the loaders

**Files:**
- Modify: `src/components/BarcodeScanner.tsx` — `startCameraScanner` (ZBar warm-up + decoder pick), `decodeFromVideo` (ZBar branch), `handleFileUpload`.

- [ ] **Step 1: Remove the unconditional ZBar warm-up at the top of `startCameraScanner`**

Delete these lines (~275-277) at the start of `startCameraScanner`:

```ts
    // Warm up the ZBar WASM in parallel with the camera so the first decode is
    // instant rather than paying the ~240KB instantiation cost on first scan.
    getInstance().catch(() => { /* loads lazily on first decode otherwise */ })
```

- [ ] **Step 2: Load ZBar only when the decoder is ZBar**

In `startCameraScanner`, the decoder-selection block currently reads:

```ts
    // Pick the decoder: native BarcodeDetector (Android) else ZBar WASM (iOS).
    const DetectorCtor = getBarcodeDetectorCtor()
    if (DetectorCtor) {
      try {
        let formats = NATIVE_FORMATS
        if (DetectorCtor.getSupportedFormats) {
          const supported = await DetectorCtor.getSupportedFormats()
          const filtered = NATIVE_FORMATS.filter((f) => supported.includes(f))
          if (filtered.length) formats = filtered
        }
        detectorRef.current = new DetectorCtor({ formats })
        decodeModeRef.current = 'native'
      } catch {
        detectorRef.current = null
        decodeModeRef.current = 'zbar'
      }
    } else {
      decodeModeRef.current = 'zbar'
    }
```

Replace it with (adds a conditional ZBar load + warm-up only on the zbar path):

```ts
    // Pick the decoder: native BarcodeDetector (Android) else ZBar WASM (iOS).
    const DetectorCtor = getBarcodeDetectorCtor()
    if (DetectorCtor) {
      try {
        let formats = NATIVE_FORMATS
        if (DetectorCtor.getSupportedFormats) {
          const supported = await DetectorCtor.getSupportedFormats()
          const filtered = NATIVE_FORMATS.filter((f) => supported.includes(f))
          if (filtered.length) formats = filtered
        }
        detectorRef.current = new DetectorCtor({ formats })
        decodeModeRef.current = 'native'
      } catch {
        detectorRef.current = null
        decodeModeRef.current = 'zbar'
      }
    } else {
      decodeModeRef.current = 'zbar'
    }

    // Load + warm the ZBar WASM only when we will actually use it (iOS path).
    // Android's native BarcodeDetector never downloads it.
    if (decodeModeRef.current === 'zbar') {
      const zbar = await loadZbar()
      zbar.getInstance().catch(() => { /* instantiates lazily on first decode */ })
    }
```

- [ ] **Step 3: Use the loaded module in `decodeFromVideo`**

In `decodeFromVideo`, the ZBar branch currently calls:

```ts
    const symbols = await scanImageData(imageData)
```

Change to:

```ts
    const symbols = await (zbarMod ?? await loadZbar()).scanImageData(imageData)
```

(The `?? await loadZbar()` is a safety net; in practice `zbarMod` is already set by `startCameraScanner` before the loop runs in zbar mode.)

- [ ] **Step 4: Dynamic-load `html5-qrcode` in `handleFileUpload`**

In `handleFileUpload`, replace:

```ts
      const scanner = new Html5Qrcode('upload-scanner-hidden', {
        verbose: false,
        useBarCodeDetectorIfSupported: true,
        formatsToSupport: SUPPORTED_FORMATS,
        experimentalFeatures: { useBarCodeDetectorIfSupported: true },
      })
```

with:

```ts
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await loadHtml5()
      const formatsToSupport = [
        Html5QrcodeSupportedFormats.QR_CODE,
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.UPC_EAN_EXTENSION,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.CODE_93,
        Html5QrcodeSupportedFormats.CODABAR,
        Html5QrcodeSupportedFormats.ITF,
        Html5QrcodeSupportedFormats.DATA_MATRIX,
        Html5QrcodeSupportedFormats.AZTEC,
      ]
      const scanner = new Html5Qrcode('upload-scanner-hidden', {
        verbose: false,
        useBarCodeDetectorIfSupported: true,
        formatsToSupport,
        experimentalFeatures: { useBarCodeDetectorIfSupported: true },
      })
```

Note: the local `Html5Qrcode` from `loadHtml5()` shadows the type-only import name at runtime — that is fine (the type import is erased at build).

- [ ] **Step 5: Verify build + lint, then commit Tasks 1+2**

Run: `npm run build && npm run lint`
Expected: `✓ built`; the build summary shows the main `index-*.js` chunk smaller than before and new dynamically-split chunks for `zbar`/`html5-qrcode`; no new lint errors in `BarcodeScanner.tsx`.

```bash
git add src/components/BarcodeScanner.tsx
git commit -m "perf: lazy-load html5-qrcode and zbar-wasm out of main bundle"
```

---

### Task 3: Verify bundle split + scanning

**Files:** none (verification).

- [ ] **Step 1: Confirm the chunks split**

Run: `npm run build`
Expected: `dist/assets` lists a separate chunk whose name/content corresponds to `zbar` (the ~238KB WASM is in its own asset, not the main JS chunk) and a separate chunk for `html5-qrcode`. The main `index-*.js` gzip size is smaller than the pre-change value.

Cross-check no static reference remains:

Run: `grep -nE "scanImageData|getInstance|SUPPORTED_FORMATS" src/components/BarcodeScanner.tsx`
Expected: only the references inside `decodeFromVideo`/`startCameraScanner` via the loaded module (`zbar.getInstance`, `(zbarMod ?? …).scanImageData`); no top-level `SUPPORTED_FORMATS` const.

- [ ] **Step 2: Manual — live scan (ZBar / iOS or a desktop browser without BarcodeDetector)**

`npm run dev`, open scanner, scan a barcode/QR. Decodes correctly. First scan still fast (warm-up preserved on the zbar path).

- [ ] **Step 3: Manual — live scan (Android / BarcodeDetector)**

On Android Chrome (or DevTools with BarcodeDetector available), open scanner and watch the Network tab: scanning works and the ZBar WASM chunk is **not** requested.

- [ ] **Step 4: Manual — photo upload**

Use the upload option with a barcode image. First upload fetches the `html5-qrcode` chunk (visible in Network) and decodes; a second upload does not re-fetch (memoized).

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: verify lazy-loaded scanner bundle split" --allow-empty
```

---

## Self-Review

**Spec coverage:**
- Type-only `Html5Qrcode` import → Task 1 Step 1 ✓
- Remove value imports of `Html5Qrcode`/`Html5QrcodeSupportedFormats`/`scanImageData`/`getInstance` → Task 1 Step 1 ✓
- Memoized `loadZbar`/`loadHtml5` → Task 1 Step 1 ✓
- Delete top-level `SUPPORTED_FORMATS`, rebuild in upload → Task 1 Step 2 + Task 2 Step 4 ✓
- ZBar loaded only on zbar path; Android skips it → Task 2 Steps 1-2 ✓
- `decodeFromVideo` uses loaded module → Task 2 Step 3 ✓
- `handleFileUpload` dynamic-loads html5-qrcode → Task 2 Step 4 ✓
- Verification of chunk split + scanning → Task 3 ✓

**Placeholder scan:** none — every step shows the exact before/after code.

**Consistency:** loader names `zbarMod`/`loadZbar`, `html5Mod`/`loadHtml5` are defined in Task 1 Step 1 and used verbatim in Task 2 Steps 2-4. The 13-format list deleted in Task 1 Step 2 is reproduced exactly in Task 2 Step 4. `NATIVE_FORMATS` is untouched. `decodeModeRef`/`detectorRef`/`getBarcodeDetectorCtor` are existing identifiers, used unchanged.
