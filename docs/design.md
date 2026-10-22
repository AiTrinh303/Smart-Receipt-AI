# Design system

Design tokens live in `frontend/tailwind.config.js` (`theme.extend.colors`) and
shared components live in `frontend/src/components/ui/`. Components must use
these tokens, never hardcoded hex colors.

## Palette (with contrast checked against white `#ffffff` / token `surface`)

| Token            | Hex       | Use                          | Contrast vs white |
| ---------------- | --------- | ----------------------------- | ------------------ |
| `brand`          | `#4f46e5` | Primary actions, links, focus | 5.5:1              |
| `brand-hover`    | `#4338ca` | Primary hover state           | 7.1:1              |
| `brand-soft`     | `#eef2ff` | Info background               | — (background)     |
| `ink`            | `#0f172a` | Primary text                  | 17.9:1             |
| `ink-muted`      | `#475569` | Secondary/helper text         | 7.6:1              |
| `border`         | `#64748b` | Borders, dividers             | 4.76:1 (non-text)   |
| `success`        | `#15803d` | Success text/icons            | 5.1:1              |
| `success-soft`   | `#f0fdf4` | Success background            | — (background)      |
| `warning`        | `#a16207` | Warning text/icons            | 5.4:1              |
| `warning-soft`   | `#fefce8` | Warning background            | — (background)      |
| `danger`         | `#b91c1c` | Error text/icons              | 6.1:1              |
| `danger-soft`    | `#fef2f2` | Error background              | — (background)      |

All text-on-background combinations above meet WCAG AA (4.5:1 for normal
text). A disabled `Button` uses `slate-300`/`slate-600` text, which still
meets 4.5:1.

## Changelog

- **`border` darkened from `#cbd5e1` (slate-300) to `#64748b` (slate-500).**
  The old value measured 1.48:1 against white — far below the 3:1 WCAG
  minimum for UI component borders — which is why cards, the dropzone and
  inputs "barely separated from the page" in practice. `#64748b` measures
  4.76:1. This one token change fixes contrast everywhere it's used
  (`Card`, `Button` secondary, the dropzone, the file-row border, inputs)
  without touching each component.
- **`Card` shadow raised from `shadow-sm` to `shadow-md`** for a clearer lift
  off the page background, on top of the stronger border.
- **Nav active-tab style**: the active tab previously relied on a very
  light `bg-brand-soft` tint (`#eef2ff`, only ~1.1:1 against white) as its
  only visual cue — essentially invisible in a screenshot. It's now `text-brand`
  (6.3:1) + `font-semibold` + a 2px `border-brand` bottom border (inactive
  tabs keep a same-height transparent border so nothing shifts), so the
  state is conveyed by weight and shape as well as color, not color alone.
  Separately, `aria-current` was being computed from the `?view=` query
  param alone, so opening a saved receipt (`?receipt=<id>`, which renders
  the same `upload` view component) left the "Upload" tab marked current
  even though the person isn't on the plain upload screen. Fixed by
  deriving the active tab from an explicit `upload | history | null`
  state instead of the raw view, so a receipt-detail view marks neither
  tab.
- **Logo mark**: replaced a 15%-opacity outline icon (read as grey) with a
  solid `fill-brand` rounded square and a white glyph, so the brand color
  is actually visible in the header.
- **Dropzone**: added a `hover:border-brand hover:bg-brand-soft` state (it
  already used a brand-colored icon and `border-brand`/`bg-brand-soft` on
  drag-over); the OpenAI/local-storage note moved inside the upload
  `Card`, under the submit button, with a small info icon, instead of
  sitting below the card as unstyled body text.

## Type scale

- Page title: `text-2xl font-bold`
- Section heading: `text-lg font-semibold`
- Body text: `text-sm` / `text-base`
- Helper/muted text: `text-sm text-ink-muted`

## Spacing

- Use Tailwind's default spacing scale (4px steps). Stack related elements
  with `gap-2`/`gap-3`/`gap-4`; separate sections with `gap-6`/`gap-8`.
- Page content sits in a centered container (see `Container` in the app
  shell) with `px-4` on mobile and more breathing room on larger screens.

## Components (`src/components/ui/`)

- **`Button`** — variants `primary` (main action), `secondary` (alternate
  action), `danger` (destructive), `ghost` (low-emphasis/text-like action).
  Supports `size` (`sm`/`md`), `loading` (shows `Spinner` + optional
  `loadingText`), and standard `disabled`. All sizes keep a 44px minimum
  touch target on small screens.
- **`Card`** — a bordered, padded, white surface for grouping content (forms,
  dropzones, confirmation panels).
- **`Alert`** — variants `info`/`success`/`warning`/`error`. `error` renders
  `role="alert"` (interrupts screen readers); the others render
  `role="status"` (polite). Never relies on color alone — pair with text.
- **`Spinner`** — an inline SVG spinner with an `aria-label` for in-flight
  states.
- **`formatFileSize`** — formats a byte count as `B`/`KB`/`MB`/`GB` for
  display next to a selected file.

## Accessibility rules

- Every interactive element has a visible `focus-visible` ring.
- Minimum 44px touch target height for buttons on small screens.
- Never use color alone to convey state (pair with text/icon).
- All normal text meets WCAG AA contrast (4.5:1).
