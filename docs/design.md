# Design system

Design tokens live in `frontend/tailwind.config.js` (`theme.extend.colors`) and
shared components live in `frontend/src/components/ui/`. Components must use
these tokens, never hardcoded hex colors.

## Checking a visual change

Open `?view=styleguide` in a local `npm run dev` session (e.g.
`http://localhost:5173/?view=styleguide`) to see every `Button` variant
(enabled, disabled, loading), every `Alert` variant, the nav tab's active and
inactive states, the logo mark, the `RadioCardGroup` apartment choice on the
upload form (none chosen / chosen / loading / failure), the `ReceiptApartment`
control on a saved receipt (selected / none selected / saving / saved /
error), the review-status controls on a saved receipt
(needs review / approved / saving / approval blocked), the
history row's apartment/status badges, the history view's
apartment tab bar and year/status filter selects (all apartments
selected / one apartment selected), the Items view's table/card/empty/
error/loading/"Show more" states, the
dropzone's idle/drag-over/file-selected states, and a `Card`, all at once,
with static sample data and no network calls. It's dev-only (gated on `import.meta.env.DEV`, via the mockable
`src/env.ts`), not linked from the header, and excluded from production
builds (`npm run build` and grep `dist/assets/*.js` for "StyleGuide" to
confirm after changing anything about how it's wired in). After any visual
change, look at this page, and also see "Verified against the real built
CSS" below -- jsdom's 100+ passing tests say nothing about layout or color.

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

## Verified against the real built CSS

The values above are also checked mechanically, not just by eye:
`src/components/ui/Button.contrast.test.ts` resolves the actual merged
Tailwind theme (`resolveConfig`) for every token in `Button.tsx`'s
`VARIANT_COLOR_TOKENS` (the single source of truth for each variant's
enabled-state colors) and for the full palette above, and asserts each
resolves to a real hex color (catching an invalid/undefined/empty token —
the specific failure mode that produces an invisible element a real
browser shows but jsdom cannot) and that every variant's text/background
(or text/border, for a no-fill variant) pair meets its required contrast
ratio. As of this check, every `Button` variant passes:

| Variant        | Background | Text    | Border   | Text/bg contrast |
| -------------- | ---------- | ------- | -------- | ----------------- |
| `primary`      | `brand`    | `white` | —        | 6.29:1 (fill)      |
| `secondary`    | `white`    | `ink`   | `border` | 17.85:1 (fill)     |
| `danger`       | `danger`   | `white` | —        | 6.47:1 (fill)      |
| `ghost`        | none       | `brand` | `brand`  | 6.29:1 (vs. page); border 6.29:1 (vs. page) |
| `danger-ghost` | none       | `danger`| `danger` | 6.47:1 (vs. page); border 6.47:1 (vs. page) |

`ghost`/`danger-ghost` gained a matching-color border (they previously had
`bg-transparent` and no border — visible only via their text color, which
doesn't satisfy "every variant has a clearly visible background or
border").

Also confirmed directly against a `npm run build` output (not just the
Tailwind config): `.bg-brand`, `.text-white`,
`hover\:bg-brand-hover:hover`, `disabled\:bg-slate-300:disabled`,
`.fill-brand`, `.border-brand`, `.bg-danger`, `.bg-white`, and the new
`.border-danger` all compile to real, distinct, non-conflicting
`background-color`/`color`/`border-color`/`fill` declarations — i.e. a
visual bug report describing an invisible enabled primary button could
not be reproduced from this codebase's current source or build output.
See the "Invisible button investigation" entry in the Changelog below for
the full trail of evidence.

## Mobile-friendly patterns

- **Items as cards below `sm`.** `ReceiptResult` renders the items table from
  the `sm` breakpoint up, and below it (via `useMediaQuery('(max-width:
  639px)')`, `src/hooks/useMediaQuery.ts`) a list of cards instead -- never
  both. The hook returns `false` when `window.matchMedia` doesn't exist
  (jsdom's default here), so it falls back to the table and existing tests
  never need to mock it. The currency code is shown once per amount label
  (e.g. "Unit price (USD)"), the same convention the table already used,
  rather than repeated in each value.
- **Image preview, with real cleanup.** After a JPG/PNG passes validation,
  `ReceiptUpload` shows a thumbnail via `URL.createObjectURL` (PDFs keep the
  file icon; an invalid file is never previewed). The one rule that matters
  here: revoke the previous object URL *before* creating or discarding the
  next one, so there is at most one live URL at a time -- on Remove, when a
  new file replaces the old one, after "Upload another receipt", and on
  unmount (tracked via a ref, so the unmount cleanup sees the latest URL
  rather than a stale closure from the render that scheduled it). jsdom
  implements neither `URL.createObjectURL` nor `URL.revokeObjectURL` --
  `src/test/objectUrl.ts` is an explicit per-test-file mock (never a global
  polyfill), so a test suite that forgets to add it fails loudly.
- **Skeleton loading states.** `src/components/ui/Skeleton.tsx` is a plain
  `animate-pulse` block (`motion-reduce:animate-none`, `aria-hidden` --
  purely decorative). Every loading area is a `role="status"
  aria-busy="true"` region that still contains the exact original loading
  string (visible or `sr-only`) alongside the skeleton blocks, so existing
  text-based tests and screen readers both keep working; the whole region
  unmounts (and `aria-busy` disappears with it) once loading ends.

## Data quality: warnings, the Edited badge and reset

- **Warnings panel.** When a receipt's `warnings` array is non-empty,
  `ReceiptResult` renders an `Alert variant="warning"` (so `role="status"`)
  above the data card, titled "Check these values", with a warning icon
  plus a bulleted list of each `message` — never color alone. Empty
  `warnings` renders nothing. Warnings never block Edit, Delete, Reset, or
  anything else.
- **Edited badge.** A small `warning`-toned pill reading "Edited" sits next
  to the store name whenever `edited` is `true`, with `edited_at` in its
  `title` attribute. It disappears the moment a response comes back with
  `edited: false` (a re-extract, or a successful reset).
- **Reset to AI result.** In the surrounding container (not inside
  `ReceiptResult`), a secondary "Reset to AI result" button appears only
  when `edited` is `true`, separated from the danger-ghost Delete button
  (opposite ends of the same row) since the two don't belong together.
  Clicking it shows an in-page confirmation (an `Alert variant="warning"`,
  the same pattern as the delete confirmation but non-destructive in tone)
  — nothing is sent until "Yes, reset"; a pending request shows
  "Resetting..." with every button in that panel disabled; success swaps
  in the response data directly (no extra `GET`); failure keeps the
  current (edited) data on screen with the error shown, so the user can
  retry. Hidden while the edit form is open. Never calls extract or PUT.
- **Edit form date prefill.** `ReceiptEditForm` has its own
  `extractLeadingIsoDate()`, mirroring the backend's
  `normalize_purchase_date` (same leading-ISO-date-plus-one-separator
  rule). A stored date that isn't itself ISO but starts with one (e.g.
  `"2025-06-26 11"`) prefills the `<input type="date">` with just the
  leading date — never the raw text, which the server would reject as
  `purchase_date` — and shows no "Original: ..." hint. Only a date with no
  extractable leading ISO date at all keeps the plain text input plus the
  hint.

## Apartment choice on the upload form

- **`RadioCardGroup` above the dropzone, nothing preselected.** `useApartments`
  (`src/hooks/useApartments.ts`) fetches `GET /apartments` once per session —
  a *successful* result is cached at module scope (so "Upload another
  receipt" never re-fetches it), but a failure is never cached, so `retry`
  (or a later mount) tries again. It's only fetched at all while the plain
  upload form is what's about to render (never while reopening, showing, or
  failing to load a saved receipt by id).
- **Three states above the dropzone**: loading ("Loading apartments..." in a
  `role="status" aria-busy="true"` region with two `Skeleton` blocks sized
  to the card shape), failure (`Alert variant="error"` + a "Retry" button,
  "Read receipt" impossible either way since there's nothing to choose), or
  the loaded `RadioCardGroup` itself.
- **Submit needs a file *and* a choice.** "Read receipt" stays disabled
  until both are present; with a valid file but no apartment chosen yet, a
  muted "Choose an apartment to continue." hint appears, tied to the
  `fieldset` via `aria-describedby`.
- **The choice is session-scoped component state, not persisted** — it
  survives Remove, picking a new file, and "Upload another receipt" within
  the same visit (most receipts uploaded in one sitting are for the same
  apartment), but resets on a real page reload like every other upload-form
  field.
- **`uploadReceipt(file, apartmentId)`** sends `apartment_id` as a second
  `FormData` field alongside `file`.

## Upload screen polish: readable apartment cards, helper text, tips

A follow-up pass after real use (uploading up to 20 receipts at once) found
the upload form's apartment cards and helper text didn't scale: long
apartment names wrapped over 3 lines, the legend always said "this
receipt" even with a dozen files queued, and a disabled "Read receipt"
button with no file selected gave no explanation.

- **`RadioCardGroup` gained an optional second line.** `RadioCardOption`
  now accepts `secondaryLabel` (an optional muted second line) and
  `accessibleName` (overrides the card's accessible name/tooltip, falling
  back to `label` when omitted) alongside the existing `label`. The `<input
  type="radio">` always gets an explicit `aria-label={accessibleName ??
  label}`, so the accessible name never depends on what's actually visible
  on the card -- necessary once the visible text is a shortened name rather
  than the full one. `ReceiptApartment.tsx` and the `StyleGuide` samples
  pass only `label` (no `secondaryLabel`/`accessibleName`), so their
  behavior is byte-for-byte unchanged.
- **Apartment cards show `apartmentShortName` (bold) + `apartmentPlace`
  (muted second line).** `src/format/apartmentPlace.ts` is a new,
  deliberately narrow sibling to `apartmentShortName`: it returns the
  *middle* `" - "`-separated segment of a name with **exactly** 3 such
  segments (e.g. `"Fewo JoJo - Sankt Englmar - Waldglück"` ->
  `"Sankt Englmar"`), and `null` for anything else (no separator, 2
  segments, 4+ segments, or a blank middle segment) -- rather than
  guessing at a "place" that isn't unambiguously there. The upload form's
  `RadioCardGroup` options are built as `{label: apartmentShortName(name)
  ?? name, secondaryLabel: apartmentPlace(name), accessibleName: name}`,
  so the full name is always on the card's `title` (via the wrapping
  `<label>`'s own `title` attribute) and always the radio's accessible
  name, even when the two visible lines don't literally concatenate back
  to it.
- **Plural legend with 2+ files queued.** The legend reads "Which
  apartment is this receipt for?" with 0 or 1 file (the single-file flow),
  and "Which apartment are these receipts for?" the moment a batch is
  active (2+ files) -- a single-word, purely cosmetic switch keyed off the
  same `isBatchActive` flag the rest of the batch UI already uses.
- **"Choose a file to continue." helper.** Mirroring the existing "Choose
  an apartment to continue." helper (shown when a file is picked but no
  apartment is chosen), a new helper appears the other way around: once an
  apartment is chosen but no file (and no batch) is queued, a muted
  "Choose a file to continue." sits under the disabled "Read receipt"
  button, tied to it via `aria-describedby`. Both helpers can never show
  at once, since each requires the other's precondition to be *missing*.
- **Collapsible reading tips.** A native `<details>`/`<summary>` ("Tips for
  better reading") sits under the dropzone/camera button, closed by
  default, listing: lay the receipt flat, use good light, keep the whole
  receipt in frame including the total, one receipt per photo. Plain
  `<details>` needs no new dependency or JS state, and starts collapsed so
  it doesn't push the dropzone further down the page for a returning user
  who already knows the tips.

## Changing the apartment on a saved receipt, and the history badge

- **`ReceiptApartment.tsx`**, rendered by the saved-receipt container (the
  same place used right after extraction and when reopening
  `?receipt=<uuid>`) directly above the data card -- `ReceiptResult` itself
  is untouched. The same `RadioCardGroup`, legend "Apartment" this time,
  with the receipt's current apartment selected (or nothing selected, with
  no extra message, when it's `null`). Choosing another card sends
  `PUT /receipts/{id}/apartment` (`src/api/updateReceiptApartment.ts`, same
  `ApiError` pattern as the other mutating calls): "Saving..." and the
  group disabled while pending; success swaps in the response directly (no
  extra `GET`) and shows "Saved" in a `role="status"`; failure shows an
  `Alert variant="error"` and reverts the radio to the previous selection,
  so retrying is just picking it again. Hidden while the edit form is open
  (it's rendered only in the non-editing branch); never calls extract or
  the plain `PUT /receipts/{id}`.
- **History badge.** `ReceiptHistory.tsx` shows each row's
  `apartment_name` as a small pill (a building icon + the name, `bg-brand-
  soft`/`text-brand`, matching the nav/edited-badge pill pattern elsewhere);
  `null` (or a missing field, for pre-migration data) renders as plain
  muted "Not assigned" text instead of a badge -- never a broken pill. No
  filtering by apartment.

## Review status on a saved receipt, and the history badge

- **`ReceiptReviewStatus.tsx`** (renamed from `ReceiptClassification.tsx`
  when the expense-category feature was removed -- see
  [docs/adr/0004-remove-categories.md](docs/adr/0004-remove-categories.md)
  -- it now holds only the status control, mechanically unchanged
  otherwise), rendered by the saved-receipt container directly next to
  `ReceiptApartment` -- `ReceiptResult` itself is untouched, and the whole
  control is hidden while the edit form is open. A `StatusBadge`
  (`src/components/ui/StatusBadge.tsx` -- shared with the history list
  below) shows "Needs review" (`bg-warning-soft`/`text-warning`, a clock
  icon) or "Approved" (`bg-success-soft`/`text-success`, a check icon) --
  status is never conveyed by color alone. A primary "Mark as approved"
  button shows when `needs_review`; a secondary "Back to needs review"
  button shows when `approved`. Both call `PUT /receipts/{id}/status`
  (`src/api/updateReceiptStatus.ts`); while pending, "Saving..." shows and
  the button is disabled (not hidden). If approving fails with a `422` and
  a `missing` list (see `ApiError.missing`, which the response parser
  keeps specifically for this), an `Alert variant="error"` shows a
  plain-words message built from that list (e.g. "To approve this
  receipt, also set: apartment, a valid purchase date."), the `date` code
  adds "You can fix the date with Edit.", and the status stays unchanged.
  Any unrecognized code in `missing` (e.g. a stray `"category"` from an
  older cached response) is silently dropped rather than shown raw or as
  "undefined". Never calls extract or the plain `PUT /receipts/{id}`.
- **History badge.** Each `ReceiptHistory.tsx` row shows the same
  `StatusBadge` used on the saved-receipt view, next to the apartment
  badge.

## Splitting the history by apartment, with filters

- **Apartment tab bar.** `ReceiptHistory.tsx`'s top follows the WAI-ARIA
  tabs pattern: `role="tablist"` (`aria-label="Apartment"`) containing one
  `role="tab"` per apartment plus a leading "All apartments (N)" tab, each
  labelled with its live count from `GET /receipts/facets`. The selected
  tab gets `aria-selected="true"`, `tabIndex={0}`, and bold text plus a
  white background/shadow against the `slate-100` tab-bar background --
  never color alone. Every other tab is `tabIndex={-1}` (roving tabindex);
  arrow keys / Home / End move the selection and immediately navigate
  (automatic activation), and a small `sessionStorage` handoff
  (`receiptHistoryFocusTabIndex`) restores keyboard focus to the newly
  selected tab across the full remount that navigating causes (see below)
  -- without it, the arrow-key interaction would silently drop focus back
  to the document body every time. Each tab button has a 44px minimum
  touch target and the tab bar wraps on narrow screens.
- **Filter selects.** Below the tabs, two native `<select>`s with visible
  `<label>`s -- "Year" (All years, each year from the facets descending,
  plus "No valid date" *only* when the facets say `has_undated`) and
  "Status" (All, Needs review, Approved). They stack in a column below
  `sm` and sit in a row from it. (A third "Category" select existed here
  before the expense-category feature was removed -- see
  [docs/adr/0004-remove-categories.md](docs/adr/0004-remove-categories.md).)
- **State lives in the URL**, not component state:
  `?view=history&apartment=<id>&year=<v>&status=<v>`. An old link or
  bookmark containing `&category=...` is simply ignored -- that param is
  never read. Changing a tab or select calls the existing `navigateTo()`
  helper, which `pushState`s the new URL and dispatches a synthetic
  `popstate` -- `App.tsx` already keys `<ReceiptHistory key={locationKey}
  />` on `location.search`, so this **fully remounts** `ReceiptHistory`
  (same mechanism `ReceiptUpload` already relies on), and the remount
  re-fetches facets/the list fresh from the new URL. Nothing here needed a
  new effect-driven "re-fetch when filters change" path -- the existing
  remount-on-navigate architecture already provides it.
- **Validating URL values ("ignored" vs. "applied with zero results"):** a
  structurally invalid value (`year` not matching `/^\d{4}$/` and not
  `"none"`, or `status` outside the two allowed values) is dropped
  entirely with no network round trip. A referentially invalid value
  (`apartment` not among the ids the facets call actually returned) is
  also dropped, but only after that lookup -- this distinguishes "the id
  doesn't exist" (ignored) from "the id exists but matches nothing" (a
  legitimate filter that correctly shows zero results). `GET
  /receipts/facets` is called unscoped first (always needed for the tab
  bar), which doubles as the apartment-id validation source; a second,
  scoped call (`?apartment_id=...`) only fires when that apartment turns
  out to be valid, to get the Year select's options correctly limited to
  that apartment.
- **Row count and Clear filters.** `role="status"` shows "N receipts" (the
  list response's own `count`). A "Clear filters" button appears only
  when a year/status select is actually active (not just an apartment
  tab) and clears those two while leaving the apartment tab untouched,
  per spec. The plain "No receipts yet..." empty state is reserved for
  the truly unfiltered case (All apartments tab, nothing else active);
  any other empty result shows "No receipts match these filters."
  instead, using the same "Clear filters" button above it rather than a
  duplicate.
- **Apartment badge visibility.** Inside a specific apartment's tab, that
  row's own apartment badge is hidden (it would just repeat the tab
  already selected); in "All apartments" it shows as before. The status
  badge always shows.
- **Returning from a filtered list.** Opening a receipt from a tab/filter
  other than the plain unfiltered view attaches `&from=<encoded search>`
  to the `?receipt=<id>` URL (never for the plain case, so that URL shape
  is unchanged); `ReceiptUpload.tsx`'s "Back to history" link reads that
  `from` value (only trusting one that starts with `?view=history`) so it
  returns to the same tab and filters instead of always resetting to the
  unfiltered list. The real browser Back button needs no special
  handling, since every tab/filter change is a real `pushState` entry.

## Items view: a flat, searchable table of purchased line items

- **`ReceiptFilters.tsx`** -- the apartment tab bar and the Year/Status
  selects were extracted out of `ReceiptHistory.tsx` into this shared,
  presentational component (props in, `onSelectApartment`/`onYearChange`/
  `onStatusChange` callbacks out -- no fetching, no URL-building of its
  own) specifically so the new Items view could reuse the exact same
  markup/keyboard behavior without duplicating it, while every existing
  `ReceiptHistory` test keeps passing unchanged (confirmed by running them
  after the extraction, byte-for-byte the same assertions). It also owns
  the tab bar's keyboard navigation (arrow keys/Home/End) and the
  focus-restore-after-remount behavior (a `sessionStorage` key, passed in
  as `focusSessionKey` so History and Items each use their own key and
  don't fight over the same slot), plus the shared `effectiveYear`/
  `effectiveStatus` URL-value validators both pages import from here. The
  two pages still each build their own tab *labels* (History's include a
  receipt count per apartment; Items' deliberately don't -- see below) and
  still each own their URL-reading/building and data-loading.
- **`ReceiptItems.tsx`** (`?view=items`, a third header nav link
  "Items", same `aria-current`/`document.title` ("Items · Smart Receipt
  AI") treatment as the other two tabs) lists every purchased line item
  (not receipts) via `GET /items`, reusing `ReceiptFilters` for the
  apartment tabs and Year/Status selects exactly as `ReceiptHistory` does,
  plus its own search box ("Search items or stores", `maxLength={100}`,
  Enter or a "Search" button submits, a "Clear" button appears once text
  is typed). All of it lives in the URL --
  `?view=items&apartment=<id>&year=<v>&status=<v>&q=<v>` -- so Back/
  Forward and reload all work, and an invalid/unknown value (malformed
  year, unrecognized status, or a `q` over 100 chars) is dropped rather
  than erroring, the same "ignored" spirit as History's own filters.
  Changing any filter or the search always requests from `offset=0` (a
  fresh page), since the URL param change fully remounts the component --
  there's no separate "reset paging" state to get out of sync.
- **Tab labels carry no counts.** `GET /receipts/facets`'s counts are
  *receipt* counts, not *item* counts, so showing them on the Items tabs
  would silently lie about how many rows that tab actually has; Items
  builds its tabs as plain `{id, label: a.name}` (no `(N)` suffix) from
  the same facets response History uses for `{id, label: `${a.name} (${a.count})`}`.
- **Table (from `sm` up) vs. cards (below it), via `useMediaQuery`** --
  same pattern as `ReceiptResult.tsx`'s items table, never both variants
  mounted at once. Columns: Date, Item, Qty, Unit price, Line total,
  Store, Apartment -- shown **only** in the "All apartments" tab (a
  specific apartment tab already tells you the apartment, so repeating it
  in every row would be redundant, mirroring History's own
  apartment-badge-hidden-in-one-tab rule) -- and Status. Numbers are
  right-aligned, `tabular-nums`, `whitespace-nowrap`. Amounts use the
  existing `formatMoney` helper **with each row's own currency included**
  (e.g. "EUR 4.99", not just "4.99") -- unlike `ReceiptResult.tsx`'s
  per-receipt table (one currency, shown once in the column header), rows
  here can come from receipts in different currencies, so the currency
  has to travel with every amount. A missing value in any column shows
  `MissingValue` (a dash plus hidden "Not detected") rather than the
  plain visible words -- see the "Redesign for scanning and auditing"
  section below for the full readability pass over this table.
- **The item name is a real link** to `?receipt=<receipt_id>` (not a
  button, so it's keyboard- and screen-reader-navigable like any other
  link), reusing the exact same `from`-param mechanism History's rows
  use. `ReceiptUpload.tsx`'s back-link logic (`getBackNavigation()`,
  renamed from `getHistoryReturnSearch()`) now branches on whether `from`
  starts with `?view=items` or `?view=history`, showing "Back to items"
  or "Back to history" accordingly -- History's own back-link behavior
  and label are completely unchanged for its own case.
- **Pagination: "Show more", not infinite scroll or page numbers.**
  `GET /items` is called with `limit`/`offset`; the view shows "`N` of
  `TOTAL` items" (`role="status"`) and, while `count < total`, a "Show
  more" button that requests the next page (`offset = count`) and
  **appends** the new rows to the ones already shown (never replaces
  them) -- the button disables itself while that request is in flight. A
  failed "Show more" leaves every already-shown row in place and surfaces
  an `Alert variant="error"` plus its own "Retry" button, scoped to just
  that failure (the already-rendered table/cards are never torn down over
  a pagination failure).
- **Race safety.** Every list-affecting fetch (the main load's facets +
  items calls, and "Show more") is tagged with a shared, monotonically
  increasing request id (`requestIdRef`); a response is only applied if
  its id still matches the latest one issued, so a reply to a request
  that's no longer the newest one in flight is silently dropped instead
  of overwriting state a newer request already set. In practice this
  mostly layers on top of the same per-mount `cancelled`-closure pattern
  `ReceiptHistory` already relies on (a filter/search change is a full
  remount, whose cleanup already discards an in-flight response from the
  component instance being replaced) -- the explicit request id is what
  additionally protects "Show more", the one fetch that isn't driven by
  that per-mount effect. Covered by a dedicated test that starts an older
  request, lets a newer one (from a later mount) resolve first, and then
  resolves the older one -- proving its result never clobbers the newer,
  already-displayed one.
- **Loading/error/empty states** follow the same shape as `ReceiptHistory`:
  a `role="status" aria-busy="true"` region with "Loading items..." (kept
  in the DOM, with `Skeleton` rows) while the first page loads; an
  `Alert variant="error"` + "Retry" on failure; "No items yet. Upload a
  receipt." when truly unfiltered, or "No items match these filters." +
  a "Clear filters" button (resets year/status/search, keeps the selected
  apartment tab, same spirit as History's own `Clear filters`) otherwise.
- **Out of scope, per the ticket:** no sums/totals, no grouping or merging
  of similar item names, no reports or CSV export, no sort options (added
  later -- see "Sorting the Items view" below), no new dependencies, no
  backend changes.

## Redesigning the Items table for scanning and auditing

A follow-up pass after real use (managing receipts for two holiday
apartments, preparing a tax declaration) surfaced several readability
problems with the first Items table: mixed/localized date formats, long
titles wrapping to 4-5 lines, the full apartment name repeating on 3 lines
per row, no visible review status, every item name a noisy underlined
blue link, "Not detected" drawing more attention than real data, and
~260px of filter UI before the first row. This section documents the
fixes; the display helpers it leans on (`formatDisplayDate`,
`apartmentShortName`, `MissingValue`, `ClampedText`) are documented above.

- **Dates: `formatDisplayDate` only, never a raw string.** The Date
  column (and the cards' combined "date · store" line) calls
  `formatDisplayDate(row.purchase_date)` and renders one of three ways:
  a valid date shows its fixed `DD.MM.YYYY` text; an unrecognized,
  non-blank value shows the **raw stored text** next to a small warning
  icon, with `title="This date could not be read as a valid date. Open
  the receipt and fix it with Edit."` and a visually hidden "Date not
  recognized" (so the problem is both seen and announced, never silently
  swallowed -- the user still needs to *see* the odd value to recognize
  and fix it); `null`/blank renders `MissingValue`. This replaces the
  previous behavior of printing `purchase_date` completely raw (no
  validation, no visual distinction for an unparseable value).
- **Short apartment names, as a badge.** The Apartment column (and the
  card badge row) renders `apartmentShortName(row.apartment_name)` inside
  a small outlined pill (`border-border`, `text-ink`, `truncate`), with
  the **full** name in its `title` (recoverable on hover) -- replacing
  three lines of wrapped full name (e.g. "Fewo JoJo - Sankt Englmar -
  Waldglück") with one short word ("Waldglück") per row. A `null` name
  shows `MissingValue`.
- **Review status, now visible.** A new Status column (table) / badge
  (cards) renders the existing `StatusBadge` (icon + text, "Needs
  review"/"Approved" -- never color alone, same component History and
  the saved-receipt view already use) for every row, since review status
  decides what goes into the tax report and was previously not shown
  here at all. A `null`/unrecognized status value shows `MissingValue`
  rather than guessing.
- **Quieter item names.** The link to `?receipt=<id>` changed from
  brand-colored + underlined (visually noisy at table scale, one in
  every row) to **dark text with an always-visible underline**, turning
  brand-colored only on hover/`focus-visible` -- still unambiguously a
  link (the underline never disappears), just not shouting over the
  data next to it. Long titles (100+ characters) are wrapped in
  `ClampedText` (2 lines) instead of wrapping freely down the row; the
  full title stays in `title` and in the DOM. A `null` name renders
  `MissingValue` as the link's own content instead of empty/placeholder
  text. The Store cell uses the same `ClampedText` treatment at 1 line.
- **Quieter missing values.** Qty, Unit price, Line total, Store,
  Apartment, Date and Status each render `MissingValue` instead of the
  plain visible words "Not detected" when the value is absent --
  `MissingValue`'s dash reads as "nothing here" at a glance instead of
  drawing the eye like a sentence would, while the exact "Not detected"
  text is still present (visually hidden) for anything that queries for
  it.
- **Fixed column widths, no wrapping on the key columns.** The table is
  `table-fixed` with an explicit width on every column except Item
  (`w-24` Date, `w-16` Qty, `w-24` Unit price, `w-24` Line total, `w-40`
  Store, `w-28` Apartment, `w-28` Status), so Date and every numeric
  column stay `whitespace-nowrap` and never wrap; Item absorbs whatever
  width is left over. The `overflow-x-auto` wrapper from the first
  version stays, as a safety net for narrower viewports, but the explicit
  widths mean it shouldn't be needed at 1024px and up. Rows use `py-2`
  (a touch more breathing room than the original `py-1`), a light
  `border-border/40` divider, and `hover:bg-slate-50` -- no zebra
  striping; header text is `text-ink-muted font-medium`, not bold black.
- **A summary bar above the table**, not just the plain "N of TOTAL
  items" status line below it (which stays, unchanged, on the left of
  this same bar). On the right: a plain-text summary of whichever
  filters/search are actually active, built as an ordered list of parts
  (apartment short name, year or "No valid date", the Status option's
  label, and `"query"` in quotes) joined with ` · `, omitting any part
  that isn't set -- e.g. `Waldglück · 2026 · Approved · "milch"` -- plus
  the existing "Clear filters" button, shown under the same rule as
  before (anything besides the apartment tab is active). This reuses the
  exact same `effectiveYear`/`effectiveStatus`/`STATUS_OPTIONS` values
  already computed for the selects, so the summary can never drift from
  what's actually filtering the list.
- **Filters on one row from `md` up.** `ReceiptFilters.tsx` gained an
  optional `extraFilter` slot (a `ReactNode`, rendered after Year/Status
  in the same flex row) specifically so Items' search box could join
  Year and Status on one line instead of sitting in its own row below
  them. The row's own responsive class only switches to `md:flex-row`
  (and the two selects only get a fixed `md:w-48`) **when `extraFilter`
  is provided** -- `ReceiptHistory` never passes it, so its markup/classes
  are byte-for-byte identical to before (`sm:flex-row`, `flex-1` selects),
  confirmed by every existing `ReceiptHistory` test passing unchanged
  after this change. Below `md`, both pages still stack their controls
  exactly as before.
- **Cards (below `sm`)** show the same name link (2 lines), a muted
  "`date` · `store`" line (each side using the same `DateCell`/missing
  handling as the table), an amount line that keeps the words "Qty",
  "Unit price" and "Line total" as plain text next to each value (cards
  have no column headers to label them), and a row of badges (the
  apartment short-name pill, shown only in "All apartments", and the
  status badge) -- still only one of table/cards ever mounted at once,
  via the same `useMediaQuery` check as before.

## Sorting the Items view

`GET /items` gained a `sort` parameter (see backend docs/README for the
five allowed values and their tie-breakers); the frontend surfaces this as
a "Sort by" `<select>` with a visible label, joining the search box in the
`extraFilter` slot (`ReceiptFilters.tsx`) so Items' filter row reads
Year / Status / Search / Sort from `md` up -- `ReceiptHistory` still never
passes `extraFilter`, so its own layout is untouched.

- **Options, in order:** "Date (newest first)" (`date_desc`, the default),
  "Date (oldest first)" (`date_asc`), "Amount (high to low)"
  (`amount_desc`), "Amount (low to high)" (`amount_asc`), "Store (A-Z)"
  (`store`) -- the exact five values `backend/api/routes.py` accepts.
- **URL param `sort`.** The default (`date_desc`) is omitted from the URL
  entirely, same "unset means default" spirit as every other filter here;
  any other recognized value is written as `&sort=<value>`. An
  unrecognized value in the URL (typed by hand, or left over from a future
  rollback) is ignored -- treated exactly as if `sort` weren't present at
  all, never sent to the backend and never a crash -- via a local
  `effectiveSort()` validator mirroring `effectiveYear`/`effectiveStatus`'s
  "ignored, not an error" pattern. `listItems()` is still always called
  with an explicit `sort` (defaulting to `date_desc` when nothing valid is
  in the URL), so the API call and the backend's own default agree whether
  or not the param appears in the address bar.
- **Changing the sort resets paging** for free: like every other
  filter/search change here, picking a new sort calls `navigateTo()` with
  a new URL, which fully remounts `ReceiptItems` (`App.tsx`'s
  `key={locationKey}`) -- there is no separate "reset offset" step to get
  out of sync, and `GET /items` is always re-requested from `offset=0`.
- **Stale-response protection and the "Show more" flow are both
  unchanged**: the same `requestIdRef` guard and the same
  `limit`/`offset` pagination apply exactly as before, with `sort` simply
  threaded through as one more parameter to both `listItems()` call sites
  (the main load effect and `handleShowMore`).
- **Every existing string is unchanged** -- "Clear filters" still resets
  only year/status/search, leaving both the apartment tab and the chosen
  sort alone (sort is an ordering preference, not a filter, so it isn't
  part of `anyFilterActive` or the filter-summary text either).

## Display helpers: dates, short apartment names, clamped text, missing values

Added for the Items table redesign (readability/auditing pass), but
deliberately generic -- any screen displaying the same kind of value should
reach for these rather than re-deriving its own formatting.

- **`src/format/formatDisplayDate.ts`** -- `formatDisplayDate(value: string
  | null)` turns a stored `purchase_date` into exactly one of
  `{kind: "date", text: "DD.MM.YYYY"}` (a real, valid calendar date in
  `YYYY-MM-DD`), `{kind: "raw", text}` (anything else non-blank, trimmed --
  a date the AI couldn't read cleanly, kept visible rather than hidden),
  or `{kind: "missing"}` (`null` or blank). **Deliberately never uses
  `Date` or `Intl`:** `new Date("2026-06-02")` parses as UTC midnight,
  which renders as "01 June" in a timezone behind UTC, and
  `toLocaleDateString()` picks its month names and field order from the
  runtime's locale -- neither has anything to do with what the server
  actually stored, and both would make the exact same stored value render
  differently on different machines. Instead, the `YYYY-MM-DD` string is
  parsed with a plain regex, split into integers, and validated by hand
  (including a real leap-year check: `2024-02-29` is valid, `2025-02-29`
  is not) -- the whole function is pure arithmetic, so its output can
  never depend on `TZ` or the runtime locale (a dedicated test proves this
  by swapping `process.env.TZ` mid-test and checking the result doesn't
  move). This is the **only** place in the app that formats a date for
  display in a fixed, non-raw way; every other screen
  (`ReceiptHistory.tsx`, `ReceiptResult.tsx`) still shows `purchase_date`
  as the server's raw string via the older `displayText()` helper and was
  deliberately left alone by this ticket (out of scope) -- see
  `CLAUDE.md` for the one new rule this introduces.
- **`src/format/apartmentShortName.ts`** -- `apartmentShortName(name:
  string | null)` returns everything after the **last** `" - "` in an
  apartment's full name (e.g. `"Fewo JoJo - Sankt Englmar - Waldglück"` ->
  `"Waldglück"`), trimmed. Falls back to the whole trimmed name when
  there's no `" - "` at all, or when the segment after the last one is
  empty (e.g. a name ending in `" - "` with nothing after it) -- never
  silently drops to an empty string. A plain string-parsing convenience,
  not a data model change; a dedicated `short_name` column on the
  apartment itself would be a cleaner long-term fix, noted in the code
  rather than built now (out of scope for this ticket).
- **`ui/MissingValue.tsx`** -- a quieter stand-in for the plain words "Not
  detected", which (per user feedback) draws the eye more than real data
  in a dense table. Renders a visible `aria-hidden="true"` dash (so it's
  never announced twice) plus `sr-only` text reading exactly "Not
  detected", so every existing test and screen reader still finds that
  text, just not sighted users scanning the table.
- **`ui/ClampedText.tsx`** -- `<ClampedText text lines={1 | 2}
  className?>` renders `text` inside a `break-words` span using Tailwind's
  built-in `line-clamp-1`/`line-clamp-2` utilities (native since Tailwind
  v3.3 -- no plugin, no new dependency), so a 100+ character product title
  or a long store name is capped at a fixed number of lines instead of
  pushing every row's height out indefinitely. The full, untruncated text
  is always given a `title` attribute (shown on hover; omitted entirely
  when `text` is empty, so there's never an empty tooltip) and stays in
  the DOM for text queries and screen readers -- only the *visual*
  rendering is clamped.

## Download PDF on the original file viewer

- **`ReceiptFileViewer.tsx`** gets a second link-button, "Download PDF",
  right next to "Open original" in the header — same shared
  `LINK_BUTTON_CLASSES` (so identical secondary-button styling, 44px
  touch target, visible focus ring), same `DownloadIcon`-prefixed shape as
  `ExternalLinkIcon`-prefixed "Open original". It's a plain `<a href>`
  pointing at `src/api/receiptArchiveUrl.ts`'s
  `GET /receipts/{id}/archive.pdf` URL — no `fetch`, so no CORS handling
  is needed; the server's `Content-Disposition: attachment` header is
  what triggers the browser's own download, exactly like the backend/
  frontend split that already lets `receiptFileUrl.ts`'s URL be used
  directly as an `<img src>`/`<iframe src>`. Shown for both image and PDF
  receipts (it doesn't depend on `kind` at all, unlike the zoom controls,
  which only show for `kind === 'image'`); hidden together with "Open
  original" whenever the viewer is in its `hasError` ("The original file
  is not available.") state, via the same condition. Not added to
  `?view=styleguide`, since `ReceiptFileViewer` itself isn't shown there
  at all (no network-free way to demo an `<img>`/`<iframe>` pointed at a
  real file).

## Batch upload queue UI

- **Switching modes.** The hidden file input gained `multiple`; picking or
  dropping exactly 1 file keeps the single-file flow byte-for-byte
  unchanged (same strings, same "Read receipt" button, same preview row).
  Picking or dropping 2+ files replaces the current selection and renders
  `src/batch/BatchQueue.tsx` instead of the single-file row — the dropzone,
  apartment `RadioCardGroup` and "Take photo" button stay in place above
  it. Both the dropzone and every file input are disabled while a batch is
  running (`isInputDisabled = isBusy || batch.running` in
  `ReceiptUpload.tsx`), so a batch can't be interrupted mid-flight by a new
  selection; selecting a single file after a batch has finished calls
  `batch.reset()` first so the two panels never show at once.
- **`BatchQueue.tsx`** renders a `<ul>` of rows (file icon, truncated name
  with a `title` for the full name, size via the shared `formatFileSize`,
  and an icon+text status chip — never color alone — for
  Waiting/Uploading…/Reading…/Done/Failed), a native `<progress>` with a
  `<label>` plus a `role="status"` summary ("X of Y read, Z failed"), and
  a warning `Alert` listing rejected files as `"<name>: <reason>"` (or
  just the reason when there's no single file name, e.g. the
  "first 20 files" cap). A done row with a `receiptId` gets a real `<a
  href="/?receipt=<id>" target="_blank" rel="noopener noreferrer">Open</a>`
  — a real anchor, not a `navigateTo()` call, since the in-memory queue
  would otherwise be lost by navigating the current tab away — plus a
  "Check values (N)" badge when `warningsCount > 0`. A failed row shows
  Retry (re-dispatches through the existing `useBatchUpload` engine) and
  its error text using the exact same shared messages as the single-file
  flow; Remove is offered for waiting or failed rows, matching the
  engine's own no-op rule for in-flight items.
- **Start/stop/pause/finish, in `ReceiptUpload.tsx`.** Before `start()`:
  primary button "Read N receipts" (disabled until an apartment is chosen
  and N ≥ 1, same "Choose an apartment to continue." helper as the
  single-file flow) plus a muted note, "Each receipt is sent to OpenAI to
  read it (N requests)." While running and not paused: a secondary "Stop"
  button. While paused (`pausedReason` from the engine — `'unavailable'`,
  `'network'`, or `'stopped'` after clicking Stop): an error (or, for
  `'stopped'`, warning-toned) `Alert` with the matching message — reusing
  `EXTRACTION_NOT_CONFIGURED_MESSAGE`/`NETWORK_ERROR_MESSAGE` for the
  first two, and a new `STOPPED_MESSAGE` ("Stopped. The remaining receipts
  were not processed.") for the third — plus a "Resume" button. Once
  nothing is waiting or in flight (checked by item status, not by the
  engine's `running` flag, which the engine deliberately never resets):
  a success `Alert` ("Done: X read, Y failed.") with "Review in History"
  (`navigateTo('?view=history&apartment=<id>&status=needs_review')`) and
  "Read more receipts" (`batch.reset()`, keeping the chosen apartment).
  Failed rows stay listed with Retry even in the finished state.
- **`beforeunload`.** A `useEffect` in `ReceiptUpload.tsx` adds a
  `beforeunload` listener only while at least one batch item is actually
  `uploading`/`reading` (not merely while `running`, since a stopped batch
  lets its in-flight items keep going to completion) and removes it the
  moment nothing is left in flight.
- **Added to `?view=styleguide`:** a "Batch upload queue" section renders
  `BatchQueue` with one static sample item per status plus two rejected
  entries; a separate "Batch paused / finished" section toggles between
  the three paused messages and the finished summary, reusing the same
  shared error-message constants as the real flow.

## Batch upload polish: compact rows, a sticky action bar, thumbnails

A follow-up pass after uploading up to 20 receipts at once found the first
batch UI didn't scale: each row was ~94px tall (the outlined "Remove"
button had its own line), rows only showed a file icon and camera-roll
filenames (no way to tell receipts apart at a glance), the primary "Read N
receipts" button sat at the bottom of a list that could be ~2000px tall,
the progress bar looked grey/disabled before anything started, and files
arrived in whatever order the browser/OS handed them over (often
newest-first), which read as random next to a camera's sequential names.

- **One-line compact rows with a thumbnail.** `BatchQueue.tsx`'s row is now
  a single ~56px line: a 40×40px thumbnail (`object-contain` on a
  `slate-100` background -- an `<img>` built from a per-item
  `URL.createObjectURL` for an image file, or the plain file icon in the
  same-sized box for a PDF), the truncated name (`title` carries the full
  name), the size, the existing status chip, and an icon-only Remove
  button -- never two full lines plus a separate "Remove" row like before.
  A **done** row's "Open" link / "Check values (N)" badge, and a **failed**
  row's error text + "Retry" button, now sit on their own line *under* the
  main line (so the 56px line stays uniform across every status) instead
  of sharing it.
- **Remove is icon-only, named by the file.** The `Button` variant/size
  stay the same (`ghost`/`sm`, so it keeps its 44px touch target below
  `sm`), but its child is now just an `X` icon (`aria-hidden`) with an
  explicit `aria-label="Remove <file name>"` instead of visible "Remove"
  text -- necessary once there are up to 20 identical-looking icon buttons
  on the page; each one now has a distinct accessible name. This is a
  **deliberate, listed change**: the one existing test asserting the old
  plain `/^remove$/i` name on a batch row was updated to look for
  `'Remove a.jpg'` instead (the single-file flow's own, separate "Remove"
  button next to the file preview is completely unaffected).
- **Thumbnail object URLs (`BatchQueue.tsx`'s `useThumbnails` hook).** One
  object URL is created per queued **image** file (checked via the same
  `IMAGE_EXTENSIONS`/`getExtension` from `fileValidation.ts` the rest of
  the app already uses -- a PDF never gets a thumbnail), lazily, inside a
  `useEffect` keyed on the `items` array (never during render, so
  `createObjectURL`/`revokeObjectURL` stay accountable React side
  effects). The hook diffs ids rather than reacting to every status
  change: an existing item's id already has an entry, so a plain
  Waiting→Uploading→Done status transition never churns its thumbnail,
  but the moment an id drops out of `items` -- Remove, a whole-queue
  replace before starting (picking files again replaces the array with
  new ids), or "Read more receipts"/reset unmounting the whole panel --
  its URL is revoked. A second effect (empty deps) revokes everything
  still held on unmount, covering the case where several thumbnails are
  showing when the panel disappears at once.
- **Summary line replaces the progress bar before anything starts.** The
  old static `<progress value={0}>` read as full-looking-but-disabled grey
  bar before a batch had even begun; now, before `start()`, a plain text
  summary -- `"N receipts · X MB · for <short apartment name>"` (the size
  is the *sum* of every queued file's size, run through the existing
  `formatFileSize` once; the apartment name reuses `apartmentShortName`
  from the previous polish pass) -- takes its place, and no `<progress>`
  element exists at all yet. The moment `start()` is called, this flips to
  the `<progress>` (now with a brand-colored fill via Tailwind's
  `accent-brand` utility, which maps modern browsers' `accent-color` for
  form controls including `<progress>`) and the existing "X of Y read, Z
  failed" text -- and stays that way through running, any paused state,
  and finished, since `batch.running` is never reset back to `false` by
  `STOP` or finishing (the same flag the rest of the batch UI already
  relies on for this).
- **A sticky action bar, not an inline block.** The summary/progress line,
  every stage's primary control (the "Read N receipts" button, "Stop",
  the paused `Alert` + "Resume", or the finished `Alert` +
  "Review in History"/"Read more receipts"), and the OpenAI note are now
  wrapped in one `<div className="sticky bottom-0 ...">` sitting below
  `BatchQueue`'s row list, inside the same `Card` -- escaping the card's
  own `p-6` padding with negative margins (`-mx-6 -mb-6`, re-adding
  `px-6`/`pb-6`) so its `border-t` and `bg-surface` span the full card
  width. As the row list scrolls (within the page, since nothing else
  scrolls independently), this bar stays pinned to the bottom of the
  viewport as long as the card itself is still in view -- so the action a
  user needs (Stop, Resume, or just seeing progress) is never buried below
  20 rows. (Only a real browser can confirm the pinned-while-scrolling
  behavior itself -- jsdom has no layout engine; `?view=styleguide`'s new
  "Batch summary line and sticky action bar" section demonstrates the same
  markup pattern over a short, scrollable sample list for a quick visual
  check.)
- **Compact "Add more files" bar once files are queued.** The full
  dropzone (icon, "Drag a receipt here, or choose a file",
  "JPG, PNG or PDF, up to 10 MB") is only shown with 0 or 1 file selected.
  The moment `isBatchActive` (2+ files queued), it's replaced by a
  shorter, single-line bar ("Add more files") using the exact same
  `role="button"`/keyboard/drag-and-drop handlers and the same hidden
  `<input>` -- still disabled while the batch is running, still opens the
  same file picker and accepts the same drag-and-drop. This is a
  **deliberate, listed change**: the one existing test asserting the full
  dropzone's `/drag a receipt here/i` accessible name while a batch is
  running was updated to look for `/add more files/i` instead. The
  "Take photo" button and the apartment `RadioCardGroup` are unaffected by
  this switch -- they stay exactly where they were.
- **Files sorted by name before queuing (natural compare).** Both
  `handleFileChange` and `handleDrop` route 2+ files through
  `handleBatchFilesSelected`, which now sorts the incoming array with
  `Intl.Collator(undefined, {numeric: true, sensitivity: 'base'})` before
  calling `batch.addFiles(...)` -- so `"img2.jpg"` sorts before
  `"img10.jpg"` (a plain string sort would put `"img10.jpg"` first), and
  the resulting order no longer depends on what order the browser/OS
  handed the files over in (often newest-first). This sort happens at the
  call site in `ReceiptUpload.tsx`, not inside `useBatchUpload`/
  `batchReducer` -- those stay exactly as they were (no existing
  `useBatchUpload.test.ts` assertion needed to change), since every file
  set in that suite already happens to be in alphabetical/numeric order.
  The 20-file cap and duplicate-detection rules are untouched.
- **Added to `?view=styleguide`:** the existing "Batch upload queue"
  section now shows the compact rows automatically (same component,
  updated in place); a new "Batch summary line and sticky action bar"
  section demonstrates both the before-start summary text and the
  after-start progress/button state over a short scrollable sample list;
  a new "Reading tips (collapsible, under the dropzone)" section shows the
  `<details>`/`<summary>` tips element on its own.

## Changelog

- **Invisible button investigation (unresolved as a reproducible bug):**
  given a report that the enabled primary "Read receipt" button was
  invisible with a ~50px empty gap in its place, and a suspected cause of
  unresolved/invalid brand color tokens: `tailwind.config.js`'s color
  tokens are plain hex strings (no CSS variables); `npm run build`'s
  actual output shows `.bg-brand`, `.text-white`,
  `hover:bg-brand-hover`, `disabled:bg-slate-300`, `.fill-brand` and
  `.border-brand` all compiling to correct, valid, distinct
  `rgb(79 70 229/...)`/`rgb(255 255 255/...)` declarations; Tailwind's own
  `preflight.css` does reset `button { background-color: transparent }`
  at the base layer, but a class selector (`.bg-brand`, specificity 0,1,0)
  always outranks an element selector (`button`, specificity 0,0,1)
  regardless of source order, so that reset cannot be overriding it either
  in a production build or in Vite dev mode (Tailwind's three `@tailwind`
  directives compile into one ordered stylesheet either way). No
  conditional class, `hidden`/`opacity-0`, or stray wrapping element was
  found around the button in `ReceiptUpload.tsx` that would explain a
  layout gap. In short: the suspected cause doesn't hold up against the
  evidence, and the bug could not be reproduced from source. The
  regression tests and the `ghost`/`danger-ghost` border fix below were
  added regardless, since they're correct hardening independent of
  whether this specific report reproduces, and a real-browser check (hard
  refresh, since a stale cached stylesheet matching an older commit is one
  explanation this investigation can't rule out) is still worth doing.
- **`border` darkened from `#cbd5e1` (slate-300) to `#64748b` (slate-500).**

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

## Decisions: receipt view

- **Numbers right-aligned, currency in headers.** The items table shows
  each amount as a plain, right-aligned, `tabular-nums` number
  (`whitespace-nowrap` so it never wraps); the currency code appears once,
  in the "Unit price"/"Line total" column headers, instead of repeating it
  in every cell. Discounts/Taxes rows and the Total keep the currency on
  the amount itself, since each is a single value, not a repeated column.
- **Action hierarchy.** Edit is the primary action, in the card's header
  next to the store name — the thing you're most likely to do with a
  receipt you're reviewing. Delete is destructive and comparatively rare,
  so it's pushed to the bottom of the card, separated by a divider, and
  styled `danger-ghost` rather than a prominent button. "Back to history"
  is navigation, not an action on the receipt, so it sits above the
  two-column layout entirely.
- **No dynamic Tailwind class names, ever.** Every conditional className in
  this codebase picks between complete, static string literals (see
  `NavLink`/`AmountRow`/the tab/segmented-control styles) — never
  string-builds a class from a variable (e.g. `` `text-${color}-600` ``).
  Tailwind's JIT scans source text for literal class-name strings; a
  built-up name is invisible to it and silently never generates any CSS,
  which was the underlying mechanism behind "the active tab has no visible
  style" even though the logic driving it was otherwise correct.
- **Container width.** The receipt-detail view (saved receipt or
  right-after-extraction) uses the shell's new `Container` `xl` size
  (`max-w-6xl`) instead of the default `lg` (`max-w-3xl`), so the
  two-column layout (file : data ≈ 5 : 6) has room to breathe; every other
  view keeps `lg`.

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
  action), `danger` (destructive), `ghost` (low-emphasis/text-like action),
  `danger-ghost` (low-emphasis destructive, e.g. a Delete button that
  shouldn't compete visually with the primary action). Supports `size`
  (`sm`/`md`), `loading` (shows `Spinner` + optional `loadingText`), and
  standard `disabled`. All sizes keep a 44px minimum touch target on small
  screens.
- **`Card`** — a bordered, padded, white surface for grouping content (forms,
  dropzones, confirmation panels).
- **`Container`** — `size` `md` (`max-w-md`), `lg` (`max-w-3xl`, the app
  shell's default), or `xl` (`max-w-6xl`, used for the two-column receipt
  view).
- **`formatMoney(value, currency, { includeCurrency })`** —
  `Intl.NumberFormat`-based: a valid ISO 4217 code gets that currency's own
  decimal precision; a malformed code (`Intl` throws a `RangeError`) falls
  back to a plain 2-decimal amount instead of crashing; `null`/`NaN` shows
  "Not detected". `includeCurrency: false` omits the code prefix, for a
  repeated column where the header already states the currency once.
- **`Skeleton`** — a decorative, `aria-hidden`, `animate-pulse` placeholder
  block (`motion-reduce:animate-none`). Used inside a `role="status"
  aria-busy="true"` region that also keeps the real loading string in the
  DOM (see "Skeleton loading states" above) — never on its own.
- **`Alert`** — variants `info`/`success`/`warning`/`error`. `error` renders
  `role="alert"` (interrupts screen readers); the others render
  `role="status"` (polite). Never relies on color alone — pair with text.
- **`Spinner`** — an inline SVG spinner with an `aria-label` for in-flight
  states.
- **`RadioCardGroup`** — a `fieldset`/`legend` (with `role="radiogroup"` and
  an `aria-label` matching the legend, so it's findable by name even though
  `role="radiogroup"` overrides the fieldset's implicit legend-naming) of
  real `<input type="radio">` options styled as selectable cards. The radio
  itself is `sr-only` (visually hidden, not `display:none`, so it stays
  focusable and keeps native same-`name`-group arrow-key behavior); the
  wrapping `<label>` carries the card styling and a `focus-within` ring
  (the hidden input's own ring would be clipped). The selected card is never
  marked by color alone: a check icon and `font-semibold` go with the
  stronger `border-brand`. Stacked below `sm`, side by side from it. Used by
  the upload form's apartment choice (see "Apartment choice" below).
- **`formatFileSize`** — formats a byte count as `B`/`KB`/`MB`/`GB` for
  display next to a selected file.

## Accessibility rules

- Every interactive element has a visible `focus-visible` ring.
- Minimum 44px touch target height for buttons on small screens.
- Never use color alone to convey state (pair with text/icon).
- All normal text meets WCAG AA contrast (4.5:1).
