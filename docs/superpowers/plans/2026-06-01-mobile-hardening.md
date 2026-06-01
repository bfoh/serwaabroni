# App-Wide Mobile Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app fully mobile-ready on iOS and Android — fix the receipt buttons hidden behind the nav, respect safe-area insets (notch + home indicator), enforce a coherent z-index ladder, guarantee 44px tap targets, and stop iOS input-focus zoom.

**Architecture:** Add `viewport-fit=cover`, define safe-area CSS utilities (`pt-safe`, `pb-safe`, `h-nav`) plus a 16px input rule in `index.css`, then apply a z-index ladder (nav `z-40` < page overlays `z-50` < sheets/modals `z-[60]/[61]` < toast `z-[70]`) so every modal paints above the nav. Pure layout/CSS — no data or logic changes.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind, framer-motion, lucide-react.

**Testing note:** No unit-test runner (scripts: `dev`, `build`, `lint`, `preview`). Per-task verification = `npm run build` + `npm run lint`; manual device checks in the final task. Do not add a test framework.

**Layering rule used throughout:**
- Bottom nav → `z-40`.
- Full-screen page overlays (SalesHistory, Expenses) → `z-50` (cover the nav).
- Bottom sheets / centered modals (AddSaleSheet, ReceiptModal, BarcodeScanner capture sheet, Expenses/Inventory/Debts/Customers add-sheets, Settings dialogs) → backdrop `z-[60]`, panel `z-[61]`.
- Toast → `z-[70]`.

**Safe-area rule used throughout:**
- Topmost sticky header of each screen gets `pt-safe` (status bar is translucent).
- The bottom nav and any sheet/overlay footer that reaches the screen bottom gets `pb-safe` (home indicator).

---

### Task 1: Viewport-fit (`index.html`)

**Files:**
- Modify: `index.html` (viewport meta)

- [ ] **Step 1: Add viewport-fit=cover**

Change:

```html
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
```

to:

```html
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: `✓ built`.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: enable viewport-fit=cover for safe-area insets"
```

---

### Task 2: Safe-area utilities + input rule (`src/index.css`)

**Files:**
- Modify: `src/index.css` (add to `@layer base` and a new `@layer utilities`)

- [ ] **Step 1: Add the 16px input rule inside the existing `@layer base`**

In `src/index.css`, inside `@layer base`, after the `body { ... }` block's closing `}` (before the `.no-scrollbar` rules), add:

```css
  /* Prevent iOS auto-zoom on focus: inputs must be >= 16px */
  input, select, textarea {
    font-size: 16px;
  }
```

- [ ] **Step 2: Add safe-area utilities at the end of the file**

Append to `src/index.css`:

```css
/* Z-index ladder (documented): nav z-40 < page overlays z-50
   < sheets/modals z-60/61 < toast z-70 */
@layer utilities {
  .pt-safe  { padding-top: env(safe-area-inset-top); }
  .pb-safe  { padding-bottom: env(safe-area-inset-bottom); }
  .pb-sheet { padding-bottom: calc(1rem + env(safe-area-inset-bottom)); }
  .h-nav    { height: calc(4rem + env(safe-area-inset-bottom)); }
}
```

(Authoring these as real CSS rules — rather than Tailwind arbitrary `calc(...)`
values — avoids the spacing pitfall where Tailwind would emit `calc(1rem+env(...))`
with no spaces around `+`, which is invalid CSS.)

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: `✓ built`. (Utilities unused yet — fine.)

- [ ] **Step 4: Commit**

```bash
git add src/index.css
git commit -m "feat: add safe-area utilities and 16px input rule"
```

---

### Task 3: Bottom nav — z-40, height, safe-area

**Files:**
- Modify: `src/App.tsx:119` (nav wrapper)
- Modify: `src/components/BottomNav.tsx:33` (nav element)

- [ ] **Step 1: Nav wrapper z + height**

In `src/App.tsx`, change:

```tsx
        <div className="flex-shrink-0 h-16 w-full z-[9999] relative border-t-2 border-ink">
```

to:

```tsx
        <div className="flex-shrink-0 h-nav w-full z-40 relative border-t-2 border-ink">
```

- [ ] **Step 2: Nav inner padding for home indicator**

In `src/components/BottomNav.tsx`, change:

```tsx
    <nav className="w-full h-full bg-ink flex items-center justify-around select-none">
```

to:

