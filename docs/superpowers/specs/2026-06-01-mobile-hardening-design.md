# App-Wide Mobile Hardening — Design Spec

**Date:** 2026-06-01
**Status:** Approved
**Component scope:** `index.html`, `src/index.css`, `src/App.tsx`,
`src/components/BottomNav.tsx`, `src/components/ReceiptModal.tsx`, and the
full-screen overlay pages/modals that currently set their own z-index and
bottom padding.

## Problem

On mobile the ReceiptModal action buttons (Print / WhatsApp / SMS / Save /
Close) render **behind the bottom navigation bar** and are partly cut off. Root
cause: BottomNav is `z-[9999]` while ReceiptModal is `z-[110]`, so the nav paints
on top. Beyond that one bug, the app is not fully hardened for mobile:

- No `viewport-fit=cover`, so iOS `env(safe-area-inset-*)` is unavailable; the
  translucent status bar overlaps page headers and the home indicator overlaps
  the bottom nav.
- Z-index values are ad-hoc (`z-50/60/70/90/100/110/120/9999/10000`) with no
  ladder, so layering bugs recur.
- Some inputs use `text-sm` (14px); iOS auto-zooms when focusing an input under
  16px.
- A few tap targets are below the 44px minimum (e.g. `w-9 h-9` = 36px steppers).
- Scroll containers use a blanket `pb-24` that does not account for the home
  indicator.

## Goals

- Receipt action buttons fully visible on all phones (notch + home indicator).
- One coherent z-index ladder; nav never covers modals.
- Safe-area insets respected top and bottom on iOS and Android.
- All text inputs ≥16px (no iOS focus zoom).
- Interactive controls ≥44px.
- Applied app-wide through shared primitives, not per-screen redesign.

## Non-Goals

- No per-page visual redesign (no restyling Dashboard/Inventory/Reports content).
- No change to data, money math, or business logic.
- Keep `user-scalable=no` (pinch-zoom stays disabled, per decision).
- No new dependency; no Tailwind config plugin if a CSS utility suffices.

## Design

### 1. Viewport + PWA meta (`index.html`)