```tsx
    <nav className="w-full h-full pb-safe bg-ink flex items-center justify-around select-none">
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: `✓ built`.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src/components/BottomNav.tsx
git commit -m "feat: nav z-40 with safe-area bottom inset"
```

---

### Task 4: Z-index ladder for modals and overlays

**Files:**
- Modify: `src/components/ReceiptModal.tsx` (backdrop `z-[100]`, panel `z-[110]`)
- Modify: `src/components/AddSaleSheet.tsx:183,193` (`z-50` x2)
- Modify: `src/components/Toast.tsx:16` (`z-[60]` → `z-[70]`)
- Modify: `src/pages/SalesHistory.tsx:68` (`z-[90]`)
- Modify: `src/pages/Expenses.tsx:73,157,161` (`z-[90]`, `z-[100]`, `z-[110]`)
- Modify: `src/pages/Customers.tsx:120,128` (`z-50` x2)

(BarcodeScanner and Settings dialogs are handled in Task 5 to keep diffs grouped with their other edits.)

- [ ] **Step 1: ReceiptModal z**

In `src/components/ReceiptModal.tsx`, change the backdrop class `className="fixed inset-0 bg-black/60 z-[100]"` to `className="fixed inset-0 bg-black/60 z-[60]"`, and the panel wrapper `z-[110]` to `z-[61]` (the line `className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[110] w-[92vw] max-w-sm"` — this whole line is replaced in Task 6, but make the z change now so the tree is consistent if Task 6 is deferred).

- [ ] **Step 2: AddSaleSheet z**

In `src/components/AddSaleSheet.tsx`:
- Line 183 `className="fixed inset-0 bg-black/40 z-50"` → `className="fixed inset-0 bg-black/40 z-[60]"`
- Line 193 `className="fixed bottom-0 left-0 right-0 bg-sand rounded-t-2xl z-50 shadow-sheet"` → `className="fixed bottom-0 left-0 right-0 bg-sand rounded-t-2xl z-[61] shadow-sheet"`

- [ ] **Step 3: Toast z**

In `src/components/Toast.tsx:16`, change `z-[60]` to `z-[70]`.

- [ ] **Step 4: Page overlays → z-50**

- `src/pages/SalesHistory.tsx:68` `className="fixed inset-0 z-[90] bg-sand flex flex-col"` → `z-50`.
- `src/pages/Expenses.tsx:73` `className="fixed inset-0 z-[90] bg-sand flex flex-col"` → `z-50`.
- `src/pages/Expenses.tsx:157` backdrop `z-[100]` → `z-[60]`.
- `src/pages/Expenses.tsx:161` sheet `z-[110]` → `z-[61]`.

- [ ] **Step 5: Customers add-sheet z**

- `src/pages/Customers.tsx:120` `className="fixed inset-0 bg-black/40 z-50"` → `z-[60]`.
- `src/pages/Customers.tsx:128` `className="fixed bottom-0 left-0 right-0 bg-sand rounded-t-2xl z-50 shadow-sheet"` → `z-[61]`.

- [ ] **Step 6: Verify build**

Run: `npm run build`
Expected: `✓ built`.

- [ ] **Step 7: Commit**

```bash
git add src/components/ReceiptModal.tsx src/components/AddSaleSheet.tsx src/components/Toast.tsx src/pages/SalesHistory.tsx src/pages/Expenses.tsx src/pages/Customers.tsx
git commit -m "feat: apply z-index ladder so modals sit above nav"
```

---

### Task 5: Z-index for BarcodeScanner + Settings dialogs; pt-safe headers

**Files:**
- Modify: `src/components/BarcodeScanner.tsx:1056,1066` (capture sheet z)
- Modify: `src/pages/Settings.tsx:178,183,236,241,268` (dialog z)
- Modify (pt-safe top headers): `src/pages/Dashboard.tsx:34`, `src/pages/Inventory.tsx:210`, `src/pages/Reports.tsx:80`, `src/pages/Debts.tsx:94`, `src/pages/Customers.tsx:52`, `src/pages/Settings.tsx:119`, `src/pages/SalesHistory.tsx:70`, `src/pages/Expenses.tsx:75`, `src/components/NotificationsSheet.tsx:34`

- [ ] **Step 1: BarcodeScanner capture sheet z**

In `src/components/BarcodeScanner.tsx`:
- Line 1056 backdrop `className="absolute inset-0 bg-black/60 z-[110]"` → `z-[60]`.
- Line 1066 sheet `z-[120]` → `z-[61]`.

(The full-screen scanner container at line 644 `z-[10000]` stays — it is a dedicated full-screen camera view that intentionally covers everything including nav.)

- [ ] **Step 2: Settings dialogs z**

In `src/pages/Settings.tsx`, for each dialog: backdrops `z-[60]` (lines 178, 236, 268) stay `z-[60]`; panels `z-[70]` (lines 183, 241, and the logout panel after 268) → change to `z-[61]`. Concretely, replace every `rounded-sm z-[70]` occurrence in this file with `rounded-sm z-[61]`.

- [ ] **Step 3: Add `pt-safe` to each top header**

Add `pt-safe` to the className of each of these (insert right after the existing `sticky top-0` / `<header ... ` class string, keeping all other classes):

- `src/pages/Dashboard.tsx:34` `sticky top-0 z-40 bg-sand border-b-2 border-ink px-5 py-3 flex items-center justify-between` → add ` pt-safe`.
- `src/pages/Inventory.tsx:210` `sticky top-0 z-40 bg-sand border-b-2 border-ink px-5 py-3` → add ` pt-safe`.
- `src/pages/Reports.tsx:80` `sticky top-0 z-40 bg-sand/95 backdrop-blur-sm border-b-2 border-ink px-5 py-3` → add ` pt-safe`.
- `src/pages/Debts.tsx:94` `sticky top-0 z-40 bg-sand border-b-2 border-ink px-5 py-3` → add ` pt-safe`.
- `src/pages/Customers.tsx:52` `sticky top-0 z-40 bg-sand border-b-2 border-ink px-5 py-3` → add ` pt-safe`.
- `src/pages/Settings.tsx:119` `sticky top-0 z-50 bg-sand border-b-2 border-ink px-5 py-3 flex items-center justify-between` → add ` pt-safe`.
- `src/pages/SalesHistory.tsx:70` `sticky top-0 z-50 bg-sand border-b-2 border-ink px-5 py-3 flex items-center justify-between flex-shrink-0` → add ` pt-safe`.
- `src/pages/Expenses.tsx:75` `sticky top-0 z-50 bg-sand border-b-2 border-ink px-5 py-3 flex items-center justify-between flex-shrink-0` → add ` pt-safe`.
- `src/components/NotificationsSheet.tsx:34` `sticky top-0 z-10 bg-sand border-b-2 border-ink px-5 py-3 flex items-center justify-between` → add ` pt-safe`.

(Note: the `z-50`/`z-40` already present on these headers are *within* their own stacking context and are unrelated to the global ladder; leave those numbers as-is, only append `pt-safe`.)

- [ ] **Step 4: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: `✓ built`, no new errors in touched files (pre-existing repo lint errors in `Reports.tsx`/`supabaseApi.ts`/`data.ts` remain and are unrelated).

- [ ] **Step 5: Commit**

```bash
git add src/components/BarcodeScanner.tsx src/pages/Settings.tsx src/pages/Dashboard.tsx src/pages/Inventory.tsx src/pages/Reports.tsx src/pages/Debts.tsx src/pages/Customers.tsx src/pages/SalesHistory.tsx src/pages/Expenses.tsx src/components/NotificationsSheet.tsx
git commit -m "feat: pt-safe headers and z-index for scanner/settings dialogs"
```

---

### Task 6: ReceiptModal — scrollable card + sticky safe-area footer

**Files:**
- Modify: `src/components/ReceiptModal.tsx` (panel wrapper + move action buttons into a sticky footer)

- [ ] **Step 1: Make the panel a flex column with bounded height**

In `src/components/ReceiptModal.tsx`, change the panel `motion.div` opening (the one with `top-1/2 left-1/2`):

```tsx
          <motion.div
            initial={{ opacity: 0, scale: 0.95, x: "-50%", y: "-50%" }}
            animate={{ opacity: 1, scale: 1, x: "-50%", y: "-50%" }}
            exit={{ opacity: 0, scale: 0.95, x: "-50%", y: "-50%" }}
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[61] w-[92vw] max-w-sm"
          >
```

to:

```tsx
          <motion.div
            initial={{ opacity: 0, scale: 0.95, x: "-50%", y: "-50%" }}
            animate={{ opacity: 1, scale: 1, x: "-50%", y: "-50%" }}
            exit={{ opacity: 0, scale: 0.95, x: "-50%", y: "-50%" }}
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[61] w-[92vw] max-w-sm flex flex-col max-h-[calc(100dvh-2rem)]"
          >
```