Change the viewport meta to add `viewport-fit=cover` (keeps zoom disabled):

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
```

This is the prerequisite that makes every `env(safe-area-inset-*)` below
resolve to non-zero on notched iOS devices. No other meta change.

### 2. Z-index ladder

Adopt one ladder and apply it. Tailwind arbitrary values are fine; the point is
the ordering, documented once here and in a comment in `index.css`:

| Layer | Class | Used by |
|-------|-------|---------|
| base content | (none / `z-10`) | page bodies |
| bottom nav | `z-40` | BottomNav wrapper (was `z-[9999]`) |
| page overlays | `z-50` | SalesHistory, Expenses, Customers wrapper, Settings overlay |
| sheets / modals | `z-[60]` (backdrop) / `z-[61]` (panel) | AddSaleSheet, ReceiptModal, BarcodeScanner, NotificationsSheet |
| toasts | `z-[70]` | Toast |

Concretely:
- `App.tsx`: bottom nav wrapper `z-[9999]` → `z-40`.
- `ReceiptModal.tsx`: backdrop `z-[100]` → `z-[60]`, panel `z-[110]` → `z-[61]`.
- `AddSaleSheet.tsx`: backdrop/sheet `z-50` → `z-[60]`/`z-[61]`.
- `BarcodeScanner.tsx`, `NotificationsSheet.tsx`: bring their backdrop/panel to
  `z-[60]`/`z-[61]` (currently `z-[60]/z-[70]/z-[120]` mix).
- `Toast.tsx`: ensure `z-[70]`.
- Page overlays (`App.tsx` Customers wrapper `z-40`, SalesHistory `z-[90]`,
  Expenses) normalize to `z-50`.

Result: every modal/sheet (≥60) paints above the nav (40); the receipt buttons
clear it. Page overlays (50) also cover the nav so their own chrome is used.

### 3. Safe-area utilities (`src/index.css`)

Add reusable utilities in the `@layer utilities` (new layer) / components area:

```css
@layer utilities {
  .pt-safe { padding-top: env(safe-area-inset-top); }
  .pb-safe { padding-bottom: env(safe-area-inset-bottom); }
  .h-nav  { height: calc(4rem + env(safe-area-inset-bottom)); }
  .pb-nav { padding-bottom: calc(5rem + env(safe-area-inset-bottom)); }
}
```

Apply:
- **Bottom nav** (`App.tsx` wrapper): height `h-16` → `h-nav`, and the inner
  `<nav>` gets `pb-safe` so icons/labels sit above the home indicator.
- **Page/overlay headers** that sit at the very top (SalesHistory header,
  Expenses header, Settings header, the Customers wrapper top bar): add
  `pt-safe` so they clear the translucent status bar / notch.
- **Scroll containers** currently using `pb-24`: replace with `pb-nav` so the
  last item clears nav + home indicator. (Search-and-replace `pb-24` → `pb-nav`
  in the overlay pages and Dashboard list region.)

### 4. ReceiptModal — scrollable card, sticky safe-area footer

Restructure the panel so the receipt body scrolls and the buttons are a pinned
footer that is always visible:

- Panel wrapper: `z-[61]`, `max-h-[calc(100dvh-2rem)]`, flex column.
- Receipt card region: `overflow-y-auto`, `no-scrollbar`, takes remaining
  height.
- Action buttons: move into a sticky footer inside the panel
  (`flex-shrink-0`), with `pb-safe` and a solid background, so they never hide
  behind the nav or the home indicator. Each button min height 44px
  (`h-12` → 48px is fine; keep `grid-cols-5`).
- Buttons stay outside the printed `.print-section` (keep `print-hide`).

The receipt content (line items, totals) is unchanged from the grouped-receipt
work; only the surrounding layout changes.

### 5. Tap targets ≥44px

- AddSaleSheet cart steppers and trash: `w-9 h-9` (36px) → `w-11 h-11` (44px).
- Close / back buttons at `w-10 h-10` (40px) → `w-11 h-11` (44px) where they are
  primary actions (modal/overlay headers).
- Leave the bottom-nav buttons (already full-height `h-nav`, wide) as is.

### 6. iOS input zoom guard (`src/index.css`)

Add a safety rule so no focused field triggers zoom, regardless of utility
class:

```css
@layer base {
  input, select, textarea { font-size: 16px; }
}
```

Also swap the stray `text-sm` on the SalesHistory search input to `text-base`
for visual consistency (the CSS rule already prevents the zoom, but keep markup
honest).

## Affected Files (summary)

- `index.html` — viewport-fit.
- `src/index.css` — safe-area utilities, 16px input rule, z-ladder comment.
- `src/App.tsx` — nav wrapper `h-nav` + `z-40`; overlay wrappers `z-50`;
  `pb-24` → `pb-nav`.
- `src/components/BottomNav.tsx` — `pb-safe` on `<nav>`.
- `src/components/ReceiptModal.tsx` — z, scrollable body, sticky `pb-safe`
  footer, 44px buttons.
- `src/components/AddSaleSheet.tsx` — z tokens, 44px steppers/trash, `pb-nav`
  sticky footer already present (adjust to `pb-safe`).
- `src/components/BarcodeScanner.tsx`, `NotificationsSheet.tsx`, `Toast.tsx` —
  z tokens.
- Overlay pages `SalesHistory.tsx`, `Expenses.tsx`, `Settings.tsx`,
  `Inventory.tsx`, `Reports.tsx`, `Debts.tsx`, `Customers.tsx` — `pt-safe` on
  top header, `pb-24` → `pb-nav` on scroll region, z normalize where they set it.

## No-Break Guarantees

- Pure layout/CSS changes; no data, store, or money-math touched.
- Z-ladder preserves relative ordering (modals above nav above content) — only
  the absolute numbers change.
- Safe-area utilities resolve to `0` on devices without insets (Android without
  gesture bar, desktop) → no visual regression there.
- `user-scalable=no` retained.

## Testing / Verification

No unit-test runner; verification = `npm run build` + `npm run lint` + manual on
device/emulator:

- **Receipt:** open a multi-item receipt on a notched iPhone (or DevTools iPhone
  + "Show device frame"): all 5 action buttons fully visible above the home
  indicator; receipt body scrolls if tall; nav does not overlap.
- **Safe area top:** page headers (Sales History, Settings) not hidden under the
  status bar/notch.
- **Nav:** tab labels sit above the home indicator on iPhone; nav not clipped on
  Android gesture-nav.
- **Inputs:** focusing the Sales History search / customer fields does not zoom
  on iOS.
- **Tap targets:** cart steppers, trash, close buttons are comfortably tappable
  (≥44px).
- **Regression:** desktop/Android-without-insets layout unchanged; all existing
  flows (sale, receipt, reports) work.