- [ ] **Step 2: Make the receipt card scroll**

Change the receipt card container:

```tsx
            <div ref={receiptRef} className="bg-sand harsh-border rounded-sm p-5 print-section">
```

to:

```tsx
            <div ref={receiptRef} className="bg-sand harsh-border rounded-sm p-5 print-section overflow-y-auto no-scrollbar">
```

- [ ] **Step 3: Pin the action buttons as a sticky safe-area footer**

Change the action button wrapper:

```tsx
            {/* Action Buttons */}
            <div className="mt-3 grid grid-cols-5 gap-1.5 print-hide">
```

to:

```tsx
            {/* Action Buttons */}
            <div className="mt-3 pb-safe grid grid-cols-5 gap-1.5 print-hide flex-shrink-0">
```

- [ ] **Step 4: Ensure 44px button height**

In the same button grid, each button currently has `h-11` (44px) — confirm all five buttons use `h-11`. They already do. No change needed; this step is a visual confirmation only.

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: `✓ built`.

- [ ] **Step 6: Commit**

```bash
git add src/components/ReceiptModal.tsx
git commit -m "feat: scrollable receipt card with sticky safe-area action footer"
```

---

### Task 7: 44px tap targets + sheet/overlay safe-area bottoms

**Files:**
- Modify: `src/components/AddSaleSheet.tsx` (steppers/trash `w-9 h-9` → `w-11 h-11`; close/back `w-10 h-10` → `w-11 h-11`; footer `pb-24` → `pb-safe`)
- Modify sheet footers `pb-24` → `pb-safe`: `src/pages/Expenses.tsx:186`, `src/pages/Inventory.tsx:645`, `src/pages/Debts.tsx:333`, `src/pages/Customers.tsx:164`
- Modify overlay scroll bottoms `pb-24` → `pb-safe`: `src/pages/SalesHistory.tsx:123`, `src/pages/Expenses.tsx:124`

- [ ] **Step 1: AddSaleSheet steppers + trash to 44px**

In `src/components/AddSaleSheet.tsx`, the three buttons at lines ~298, ~305, ~311 use `w-9 h-9`. Replace each `btn-tactile w-9 h-9` with `btn-tactile w-11 h-11` (3 occurrences). Use a global replace of `w-9 h-9` → `w-11 h-11` in this file (only these three exist).

- [ ] **Step 2: AddSaleSheet close/back buttons to 44px**

In the same file, the back button (~line 220) and close button (~line 229) use `btn-tactile w-10 h-10`. Replace `btn-tactile w-10 h-10` with `btn-tactile w-11 h-11` (2 occurrences).

- [ ] **Step 3: AddSaleSheet sticky footer safe-area**

Line ~424: change `className="px-5 pt-4 pb-24 bg-sand border-t-2 border-ink flex-shrink-0 mt-auto shadow-[0_-4px_10px_rgba(0,0,0,0.05)]"` to use `pb-sheet` instead of `pb-24`:

```tsx
                  <div className="px-5 pt-4 pb-sheet bg-sand border-t-2 border-ink flex-shrink-0 mt-auto shadow-[0_-4px_10px_rgba(0,0,0,0.05)]">
```

- [ ] **Step 4: Other sheet footers safe-area**

In each of these lines, replace `pb-24` with `pb-sheet`:
- `src/pages/Expenses.tsx:186`
- `src/pages/Inventory.tsx:645`
- `src/pages/Debts.tsx:333`
- `src/pages/Customers.tsx:164`

Each currently reads `className="px-5 pt-4 pb-24 bg-sand border-t-2 border-ink flex-shrink-0 mt-auto shadow-[0_-4px_10px_rgba(0,0,0,0.05)]"`.

- [ ] **Step 5: Full-screen overlay scroll bottoms safe-area**

These overlays now sit above the nav (z-50), so their lists must clear the home indicator:
- `src/pages/SalesHistory.tsx:123` `className="flex-1 overflow-y-auto px-5 pb-24 space-y-2"` → replace `pb-24` with `pb-sheet`.
- `src/pages/Expenses.tsx:124` `className="flex-1 overflow-y-auto px-5 pb-24 space-y-2"` → same replacement.

- [ ] **Step 6: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: `✓ built`, no new errors in touched files.

- [ ] **Step 7: Commit**

```bash
git add src/components/AddSaleSheet.tsx src/pages/Expenses.tsx src/pages/Inventory.tsx src/pages/Debts.tsx src/pages/Customers.tsx src/pages/SalesHistory.tsx
git commit -m "feat: 44px tap targets and safe-area sheet/overlay bottoms"
```

---

### Task 8: SalesHistory search input font

**Files:**
- Modify: `src/pages/SalesHistory.tsx` (search input `text-sm` → `text-base`)

- [ ] **Step 1: Bump the search input to 16px markup**

In `src/pages/SalesHistory.tsx`, find the search `<input>` (placeholder "Search product, customer...") with class `w-full h-10 pl-10 pr-4 bg-light harsh-border rounded-sm text-sm font-body` and change `text-sm` to `text-base`.

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: `✓ built`.

- [ ] **Step 3: Commit**

```bash
git add src/pages/SalesHistory.tsx
git commit -m "feat: 16px search input to avoid iOS zoom"
```

---

### Task 9: Manual verification

**Files:** none (manual). Use Chrome DevTools device mode (iPhone 14 Pro with notch) and/or a real device.

- [ ] **Step 1: Run the app**

Run: `npm run dev` and open on a notched-phone emulation.

- [ ] **Step 2: Receipt buttons**

Open a multi-item receipt (Sales History → tap a grouped sale). All five buttons (Print/WA/SMS/Save/Close) fully visible and tappable above the home indicator; if the receipt is tall, the card scrolls while the button row stays pinned; the bottom nav does not overlap them.

- [ ] **Step 3: Safe-area top**

Sales History, Settings, Dashboard headers are not hidden under the status bar/notch (there is inset padding above the title).

- [ ] **Step 4: Bottom nav**

Tab labels sit above the home indicator; nav is not clipped.

- [ ] **Step 5: Inputs**

Focus the Sales History search and a customer field — no zoom jump on iOS.

- [ ] **Step 6: Tap targets**

Cart steppers, trash, and modal close/back buttons are ≥44px and easy to tap.

- [ ] **Step 7: Regression (no insets)**

In a non-notched viewport (desktop / Android no gesture bar), layout is unchanged — `env(...)` resolves to 0, so no extra gaps. Existing flows (new sale, receipt, reports, inventory) still work.

- [ ] **Step 8: Final commit**

```bash
git add -A
git commit -m "chore: verify mobile hardening" --allow-empty
```

---

## Self-Review

**Spec coverage:**
- Viewport-fit → Task 1 ✓
- Safe-area utilities + 16px input rule → Task 2 ✓
- Z-index ladder (nav 40 / overlays 50 / sheets 60-61 / toast 70) → Tasks 3,4,5 ✓
- Nav safe-area + height → Task 3 ✓
- pt-safe headers → Task 5 ✓
- Receipt scrollable card + sticky safe footer + ≥44px buttons → Task 6 ✓
- 44px tap targets (steppers/trash/close) → Task 7 ✓
- Sheet/overlay safe-area bottoms → Task 7 ✓
- iOS input zoom (global rule + SalesHistory markup) → Task 2 + Task 8 ✓
- Keep user-scalable=no → Task 1 unchanged that flag ✓
- No data/logic change → only CSS/className edits ✓

**Deviation from spec (intentional):** the spec proposed a `pb-nav` utility and a blanket `pb-24 → pb-nav`. Analysis showed `pb-24` occurrences are either bottom-sheet footers or full-screen-overlay scroll regions; both need only `pb-safe`-style bottom inset (home indicator), not full nav-height clearance, because the sheets/overlays now paint *above* the nav. So `pb-nav` is dropped; footers/overlays use `pb-sheet` and the nav itself uses `h-nav` + `pb-safe`. In-flex tab-page paddings that already sit above the nav are left as `pb-24` (pure spacing). Goals are still met.

**Placeholder scan:** none — every code step gives the exact old/new class string and an explicit replacement count where a global replace is used.

**Consistency:** utility names `pt-safe`/`pb-safe`/`h-nav` defined in Task 2 are used verbatim in Tasks 3,5,6. Z values are consistent: nav `z-40`; overlays `z-50`; sheet backdrops `z-[60]`, panels `z-[61]`; toast `z-[70]`. The ReceiptModal panel `z-[61]` set in Task 4 Step 1 matches the panel edited in Task 6 Step 1. The 44px target classes (`w-11 h-11`, `h-11`) are consistent across Tasks 6 and 7.
