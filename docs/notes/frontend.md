# Frontend notes

Per-feature detail for `frontend/`, moved verbatim from CLAUDE.md's former "Project structure" section. CLAUDE.md is the short index; this file is the detail.

- `frontend/` — Vite + React + TypeScript app, styled with Tailwind CSS.
  Jest + React Testing Library config lives here (`jest.config.cjs`,
  `jest.esbuild-transform.cjs`, `tsconfig.jest.json`, `src/setupTests.ts`).
  **Design system:** semantic color/radius/shadow tokens live in
  `tailwind.config.js` (`theme.extend`) — components must use these tokens
  (e.g. `bg-brand`, `text-ink-muted`, `border-border`), never hardcoded hex
  colors; see [docs/design.md](docs/design.md) for the palette, contrast
  ratios, and when to use each shared component. `border` (`#64748b`,
  4.76:1) is the **control** border — every interactive element (`Button`,
  every `RadioCardGroup` card, the dropzone) keeps it; `border-subtle`
  (`#e2e8f0`) is for **decorative** containers only (`Card`'s own border)
  and carries no contrast minimum — never put it on anything interactive.
  `brand-subtle` (`#e0e7ff`) is for larger selected-background fills (a
  chosen `RadioCardGroup` card, the idle dropzone), distinct from
  `brand-soft` (`#eef2ff`, small badge/pill fills). `text-title`
  (`fontSize.title`: 28px/36px, 600 weight, -0.025em tracking) is used for
  exactly one element per view — `PageHeader`'s `<h1>`. `rounded-card`
  (12px)/`rounded-control` (8px) and `shadow-card`/`shadow-popover` are
  self-documenting aliases for the same 8px/12px radii and the two shadow
  elevations already in use. Base `body` styles (`src/index.css`):
  `bg-surface-page font-sans text-base text-ink`. Shared UI components live
  in `src/components/ui/` (`Button`, `Card`, `Alert`, `Spinner`, `Container`,
  `RadioCardGroup`, `StatusBadge`, `PageHeader`, `formatFileSize`) — reach
  for these instead of ad hoc
  markup. All
  interactive elements need a visible `focus-visible` ring and a minimum
  44px touch target on small screens; never convey state with color alone;
  every CSS transition pairs with a `motion-reduce:transition-none` (or
  equivalent) variant.
  User-visible strings and roles that existing tests assert on (e.g.
  "Uploading...", "Extracting receipt data...", "Receipt not found",
  "Upload another receipt", the 502/503 messages) must stay exactly as they
  are unless a task explicitly asks to change them.
  `src/api/` holds API call modules (`uploadReceipt.ts`, `extractReceipt.ts`,
  `getReceipt.ts`, `listReceipts.ts` (accepts `{limit?, offset?,
  apartmentId?, year?, status?, sort?}`, building the query string itself
  and **always sending `sort`** — `DEFAULT_RECEIPT_SORT` (`date_desc`,
  exported there) when none is given; its
  response type carries `total` alongside `items`/`count`, matching `GET
  /receipts`),
  `getApartments.ts`,
  `updateReceiptApartment.ts`,
  `updateReceiptStatus.ts`, `getReceiptFacets.ts` (`GET /receipts/facets`,
  optional `apartmentId`), `listItems.ts` (`GET /items`, accepts
  `{apartmentId?, year?, status?, q?, limit?, offset?}`, same
  query-string-building pattern as `listReceipts.ts`),
  `checkDuplicates.ts` (`POST /receipts/check-duplicates`, body
  `{hashes: string[]}`, response `{items: [{hash, existing: ReceiptSummary
  | null}]}` in request order), shared `ApiError`
  (carries an optional `missing:
  string[]`, set only for a `422` from `updateReceiptStatus` whose body is
  `{detail: {message, missing}}` — every other error, including a
  malformed body, falls back to a plain message with no `missing`; also
  an optional `code`/`details` pair — set only when a response's `detail`
  was an object, e.g. a `409 DUPLICATE_FILE`'s `{code, message,
  existing}` — via the shared `apiErrorFromDetail(detail, status,
  fallbackMessage)` builder a string `detail` still just becomes the
  message with no `code`/`details`; `uploadReceipt.ts`/
  `checkDuplicates.ts` both use it, `updateReceiptStatus.ts` keeps its own
  pre-existing `{message, missing}` handling untouched), shared
  response types in
  `types.ts` — including `ReceiptSummary`, the list-row shape,
  `Apartment` (`id`/`name`), `ReceiptStatus`
  (`'needs_review' | 'approved'`), `ApartmentFacet` (`id`/`name`/`count`),
  `ReceiptFacets` (`apartments`/`total`/`years`/`has_undated`), `ItemRow`
  (one `GET /items` row — `receipt_id`/`line_index`/`name`/`quantity`/
  `unit_price`/`line_total`/`currency`/`purchase_date`/`store_name`/
  `apartment_id`/`apartment_name`/`status`, matching the backend's
  `LineItemRow` field-for-field) and `ItemsPage`
  (`items`/`count`/`total`);
  `ReceiptExtraction` and `ReceiptSummary`
  both carry flat `apartment_id`/`apartment_name` (`string | null`) plus
  `status`
  (`ReceiptStatus`), matching
  every backend receipt-shaped response); the backend URL is read from
  `VITE_API_URL` (`.env.example` / `.env`, the latter gitignored). (An
  expense-category feature — `Category`, `category_id`/`category_name`,
  `getCategories.ts`, `updateReceiptCategory.ts` — was removed; see
  [docs/adr/0004-remove-categories.md](docs/adr/0004-remove-categories.md).)
  `ReceiptUpload.tsx` uploads a file then automatically calls extract and
  renders `ReceiptResult.tsx` with the structured result.
  **Apartment choice (`hooks/useApartments.ts`, `ui/RadioCardGroup.tsx`,
  `format/apartmentPlace.ts`):**
  the upload form shows a `RadioCardGroup` above the dropzone inside the
  "Apartment" section (`SectionHeading number={1} required`, the only
  section with the "Required" tag), legend "Which
  apartment is this receipt for?" (pluralizing to "Which apartment are these
  receipts for?" the moment `isBatchActive` — 2+ files queued) — passed
  with `hideLegend` here, so it's `sr-only` (the `SectionHeading`'s plain
  "Apartment" is the one *visible* heading now, avoiding the repetition
  "1 Apartment" / "Which apartment is this receipt for?" used to read as);
  the legend's full text is unchanged and still the fieldset's
  `aria-label`, still found by `getByText` in every test that looks for
  it. Nothing
  preselected (confirmed: `apartmentId` is plain `useState(null)` on every
  mount, with no persistence beyond the session — deliberately not
  preselected across a real reload). `useApartments`
  fetches `GET /apartments` only while the plain upload form is about to
  render (never while reopening/showing/failing to load a saved receipt by
  id); a *successful* result is cached at module scope (so "Upload another
  receipt" never re-fetches it) but a failure is never cached, so its
  `retry()` tries again. States above the dropzone: loading ("Loading
  apartments..." in a `role="status" aria-busy="true"` region with two
  `Skeleton` blocks), failure (`Alert variant="error"` + "Retry", upload
  impossible either way), or the loaded group. Each card's two-line label is
  built as `{label: apartmentShortName(name) ?? name, secondaryLabel:
  apartmentPlace(name), accessibleName: name}` — `apartmentPlace(name)`
  returns the *middle* `" - "`-segment only when the name has **exactly** 3
  such segments (else `null`, no second line). `RadioCardOption`'s
  `accessibleName` (falling back to `label` when omitted) is applied as an
  explicit `aria-label` on the `<input type="radio">`, so the accessible
  name is always the full apartment name regardless of what's visually
  shown — `ReceiptApartment.tsx` and `StyleGuide.tsx` pass only `label` (no
  `secondaryLabel`/`accessibleName`/`hideLegend`), so their cards/behavior
  are
  byte-for-byte unchanged. "Read receipt" stays disabled
  until a valid file **and** a chosen apartment are both present. Three
  mutually exclusive status lines cover every combination: with a file but
  no apartment, a muted "Choose an apartment to continue." hint is shown
  next to the `RadioCardGroup`, tied to it via `aria-describedby`
  (unchanged); with an apartment but no file, a muted "Choose a file to
  continue." hint is shown under the "Read receipt" button, tied to it via
  `aria-describedby`; with **neither** chosen, a muted "Choose an
  apartment and add a receipt to continue." hint fills that same slot
  instead (same `id` reused — `apartmentId && !file` and `!apartmentId &&
  !file` can never both be true at once). The button's `aria-describedby`
  is simply `!file ? FILE_HELPER_ID : undefined` — true for exactly those
  two under-the-button cases, never the apartment-only one. Both
  under-the-button lines carry `role="status"` (texts unchanged).
  Section 2's heading reads "Receipts" plus, once an apartment is chosen,
  a muted `for <apartmentShortName>` span (full name in its `title`)
  inside the same `<h2>` — so its accessible name becomes e.g. "Receipts
  for Waldglück".
  A closed-by-default `<details>`/`<summary>` ("Tips for better reading",
  styled as a text-style control — no box, `list-none` +
  `[&::-webkit-details-marker]:hidden` to remove the native disclosure
  triangle, a `ChevronIcon` that rotates via `group-open:rotate-90`
  instead) under the dropzone/camera button lists: lay the receipt flat,
  use good light, keep the whole receipt in frame including the total,
  one receipt per photo — shown only below `lg` (see "Upload page layout"
  below for the wide-screen alternative, `HelpPanel`). The chosen `apartmentId` is plain
  component state, untouched by `handleRemoveFile`/`processFile`/
  `handleReset`, so it survives Remove, a new file, and "Upload another
  receipt" within the session (never persisted across a real reload).
  `uploadReceipt(file, apartmentId, allowDuplicate?)` sends `apartment_id`
  as a second `FormData` field, and `allow_duplicate=true` as a third only
  when `allowDuplicate` is truthy (see "Duplicate warnings" below).
  **Upload page layout (`SectionHeading`, `TipsDetails`, local to
  `ReceiptUpload.tsx`; `UploadSidePanel.tsx` for the second column):** the form `Card` is split into two
  `SectionHeading`s — a small circular number badge (`aria-hidden="true"`)
  next to an `<h2>` reading just the word ("Apartment", "Receipts"; the
  number is never part of the heading's accessible name) — section 1
  holds the `RadioCardGroup` (and its helper text), section 2 holds the
  file input/dropzone/camera button/tips-or-nothing/batch-or-single-file
  content, exactly as before, just re-nested; every string inside stayed
  the same. `App.tsx`'s `mainSize` gives Upload the wider `xl` `Container`
  (previously `lg`, now matching Items/receipt-detail — only History
  stays at `lg`), and the page wraps its content in `grid gap-6
  lg:grid-cols-12` (the default `items-stretch`: both columns as tall as
  the taller one) with the form `lg:col-span-7` and a
  help-panel column `lg:col-span-5` — plain CSS, collapsing to one
  stacked column below `lg`. Whether that second column actually renders
  anything is decided in JS, not CSS: `isWideScreen =
  useMediaQuery('(min-width: 1024px)')` — `true` renders
  `UploadSidePanel` (see "Side panel for returning users" below), whose
  help variant is `HelpPanel` ("How it works": choose the apartment / add photos
  or PDFs / "Check the result in History or Items. The Report counts
  every receipt, reviewed or not." — approval is optional, so nothing on
  the upload screen implies it's required — each with its own number badge, plus the
  same tips list already expanded) and skips `TipsDetails` entirely;
  `false` (including whenever `matchMedia` doesn't exist, jsdom's
  default) renders `TipsDetails` and skips `UploadSidePanel` entirely
  (no fetch either) — **never both**,
  since both show the identical tips text and a CSS-only
  show/hide-one-of-two approach would leave that text in the DOM twice at
  once. `HelpPanel` uses the plain `Card` elevation (`shadow-card`, no
  override — it originally added `shadow-popover` on top, which read as
  a floating popup rather than a panel beside the form). **Equal-height
  columns from `lg` up:** the panel's column is a flex column and every
  panel variant's card is `lg:flex-1` (`PANEL_CLASSES`), so it fills the
  stretched column with its content at the top — no longer sticky. On
  the left, the form `Card`, its "Receipts" section and the full
  dropzone are `lg:flex-1` (the dropzone also `justify-center`), so the
  dropzone takes up any spare height and both cards end on the same
  line; with a long batch queue the form grows and the panel stretches
  with it. The compact "Add more files" bar never grows. Below `lg`:
  unchanged (one stacked column).
  **Side panel for returning users (`UploadSidePanel.tsx`):** on mount it
  makes **one** request, `listReceipts({limit: 5, sort: 'uploaded_desc'})`
  (no facets request any more), showing `UploadSidePanelSkeleton` (a
  `Card` with a `role="status" aria-busy="true"` region, "Loading your
  receipts..." `sr-only`, same outer `PANEL_CLASSES` as every other
  variant so nothing jumps). The response's `total === 0` → `HelpPanel`
  (the help above, expanded); a failed request → the same `HelpPanel`,
  silently (no `Alert`); otherwise `ReceiptsOverview` (exported,
  presentational, props `{latest}`), top to bottom: a closed
  `<details>` "How it works and tips" holding `HowItWorksContent` (the
  same steps/tips `HelpPanel` shows — `TIPS_ITEMS`/`HOW_IT_WORKS_STEPS`
  live in this file, and `ReceiptUpload.tsx`'s `TipsDetails` imports
  `TIPS_ITEMS` from it); the panel's heading, an `<h2>` "Latest uploads",
  with one link per receipt to `?receipt=<id>` (store via `ClampedText`
  1 line or `MissingValue`; `DateCell` from `ReceiptItems.tsx` for the
  date and its "Date not recognized" marker; `formatMoney(total,
  currency)` or `MissingValue`; the apartment as an `ApartmentPill` or
  `MissingValue`); then the links "See all in History"
  (`?view=history`) and "Open the yearly report" (`?view=report`). The
  former "Your receipts" heading, "N receipts saved" and the
  per-apartment count links are gone. Every
  link is a real `href` whose plain click goes through `navigateTo`. A
  `refreshKey` prop refetches once whenever it changes, keeping the
  current content on screen (no skeleton) until the answer arrives — a
  failed refresh also falls back to `HelpPanel`. `ReceiptUpload.tsx`
  bumps its `sidePanelRefreshKey` once after a single upload's
  extraction succeeds (the panel is unmounted while the result shows, so
  in practice the remount on "Upload another receipt" is that one
  fetch) and once each time `isBatchFinished` turns `true`. The dropzone (both the full and the compact "Add
  more files"
  variants) has `rounded-control` (was `rounded-lg`) and
  `transition-colors duration-150 motion-reduce:transition-none` for the
  hover/drag-over change — its `border-border` dashed border is unchanged
  (a dropzone is `role="button"`, an interactive control, so it keeps the
  stronger border, never `border-subtle`). **Idle vs. engaged fill:**
  idle is `bg-brand-soft` (the lighter sibling token — a first pass used
  `bg-brand-subtle` at idle too, which made the dropzone the single most
  saturated block on the page; corrected), hover **and** drag-over both
  step up to `bg-brand-subtle` plus `border-brand` (treated as the same
  "engaged" strength, one step stronger than idle either way). The full
  variant's instructional text is now "Drag receipts here, or" followed
  by a real secondary `Button` reading "Browse files" (`onClick` calls
  `e.stopPropagation()` before `openFilePicker()`, since the button sits
  nested inside the dropzone's own `role="button"` `<div>` which already
  opens the picker on any click — without stopping propagation the click
  bubbles up and double-fires it) then the size/type line ("JPG, PNG or
  PDF, up to 10 MB each. Up to `${MAX_BATCH}` files at once.", built from
  `batchReducer.ts`'s `MAX_BATCH`, never a hardcoded 20) — replacing the
  previous plain-text "...or choose a file", which read as inert text
  rather than an obvious control. The batch queue and sticky
  action bar are functionally untouched — only their column got
  narrower; the sticky bar's `-mx-6 -mb-6` trick is relative to its own
  `Card`, unaffected by the surrounding grid.
  Dependency direction: UI components (`App.tsx`, `ReceiptUpload.tsx`,
  `ReceiptResult.tsx`, `ReceiptHistory.tsx`, `ReceiptItems.tsx`,
  `ReceiptFilters.tsx`) -> `src/api/` ->
  `src/api/types.ts`. `src/api/` must never import a UI component —
  enforced by dependency-cruiser.
  **Reopening a saved receipt:** after a successful extraction,
  `ReceiptUpload.tsx` writes `?receipt=<id>` to the address bar via
  `window.history.replaceState` (no router library, no page reload, no new
  history entries). On load, if `?receipt=<uuid>` is present, it calls
  `getReceipt` (`GET /receipts/{id}`) instead of upload/extract and renders
  the same `ReceiptResult` — reloading the page or reopening the link never
  triggers a new AI call. An invalid (non-UUID) `receipt` value never
  reaches the server — it goes straight to "Receipt not found", the same
  message shown for a real `404`. "Upload another receipt" clears the
  `receipt` param along with all state.
  **Modified clicks on internal links (`isPlainLeftClick`, in
  `src/navigation.ts`):** every internal `<a>` whose click handler
  navigates in place first checks `isPlainLeftClick(e)` (primary button,
  no ctrl/cmd/shift/alt); only then does it call `preventDefault()` and
  navigate. Any other click is left to the browser, which opens the
  link's real `href` — so every such `href` holds the full target, `from=`
  included. Middle-click fires `auxclick`, never reaches these handlers,
  and always works. Used by: the header nav links (`App.tsx`), History
  rows and its empty-state "Upload a receipt", Items rows and its "Upload
  a receipt", every Report link, the saved receipt's back link, the
  batch's "Open yearly report", review-mode Previous/Next and the
  "N warnings to check" link (`ReviewBar.tsx`), and the upload side
  panel's `AppLink`. Tests use `src/test/linkClicks.ts`'s
  `expectBrowserHandlesModifiedClicks(link, expectedSearch)`.
  **Navigation (`App.tsx`, `src/navigation.ts`):** no router library — a
  tiny `navigateTo(search)` helper does `history.pushState` and dispatches a
  synthetic `popstate` event (since `pushState`/`replaceState` never fire
  one themselves); `App.tsx` listens for `popstate` (real browser
  back/forward and the synthetic ones) to decide, from the URL, which of
  `ReceiptHistory.tsx` (`?view=history`), `ReceiptItems.tsx`
  (`?view=items`), `ReceiptReport.tsx` (`?view=report`), or
  `ReceiptUpload.tsx` (otherwise —
  including `?receipt=<id>`) to render, keying each on the current
  `location.search` so external navigation remounts cleanly without
  disturbing `ReceiptUpload`'s own internal `replaceState` calls. The
  header nav has four links (Upload/History/Items/Report);
  `getActiveNav()`/
  `getPageName()` (-> `document.title`, e.g. "Items · Smart Receipt AI",
  "Report · Smart Receipt AI") both switch on the same `View` type, same
  `aria-current` treatment for all four.
  **Page header pattern (`ui/PageHeader.tsx`) — exactly one `<h1>` per
  view:** `PageHeader` renders a view's one `<h1>` (`text-title`), an
  optional muted `description` (`max-w-prose`), and an `actions` slot
  (right of the title from `sm` up, stacked below it otherwise). Used on
  Upload (`"Upload receipts"`), History (`"History"`) and Items
  (`"Items"`) — each renders it at the top of **every** state of that
  view (loading/error/loaded), not just the happy path.
  `ReceiptUpload.tsx` renders both the plain upload form and the
  saved-receipt view: **only** the upload-form branch gets `PageHeader`
  — the saved-receipt view (after extraction, or reopening
  `?receipt=<uuid>`) keeps `ReceiptResult`'s own store-name `<h1>` as its
  one heading, and the `?receipt=<id>` loading/not-found/load-error
  states (part of that same saved-receipt path) render no `PageHeader`
  either. The site header's "Smart Receipt AI" is **not** a heading — a
  plain `<span>`, since it's branding next to the logo, not a page title
  (it *was* an `<h1>` before `PageHeader` existed, which would have made
  two `<h1>`s per page; `App.test.tsx`'s assertion moved from a heading
  role query to a plain text query, a deliberate, listed change). The
  header's inner `Container` now uses the same `size` `App.tsx` already
  computes for `<main>` per view (`mainSize`) instead of a hardcoded
  `'lg'`; header height is a fixed `h-16` (64px), bottom border
  `border-border-subtle` (decorative, not interactive). **Correction:**
  matching `Container` `size` between header and `<main>` alone did not
  actually align them — every view's own root element nested a *second*,
  different `max-w-*`/`mx-auto` inside `<main>`'s already-centered
  `Container` (`ReceiptUpload.tsx` `max-w-5xl`, `ReceiptHistory.tsx`
  `max-w-2xl`, `ReceiptItems.tsx` `max-w-4xl`), re-centering within an
  already-centered box and shifting that view's edges inward from the
  header's. Fixed by removing that second constraint from all three (now
  plain `w-full`, no `max-w-*`/`mx-auto` of their own — `ReceiptDetailLayout.tsx`
  was already `w-full` and never had this bug); see "One container per
  view" in `docs/design.md` for the rule this established
  (`Container.tsx`'s exported `CONTAINER_SIZE_CLASSES` is the one source
  of truth a view's content and the header must both go through, never a
  second one nested inside it) and `App.test.tsx` for the tests that
  check it mechanically (matching classes on the header's and `<main>`'s
  `Container`, and no stray `max-w-` on the view's own root element).
  `AppMark` is a
  receipt-shaped inline SVG (white rectangle, zigzag bottom edge, two
  text lines via `stroke-brand`) on the brand square, duplicated
  byte-for-byte (as literal hex, the one unavoidable exception to
  "tokens only" since it's a standalone asset outside the Tailwind build)
  into `public/favicon.svg`; `index.html` also has `<meta
  name="theme-color" content="#4f46e5">` and a `<meta name="description">`,
  and its static `<title>` is `"Smart Receipt AI"` (the per-view
  `document.title` effect still overwrites it on mount).
  `ReceiptHistory.tsx` lists saved receipts as rows (`HistoryRow`,
  exported) inside one `Card` (`HistoryRowList`, exported): rows are
  separated by a decorative `divide-y divide-border-subtle` line and carry
  no border of their own; the list's negative margins (`-m-5 sm:-m-6`)
  cancel the `Card`'s padding so a row's `hover:bg-slate-50` reaches the
  card's edges, and `overflow-hidden` clips it to the rounded corners —
  which is why the row's focus ring is drawn inset
  (`focus-visible:outline-offset-[-2px]`). Each row is `min-h-[44px]`.
  From `sm` up, fixed columns so values line up row to row: store
  (`flex-1`, `ClampedText` 1 line, full text in `title`), date (`w-28`,
  `tabular-nums`, via `DateCell`, imported from `ReceiptItems.tsx` rather
  than duplicated — `DD.MM.YYYY` for a valid ISO date, the raw text + the
  same warning icon/`title`/hidden "Date not recognized" for anything
  else, `MissingValue` when missing), amount (`w-28`, right-aligned,
  `tabular-nums`, `whitespace-nowrap`, via `formatMoney`), then the
  apartment (`w-24`) and status (`w-28`) columns — each column reserved
  whenever it's shown at all. Status (cell and header) is right-aligned
  (`justify-end`/`text-right`), ending at the row's `px-4` padding; the
  Apartment cell and header carry `ml-4` so the right-aligned Total never
  touches it. Above the rows, inside the same `Card`,
  `HistoryHeaderRow` (exported) labels them — "Store", "Date", "Total"
  (right-aligned like the amounts), "Apartment" (only in "All
  apartments") and "Status" (only under Status "All") — in muted
  `text-xs`, same padding/gap/widths as the rows, with a
  `border-border-subtle` bottom divider; `aria-hidden="true"`, since each
  row link already reads its own values. From `sm` up only. Two
  lines below `sm` (store+total; date+apartment+status) — only one layout
  ever mounted, via `useMediaQuery('(max-width: 639px)')`, same pattern
  as `ReceiptResult.tsx`/`ReceiptItems.tsx`. Each row's `apartment_name`
  is a muted icon+text (`text-xs text-ink-muted`, no filled pill)
  showing `apartmentShortName(name)` (`aria-hidden`, decorative,
  truncated) with the full name as both its `title` and a hidden
  (`sr-only`) span, or plain muted "Not assigned" when it's
  `null`/missing — shown only in "All apartments" (hidden inside a
  specific apartment tab — redundant there). Status: only when the Status
  filter is "All", every row shows its `StatusBadge` ("Needs review" or
  "Approved", icon+text, shared with `ReceiptReviewStatus.tsx`/
  `ReviewBar.tsx`). Under a specific Status filter no row shows a badge
  and there is no Status column (redundant, same reasoning as the
  apartment). Each row is a real
  `<a href="/?receipt=<id>{&from=...}">` (not a `<button>`, so opening
  one in a new tab works) with the exact same `from` mechanism/target as
  before; `ReceiptUpload.tsx` adds a "Back to history" link when showing
  a result. `?view=styleguide`'s "History rows" section renders the real
  `HistoryRowList`/`HistoryHeaderRow`/`HistoryRow` for both layouts.
  **Filter row and `ui/Select`:** Year, Status and "Sort by" are all the
  shared `Select` (a select-only combobox; the native `<select>` below
  `sm` — see `docs/design.md`, "Components"), in both History and Items.
  History passes `ReceiptFilters` its new `equalColumns` prop: Year,
  Status and Sort by fill the row as three equal columns from `md` up
  (`grid grid-cols-1 gap-3 md:grid-cols-3`, right edge aligned with the
  list card), stacked below `md`. Items' row layout is unchanged
  (fixed-width Year/Status, search + its own Sort by `Select` beside
  them). Tests pick and read options through `src/test/select.ts`
  (`selectControl` = the `combobox` role by name — both forms have it,
  and the custom listbox shares the label, so `getByLabelText` would
  find two elements; `chooseOption`, `selectValue`, `optionLabels`).
  **Sort by (`src/historySort.ts`):** the "Sort by" `Select` (`extraFilter`
  of `ReceiptFilters`) with `RECEIPT_SORT_OPTIONS`: "Date (newest
  first)" `date_desc` (default), "Date (oldest first)" `date_asc`, "Total
  (high to low)" `amount_desc`, "Total (low to high)" `amount_asc`,
  "Recently uploaded" `uploaded_desc`. In the URL as `&sort=`, omitted
  for the default; `effectiveReceiptSort()` maps an unknown value to the
  default. A change remounts like every other filter; both list requests
  (first page and "Show more") send it; "Clear filters" keeps it (an
  ordering preference, not a filter — not part of `anyFilterActive`).
  A non-default sort alone also attaches `&from=` to a row's link, so
  "Back to history" and review mode come back to the sorted list. The
  upload side panel asks for `sort: 'uploaded_desc'` explicitly ("Latest
  uploads" means upload order). Items has its own sort, unchanged.
  **Splitting the history by apartment, with filters:** all state lives in
  the URL (`?view=history&apartment=<id>&year=<v>&status=<v>&sort=<v>`), never
  component state — a tab/select change calls the existing
  `navigateTo()`, which (via `App.tsx`'s `key={locationKey}`) fully
  remounts `ReceiptHistory`, the same mechanism `ReceiptUpload` already
  relies on, so no new "re-fetch on filter change" effect was needed. (A
  `category` param and its select existed here before the expense-category
  feature was removed — see
  [docs/adr/0004-remove-categories.md](docs/adr/0004-remove-categories.md);
  an old URL still carrying `&category=...` is simply ignored, since
  nothing reads that param anymore.)
  `ReceiptHistory` reads the URL once per mount (`readUrlParams()`), then:
  (1) fetches
  `GET /receipts/facets` **unscoped** — always needed for the tab bar's
  counts, and this is also the apartment-id validation source (a URL
  `apartment` not among the returned ids is dropped, never sent to the
  list endpoint); (2) if that leaves a valid apartment, fetches
  `GET /receipts/facets?apartment_id=...` **again**, scoped, purely to get
  the Year select's `years`/`has_undated` limited to that apartment (its
  `apartments`/`total` are discarded — ticket-specified behavior: only
  years/`has_undated` are apartment-scoped); (3) validates `year`
  (`/^\d{4}$/` or `"none"`) and `status` (the two literal allowed values)
  structurally, each invalid value simply dropped (never sent) rather
  than erroring — this is "ignored," distinct from a well-formed value
  that legitimately matches zero receipts; (4) calls `listReceipts(...)`
  with whatever survived. The tab bar and the Year/Status selects are
  rendered by the shared `ReceiptFilters.tsx` component (see "Items view"
  below) following the WAI-ARIA tabs pattern:
  `role="tablist"` (`aria-label="Apartment"`), one `role="tab"` per
  apartment plus a leading "All apartments (N)" (the count suffix is
  built by `ReceiptHistory` itself, before handing the `tabs` prop to
  `ReceiptFilters` — Items builds the same shape without it). Each
  apartment tab's visible text is `` `${apartmentShortName(name) ??
  name} (${count})` `` (e.g. "Waldglück (17)"), but its accessible name
  and `title` tooltip are the *full* name, via `FilterTab`'s optional
  `accessibleName` field (`ReceiptFilters.tsx` sets it as the tab
  `<button>`'s `aria-label`/`title` when given, falling back to `label`
  otherwise — the Items view's tabs pass no `accessibleName`, so their
  behavior is unchanged); the leading "All apartments (N)" tab is
  untouched either way. Roving
  `tabIndex`
  (selected = `0`, else `-1`), `aria-selected`, and selected = bold text +
  white background/shadow against the tab bar's `slate-100`, never color
  alone. Arrow keys/Home/End navigate immediately (automatic activation);
  since that navigation remounts the whole page, a one-shot
  `sessionStorage` key (`receiptHistoryFocusTabIndex` for History,
  `receiptItemsFocusTabIndex` for Items — each page passes its own via
  `ReceiptFilters`' `focusSessionKey` prop so they never collide) is
  read/cleared by a mount-only effect **inside `ReceiptFilters`
  itself** (it only ever mounts once its page has already left its own
  loading state, so "the tab bar exists in the DOM" and "`ReceiptFilters`
  just mounted" are the same moment) to restore keyboard focus to the
  newly selected tab across that remount. The Year/Status row sits
  `md:flex-row` (768px — moved from `sm:flex-row`/640px) the same way the
  Items view's own filter row already did; `ReceiptFilters.tsx`'s row
  wrapper class no longer branches on whether `extraFilter` is given for
  this ("Tidying History filters" in
  [docs/design.md](docs/design.md) has the exact before/after classes
  and confirms the Items view's own branch is byte-identical, a no-op).
  **Pages (`PAGE_SIZE = 12`, `ui/Pagination.tsx`):** the page is in the
  URL as `&page=N` (omitted for page 1); `parsePage()` treats a missing
  or invalid value as page 1, and a page past the end (known once the
  first response's `total` arrives) is refetched as the last page, with
  the address bar corrected via `replaceState`. Each page fetches
  `limit: 12, offset: (page - 1) * 12`. With one page, the line above the
  list keeps today's `role="status"` "N receipts"; with more, that count
  moves under the list: "Showing a–b of N" (`role="status"`,
  `tabIndex={-1}`) on the left and `Pagination` on the right. A page
  change is a full remount like every filter; a pagination click sets a
  one-shot `sessionStorage` flag (`receiptHistoryFocusPageSummary`) so
  that, once the new page has loaded, the list's top is scrolled into
  view and focus moves to that summary (the browser's Back/Forward never
  sets it). Changing the tab, Year, Status or Sort, and "Clear filters",
  drop the page (back to page 1). "Show more", its append logic and its
  error/Retry state are gone from History (Items keeps its own "Show
  more"; review mode keeps its own 200-receipt snapshot). A
  `requestIdRef` still guards the main load against stale replies. "Clear
  filters" shows only when a year/status select (not just an
  apartment tab) is active, and resets both, leaving the
  apartment tab alone, per spec. The plain "No receipts yet..." empty
  state is reserved for truly no filters at all (`isUnfiltered`); any
  other empty result shows "No receipts match these filters." instead,
  relying on the one "Clear filters" button above rather than a second
  copy. Opening a receipt attaches `&from=<encoded search>` to
  `?receipt=<id>` **only** when a tab/filter (or a non-default sort, or a
  page past the first — so "Back to history" returns to the same page) is
  actually active (so the
  unfiltered case's URL shape is byte-for-byte unchanged, keeping an
  existing test's exact-URL assertion intact); `ReceiptUpload.tsx`'s
  back link reads that `from` param (`getBackNavigation()`, renamed from
  `getHistoryReturnSearch()` when the Items view was added — only trusting
  a value starting with `?view=history` or `?view=items`) to return to the
  same tab/filters (and, for items, the same search), showing "Back to
  history" or "Back to items" accordingly, falling back to the plain
  `?view=history`.
  **Items view (`ReceiptItems.tsx`, `ReceiptFilters.tsx`,
  `src/api/listItems.ts`):** `?view=items` lists every *purchased line
  item* (not receipt) via `GET /items`, reusing `ReceiptFilters` for the
  identical apartment-tab UI — its tabs are built like History's
  (`label: apartmentShortName(a.name) ?? a.name`, `accessibleName:
  a.name`, so the tab shows the short name with its tone dot and is named
  and titled with the full name) but deliberately with **no count
  suffix**, since
  `GET /receipts/facets`'s counts are receipt counts, not item counts,
  and would misrepresent how many rows that tab actually has. State:
  `?view=items&apartment=<id>&year=<v>&status=<v>&q=<v>&sort=<v>`. A search
  box ("Search items or stores", `maxLength={100}`, a `<form>` so Enter
  submits, a "Clear" button shown only once `searchInput` is non-empty)
  commits to the URL on submit, not as-you-type; `effectiveQuery()`
  (local to this file) trims and drops a `q` over 100 chars, same
  "ignored, never sent" spirit as `effectiveYear`/`effectiveStatus`. A
  "Sort by" `<select>` (`SORT_OPTIONS`: "Date (newest first)" `date_desc`
  default, "Date (oldest first)" `date_asc`, "Amount (high to low)"
  `amount_desc`, "Amount (low to high)" `amount_asc`, "Store (A-Z)"
  `store` — the exact five values `GET /items`'s `sort` param accepts)
  sits next to the search box; `effectiveSort()` (local to this file,
  same "ignored, never sent" pattern as `effectiveQuery`) maps an
  unrecognized/missing URL value to the default. `buildItemsSearch()`
  omits `sort` from the URL when it equals the default, same spirit as
  every other "unset means default" param here, but `listItems()` is
  always called with an explicit `sort` (so the request sent and the
  backend's own default agree regardless of what the address bar shows).
  Both are combined into a single `extraFilter` element (search box
  `flex-1`, sort `md:w-48`, row switches to `md:flex-row` from `md` up)
  passed to `ReceiptFilters` as its `extraFilter` prop, so from `md` up
  they sit on the same row as Year/Status (which then get a fixed
  `md:w-48`); `ReceiptHistory` never passes `extraFilter`, so its two
  selects stay `flex-1` (the row itself is `md:flex-row` for both pages —
  see "Tidying History filters" in docs/design.md). Changing the sort,
  like every other filter/search change
  here, fully remounts the page via `navigateTo()`, so paging resets to
  `offset=0` for free — no separate "reset paging" state exists.
  "Clear filters" leaves the chosen sort untouched (sort is an ordering
  preference, not a filter: it's excluded from `anyFilterActive` and the
  filter-summary text), and the existing `requestIdRef` stale-response
  guard and `limit`/`offset` "Show more" pagination are unchanged, with
  `sort` simply threaded through to both `listItems()` call sites.
  **Table (`sm` and up) vs. a card list below it**, via `useMediaQuery`,
  same pattern as `ReceiptResult.tsx` — never both mounted. Both are
  exported presentational components, `ItemsTable` and `ItemCardList`
  (`{items, showApartment, hrefFor, onOpen}`), so `?view=styleguide`
  renders the real thing. The table is
  `table-fixed` with an explicit width on every column except Item
  (`w-24` Date, `w-16` Qty, `w-24` Unit price, `w-24` Line total, `w-44`
  Store with `pl-4` so it never runs into the right-aligned Line total,
  `w-32` Apartment, `w-32` Status — Item absorbs whatever's left),
  so Date and the numeric columns stay `whitespace-nowrap` and never
  wrap. Status (header and cell) is right-aligned, like History.
  **Dividers and receipt grouping:** rows use `border-t
  border-border-subtle` (History's divider token; Items used
  `border-border/40` before); when a row's `receipt_id` differs from the
  row above it (in whatever sort order), it gets the slightly stronger
  `border-t border-border/40` instead, so one receipt's lines read as a
  group — decorative only (`rowDividerClass`). The first row has no top
  divider (the header's own border is there); `tbody` closes with a
  `border-border-subtle` bottom line. `hover:bg-slate-50`, no zebra
  striping. Columns: Date, Item, Qty, Unit
  price, Line total, Store, Apartment (only in the "All apartments" tab,
  via `showApartmentColumn = effectiveApartmentId === null`), and
  Status. Each cell is its own small exported component (`DateCell`,
  `ApartmentCell`, `QuantityCell`, `MoneyCell`, `StoreCell`, `StatusCell`
  — exported specifically so `StyleGuide.tsx` can reuse the exact same
  rendering instead of re-deriving it) that renders `MissingValue`
  (dash + hidden "Not detected") for a missing value instead of the
  plain visible words. `DateCell` calls `formatDisplayDate()`: a `"date"`
  result shows its `DD.MM.YYYY` text; a `"raw"` result shows the raw text
  next to a small warning icon, `title="This date could not be read as a
  valid date. Open the receipt and fix it with Edit."`, and a visually
  hidden "Date not recognized"; `"missing"` renders `MissingValue`.
  `ApartmentCell` renders `apartmentShortName(name)` inside a small
  outlined pill with the full name in `title`. `StoreCell` wraps its text
  in `ClampedText` (1 line). **Whole-row link (`ItemRowLink`):** the item
  name is the row's one real `<a>` — plain `font-medium text-ink`, no
  underline (it used to be an underlined link) — wrapping `ClampedText`
  (2 lines) when non-null, else `MissingValue`. Its `::after`
  (`after:absolute after:inset-0`) is stretched over the whole `<tr>`
  (which is `relative`), so a click anywhere on the row follows it, and
  the row's focus ring is that `::after`'s inset outline
  (`focus-visible:after:outline … -outline-offset-2`). Its `href` is the
  full receipt URL including `&from=` (`receiptHref`, same as History's),
  so a new tab keeps the way back; a plain click calls `navigateTo` with
  that same URL, while ctrl/cmd/shift/alt-click or a non-primary button
  is left to the browser. `StatusCell` renders the
  existing `StatusBadge` for a recognized status, else `MissingValue`.
  Amounts use `formatMoney` **with** `includeCurrency` (its default)
  rather than `false`, since — unlike `ReceiptResult.tsx`'s
  one-currency-per-receipt table — rows here can carry different
  currencies, so each amount must say which one (e.g. "€4.99" or
  "USD 4.99").
  **Cards** (below `sm`) are whole-card links the same way (`relative`
  `li`, `hover:bg-slate-50`, the same `ItemRowLink`) and show the name (2 lines), a muted
  "`DateCell` · store" line, an amount line that keeps "Qty"/"Unit
  price"/"Line total" as plain text next to each value, and a badge row
  (`ApartmentCell` in "All apartments", `StatusCell` always).
  **A summary bar above the table**: on the left, `role="status"` "N
  items" — only when everything fits on one page (the former "`count` of
  `total` items" was removed: with pages, the "Showing a–b of N" line
  under the table says the same); on the right, `filterSummaryText`
  joins whichever of apartment short name / year (or "No valid date") /
  the `STATUS_OPTIONS` label / `"query"` are actually active with ` · `
  (e.g. `Waldglück · 2026 · Approved · "milch"`, omitting any inactive
  part), next to the existing "Clear filters" button (shown under the
  same `anyFilterActive` rule as before — the apartment tab alone never
  shows it).
  **Pages (`PAGE_SIZE = 20`, `ui/Pagination.tsx`, `src/pageParam.ts`):**
  the same pattern as History — `&page=N` in the URL (omitted for page
  1); `parsePage()` (shared with History) maps a missing/invalid value to
  page 1, and a page past the end is refetched as the last page with the
  URL corrected via `replaceState`. Each page fetches `limit: 20,
  offset: (page - 1) * 20`. Under the table/cards: "Showing a–b of N"
  (`role="status"`, `tabIndex={-1}`) and `Pagination` (its compact form
  below `sm`), hidden when there is only one page. A pagination click
  sets a one-shot `sessionStorage` flag (`receiptItemsFocusPageSummary`)
  so the new page scrolls the table into view and focuses the summary.
  Changing the tab, Year, Status, search or sort, and "Clear filters",
  drop the page. Row links' `from=` includes the page, so "Back to items"
  returns to it. The receipt-grouping divider restarts on every page (the
  first row of a page has no top divider). "Show more", its append logic
  and its error/Retry state are gone. **Race safety:** a `requestIdRef`
  plus the per-mount `cancelled` closure guard the load (every page or
  filter change is a full remount). Loading/error/empty states otherwise mirror `ReceiptHistory`'s
  shape exactly (`role="status" aria-busy="true"` + "Loading items...",
  `Alert variant="error"` + Retry, "No items yet. Upload a receipt." vs.
  "No items match these filters." + "Clear filters").
  **Apartment tones (`src/format/apartmentTone.ts`,
  `ui/ApartmentTone.tsx`):** each apartment has a colour (Bergblick sky,
  Waldglück fuchsia, anything else neutral). `ApartmentPill` (soft pill +
  icon) shows the apartment in History rows, Items' `ApartmentCell` (now
  `{name, apartmentId?}`) and the upload side panel's latest uploads;
  `ApartmentDot` (decorative) sits before the name in the apartment tabs
  (`ReceiptFilters.tsx`, any tab whose `id` isn't `null`), the apartment
  choice cards (`RadioCardOption.leading`), the Report's apartment cards
  and the side panel's per-apartment counts. Names stay visible; full
  names stay in `title`/accessible names. See `docs/design.md`
  ("Components") for the tokens, ratios and how to change a tone.
  **Display helpers (`src/format/formatDisplayDate.ts`,
  `src/format/apartmentShortName.ts`, `ui/MissingValue.tsx`,
  `ui/ClampedText.tsx`):** added for the Items table redesign (see
  [docs/design.md](docs/design.md)) but usable anywhere. **Rule: display a
  stored `purchase_date` in a fixed, non-raw format only through
  `formatDisplayDate()`** — never `Date`/`Intl`/`toLocaleDateString()`,
  which introduce time-zone/locale drift the server's stored value was
  never subject to. It returns `{kind: "date", text: "DD.MM.YYYY"}` for a
  real, valid `YYYY-MM-DD` date (leap years handled by hand, no `Date`
  object ever constructed), `{kind: "raw", text}` for any other non-blank
  value (trimmed, shown as-is — a date the AI read wrong stays visible,
  never hidden), or `{kind: "missing"}` for `null`/blank.
  `ReceiptHistory.tsx` (via `DateCell`) and `ReceiptResult.tsx` (via
  `PurchaseDateMeta`) both show `purchase_date` through
  `formatDisplayDate()` now; `ReceiptResult.tsx` still uses the plain
  `displayText()` for its other text fields (store, currency, item names).
  `apartmentShortName(name)` returns the apartment's full name's last
  `" - "`-separated segment (e.g. `"Fewo JoJo - Sankt Englmar -
  Waldglück"` -> `"Waldglück"`), falling back to the whole trimmed name
  when there's no separator or the last segment is empty — a display-only
  convenience; a `short_name` column would be the cleaner long-term fix.
  `MissingValue` renders a decorative `aria-hidden` dash plus `sr-only`
  "Not detected" (quieter than the plain visible words, same findable
  text). `ClampedText` wraps text in Tailwind's native `line-clamp-1`/
  `line-clamp-2` (built into Tailwind v3.3+, no plugin) with a `title`
  carrying the full text (omitted when empty) so a 100+ character product
  title can't blow out a row's height.
  **Yearly report (`ReceiptReport.tsx`, `src/api/getReportYears.ts`,
  `src/api/getYearlyReport.ts`, a fourth nav link "Report"/`?view=
  report`):** reads `GET /reports/years` and `GET /reports/yearly?year=
  &basis=`. State lives in the URL (`?view=report&year=<v>&basis=
  approved`) — `basis=all` (the backend's own default) is the one value
  never written to the URL; only an explicit `basis=approved` opt-in is.
  The checkbox is "Only count receipts I approved" (unchecked by
  default). An invalid/missing `year` falls back to the newest loaded
  year, same "ignored, never sent as given" spirit as every other filter
  in this app.
  **No arithmetic on money in the frontend:** the backend's amounts are
  already-rounded decimal strings (e.g. `"1234.56"`, `"-12.50"`).
  `formatMoneyFromString()` (`components/ui/formatMoney.ts`) displays
  one with its digits exactly as given, with its currency prefix — never
  parsed into a number and re-formatted. **Thousands separators (both
  helpers):** `groupThousands()` inserts a comma every three digits of
  the integer part of the finished amount string (`"1238.45"` ->
  "€1,238.45", `"-1000.00"` -> "-€1,000.00", "USD 12,345.67") — string
  handling only, never a number; anything that isn't a plain decimal
  string is left unchanged. The CSV/ZIP exports are unaffected (backend).
  **Currency display (both helpers):** EUR
  shows as "€8.49"/"-€0.12" (minus before the symbol; matched
  case-insensitively), any other currency keeps its code ("USD 4.99",
  "USD -0.12") — pure string placement around the finished amount.
  `currencySymbol(currency)` ("€" for EUR, else the code) labels amounts
  in headings: the receipt table's "Unit price (€)"/"Line total (€)",
  "Discounts (€)"/"Taxes (€)", the Report's per-currency headings and
  captions. The receipt meta line's currency field, the edit form's
  currency input and the exports keep the code. This is also why the monthly table has **no
  combined "Both" column**: `GET /reports/yearly`'s `overall` field has
  no monthly breakdown (only each apartment's own `months` does), and
  summing two apartments' decimal strings to produce one would be
  exactly the arithmetic this rule forbids — the monthly table shows one
  column per apartment only (documented in `ReceiptReport.tsx` itself).
  **Page order** (top to bottom): header (the description follows the
  basis), Year select and "Only count receipts I approved"; the summary
  cards; "Show by month"; "For your tax advisor" (with its short note);
  the VAT note.
  **Summary**: one `Card` per apartment (`apartmentShortName` visible,
  full name in `title`) whose whole surface is the apartment's tone —
  `Card`'s `surface` prop with `apartmentToneClasses(id).card` — solid
  in the tone's main colour, the same as its dot (`bg-apartment-sky` /
  `bg-apartment-fuchsia`), no border — with white text: the helper's
  `cardText` (`text-white`) for the name and amount and `cardMutedText`
  (`text-white/90`) for "N receipts" and the empty message (an unknown
  apartment gets the plain card with ink text) — a right-aligned,
  tabular-nums amount per currency plus "N receipts", then a combined
  "Both apartments" card built straight from the backend's own `overall`
  (never summed from the apartment cards): `Card variant="emphasis"`,
  solid `bg-slate-700` with the same white text, so the three cards read
  as one set. Contrast (asserted and printed): white ≥ 5.93:1 and
  white/90 ≥ 5.13:1 on all three. An apartment with no data shows "No
  approved receipts in `<year>`." (`basis=approved`) or "No receipts in
  `<year>`." (`basis=all`).
  **Show by month**: a closed `<details>` directly under the summary
  cards — no card of its own. When open, one table per currency present
  in any apartment's `months`, with **all 12 months** January–December
  (`ALL_MONTHS`, `MONTH_NAMES` — no locale dependence) and one column per
  apartment; a cell with no data shows a plain dash. The currency
  sub-heading appears only when the year has more than one currency.
  From `sm` up it's a table, below `sm` a list of cards — only one ever
  mounted (`useMediaQuery`).
  **No checks card, no warnings/duplicates lists:** the former "Before
  you send it" card (and before it "Quick check", "Receipts not in these
  totals" and "Largest receipts") is gone; what's still open is a short
  note inside the export card (below). The Report no longer lists the
  receipts with warnings (the backend still sends `attention` and
  `largest`; nothing reads them); possible duplicates are counted in the
  note and listed under its "Show possible duplicates". A History "Has warnings" filter would be the new
  home for the warnings list (not built).
  **VAT note**: "Totals are the amounts printed on the receipts,
  including VAT. Ask your tax advisor how to use them." — once, the
  page's last element (`VAT_FOOTNOTE`, exported).
  **Loading/error/empty**: `role="status" aria-busy="true"` with the
  exact text "Loading report...", `Skeleton` blocks; `Alert` + Retry on
  error; "No dated receipts yet. Upload and approve receipts to see the
  report." when `GET /reports/years` returns no years (no Year select
  in that case).
  **Download controls for the yearly export (`ExportCard`, exported from
  `ReceiptReport.tsx`; `src/api/reportExportUrl.ts`):** a "For your tax
  advisor" `Card` at the end of the page (just above the VAT note).
  **Its note (`ExportNote`, from `openItems` = `exportOpenItems(report,
  basis)`, in `src/reportOpenItems.ts`), above the buttons, only when something is open:** one line
  "N not reviewed · M with warnings · K possible duplicates" (K =
  `possible_duplicate_groups`, singular "1 possible duplicate") — "not approved" under
  `basis=approved` (`excluded.not_approved`), else `counted_unreviewed`;
  a zero part is left out — with a right-aligned "Review them" link to
  `?view=history&year=<year>&status=needs_review` (shown only while the
  not-reviewed count is above 0; with only warnings it would open an
  empty list); then one line per non-zero "not in these totals" bucket:
  "N receipts have no valid date" (link to `?view=history&year=none`)
  and the plain "no total"/"no currency"/"no apartment" texts ("Open the
  receipt and fix it with Edit."); then, when K > 0, a closed
  `<details>` "Show possible duplicates" with the former list
  (`DuplicatesList`, restored from git): one line per group "store,
  date, total", an "Open N" link per receipt (`ReceiptLink`, modified
  clicks left to the browser) and the muted "Both are counted in the
  totals until you delete one." A re-photographed receipt is counted
  twice until one copy is deleted, so this stays visible. Every line starts with the warning
  icon. Nothing at all when everything is zero (and none for the
  no-year card). The card gives two plain `<a href>`
  links to the backend's `GET /reports/yearly/export.csv`/`.zip` — same
  "no fetch, the server's own `Content-Disposition` header triggers the
  download" contract as "Download PDF" in `ReceiptFileViewer.tsx`
  (whose `DownloadIcon` is exported and reused here rather than
  duplicated). `reportExportCsvUrl(params)`/`reportExportZipUrl(params)`
  (`{year, basis?, style, apartmentId?}`) build the query string with
  `URLSearchParams`, following `getYearlyReport.ts`'s own convention for
  `basis` (omitted entirely when `"all"`) — **except `style`, which is
  always sent, even for the default `"excel_de"`**, so the downloaded
  file's format can never silently depend on the backend's own default
  changing later (the one deliberate difference from the `basis`
  convention). `ExportCard` takes `year`/`basis`/`apartments` as props (presentational, exported specifically so
  `StyleGuide.tsx` and tests can render it directly with static data,
  the same pattern `ApartmentCell`/`HistoryRow`/etc. already use) and
  keeps the chosen apartment and CSV style in its own component state —
  deliberately never written to the URL or persisted across a reload,
  unlike Year/basis, since this is a one-off export choice rather than a
  saved view. The "Apartment" select ("All apartments" plus each
  apartment from `useApartments(true)`, short name visible via
  `apartmentShortName`, full name in the option's `title`) and "CSV
  format" select ("German Excel (semicolon, decimal comma)", the
  default value `"excel_de"`, or "Plain (comma, decimal point)",
  `"plain"`) sit in a closed `<details>` "Export options" below the two
  links (ZIP primary, CSV secondary), since the defaults fit almost
  every export; Year and
  "Only count receipts I approved" are read from the surrounding view,
  never duplicated here, and also shown as plain text next to the links
  ("`2026, all receipts`"/"`2026, approved receipts only`"), so a
  Year/basis change (a full remount, like every other filter in this
  app) updates both the hrefs and that text together. When there is no
  year to export at all (`year === null` — no dated receipts, the same
  condition that already shows "No dated receipts yet..." instead of
  the summary), both links render as non-interactive
  `<span aria-disabled="true">` (same pattern as `ReviewBar`'s disabled
  Previous/Next ends) next to a "Nothing to export yet." hint — the
  selects stay enabled regardless, since choosing ahead of having data
  is harmless. One muted sentence always closes the card: "The ZIP
  contains personal data and is not encrypted; send it only to your tax
  advisor." (The former "Receipts that were not reviewed are included."
  line is gone — the note above covers unreviewed receipts.) No request is ever made for the export
  itself — only a click on a link triggers the browser's own download;
  `ExportCard` never calls `fetch`. In `?view=styleguide`: the summary
  cards, `ExportCard` with its note under each basis, with nothing open
  (no note), and with `year={null}`, and the VAT note.
  **Changing the apartment on a saved receipt (`ReceiptApartment.tsx`,
  `src/api/updateReceiptApartment.ts`):** rendered by the saved-receipt
  container (the same `if (result)` branch used right after extraction and
  when reopening `?receipt=<uuid>`) directly above `ReceiptResult` —
  `ReceiptResult.tsx` itself is never touched. The same `RadioCardGroup`,
  legend "Apartment" — unchanged — with the receipt's `apartment_id`
  selected (or nothing selected, with no extra message, when it's `null`);
  rendered with `RadioCardGroup`'s `layout="inline"`: one compact line —
  the visible legend "Apartment" (a floated `<legend>`, so it sits on the
  same line), then one small pill per apartment showing only
  `apartmentShortName(name) ?? name` (no place line; selected = brand
  border/fill + check icon + bold, never color alone; `h-11` below `sm`,
  `sm:h-10`), then "Saving..."/"Saved" on the same line; an error `Alert`
  goes below. The accessible name (`aria-label` on the radio) and the
  `title` tooltip stay the full name. Same radios, so arrow keys and the
  `radiogroup` named "Apartment" are unchanged. The upload form keeps the
  default `layout="cards"`. It
  fetches
  its own apartment list via `useApartments(true)` (always enabled here,
  since it only mounts in the saved-receipt view), sharing that hook's
  module-level cache with the upload form's. Choosing another card calls
  `PUT /receipts/{id}/apartment`: "Saving..." and the group disabled while
  pending; success calls back up with the response so `ReceiptUpload`
  updates `result` directly (no extra `GET`) and shows "Saved" in a
  `role="status"`; failure shows an `Alert variant="error"` and reverts the
  local selection to what it was before, so picking the same card again
  retries. Hidden while the edit form is open (it's only in the
  non-editing branch); calls neither `extractReceipt` nor the plain
  `updateReceipt`/`PUT /receipts/{id}`.
  **Review status on a saved receipt
  (`ReviewBar.tsx`, `hooks/useReceiptReviewStatus.ts`,
  `ReceiptReviewStatus.tsx`, `ui/StatusBadge.tsx`):** the status control —
  previously `ReceiptReviewStatus.tsx`, rendered next to `ReceiptApartment`
  — now lives in `ReviewBar.tsx`, at the very top of the data column
  (above `ReceiptApartment`), since reviewing many receipts in a row
  means this is the main action, not a small control two sections down.
  The request logic itself (the `PUT /receipts/{id}/status` call, the
  `describeMissing()` 422-message mapping) was extracted into a shared
  hook, `useReceiptReviewStatus(receiptId, onUpdated)`, so `ReviewBar` and
  `ReceiptReviewStatus.tsx` (kept, now unused by the app, for any future
  standalone use — renamed via `git mv`, mechanical rename only, from
  `ReceiptClassification.tsx` when the expense-category feature was
  removed — see
  [docs/adr/0004-remove-categories.md](docs/adr/0004-remove-categories.md))
  both call the exact same logic rather than duplicating it. `ReviewBar`
  is `sticky top-20` under the header from `lg` up (scrolling with the
  data column), or `fixed` to the bottom of the viewport below `lg` (or
  wherever `window.matchMedia` doesn't exist) via
  `hooks/useBottomBarVariant.ts` — only one variant is ever mounted, and
  the surrounding page adds `pb-24` using that same hook so the fixed
  variant never covers content. Rendered only in the non-editing branch
  (so it's hidden on the same condition as `ReceiptApartment`, while the
  edit form is open) — `ReceiptResult.tsx` itself is never touched. A
  `StatusBadge` shows the current `status`
  ("Needs review"/warning-toned clock icon, or "Approved"/success-toned
  check icon — never color alone; `Button.contrast.test.ts` measures the
  real built CSS values for both and asserts 4.5:1, which already passes
  at 4.76:1 — no token change was needed, confirming the badge's
  "small and pale" report was about size/placement, fixed by moving it
  into `ReviewBar`, not about color) next to a primary "Mark as approved"
  button (shown when `needs_review`) or a secondary "Back to needs review"
  button (shown when `approved`); either calls
  `PUT /receipts/{id}/status`, showing "Saving..." and disabling the
  visible button (not hiding it) while pending. A `422` with
  `{detail: {message, missing}}` is turned into a plain-words
  `Alert variant="error"` by `describeMissing()` mapping each
  recognized code (`apartment`/`date` -> "a valid purchase date"/`total`)
  and joining them ("To approve this receipt, also set: apartment,
  a valid purchase date."), appending "You can fix the date with Edit."
  only when `date` is in the list; any unrecognized code (e.g. a stray
  `"category"` from an older cached response) is filtered out rather than
  shown raw or as "undefined"; the status is left unchanged on this
  failure. Calls neither `extractReceipt` nor the plain `updateReceipt`/
  `PUT /receipts/{id}`.
  **Review mode (position, Previous/Next, "Approve and next") —
  `ReceiptUpload.tsx`'s `reviewFromSearch`/`reviewSnapshot` state,
  `ReviewBar.tsx`'s `reviewNavigation` prop:** only when this receipt was
  opened from a *history* list with a tab/filter active (`from` starts
  with `?view=history` — read once at mount via `getHistoryFromParam()`;
  `?view=items` or a missing `from` both mean no review mode at all) does
  `ReceiptUpload.tsx` fetch one snapshot —
  `listReceipts({apartmentId, year, status, sort, limit: 200})` using that same
  `from` value's own filters **and sort** (so "N of M" and Previous/Next
  follow the order the owner saw), parsed with the exact `effectiveYear`/
  `effectiveStatus`/`effectiveReceiptSort` helpers `ReceiptFilters.tsx` already validates its own
  URL params with (`parseHistoryFilters()`) — kept in `reviewSnapshot`
  state. A failed request, or this receipt not being among the (up to)
  200 returned, leaves `reviewSnapshot` without this receipt and
  `ReviewBar` renders with no `reviewNavigation` at all — no `Alert`,
  nothing — exactly like today's behavior; only the first 200 receipts of
  a filter are ever navigable this way. `ReviewBar`'s `reviewNavigation`
  prop then adds "N of M" (`role="status"`, 1-based), "Previous"/"Next" —
  real `<a href="/?receipt=<id>&from=<from>">` links to an existing
  neighbour (so opening one in a new tab works), or a plain, non-
  interactive `<span aria-disabled="true">` at either end — and, only
  when `status === 'needs_review'`, an "Approve and next" button: the one
  primary button, placed first, with "Mark as approved" stepping down to
  `secondary` next to it (outside review mode "Mark as approved" stays the
  only, primary button). **Staying mounted across moves:**
  Previous/Next/"Approve and next" never go through `navigateTo` (whose
  `pushState` + synthetic `popstate` would trigger `App.tsx`'s
  `key={locationKey}` remount, forcing a wasteful re-fetch of the same
  snapshot) — `navigateToReceiptInSnapshot(id)` instead calls the existing
  `setReceiptIdInUrl(id)` (a `replaceState` that only ever touches the
  `receipt` param, leaving `from` — and therefore the already-fetched
  snapshot — untouched) and then `loadSavedReceipt(id)` directly, the
  same two steps this file already used internally after an upload+
  extract. "Approve and next" sends the *exact same* one `PUT
  /receipts/{id}/status` as "Mark as approved", via the same
  `useReceiptReviewStatus` hook — the only difference is what happens
  after a successful response, which `ReviewBar` hands back to its caller
  as `onApprovedAndNext(updated)`, since picking "which receipt is next"
  needs the caller's own snapshot, not something `ReviewBar` itself
  tracks. That handler (`handleApprovedAndNext`) updates the snapshot's
  matching entry's `status` locally (never refetched), searches the
  snapshot *forward* from the just-approved position for the next
  `needs_review` entry (silently skipping any already-approved one in
  between), and navigates there the same way; when none is left, it calls
  `navigateTo` with the original `from` plus `&notice=reviewed`, landing
  on the filtered history list with a new one-shot notice
  (`ReceiptHistory.tsx`'s `getAndClearNotice()` gained this `"reviewed"`
  case — `"All receipts in this list are reviewed."` — alongside its
  existing `deleted`/`gone` cases, same strip-on-read pattern). A `422`
  from "Approve and next" behaves exactly like one from "Mark as
  approved" and never navigates.
  **Editing (`ReceiptEditForm.tsx`, `src/api/updateReceipt.ts`):** an
  "Edit" button in `ReceiptResult.tsx`'s own header (next to the store
  name, which is the page's `<h1>`) opens a form prefilled from the
  current data, with add/remove rows for
  items/discounts/taxes. **Save** sends `PUT /receipts/{id}` with *only*
  the editable fields (never `receipt_id`/`created_at`/
  `original_filename`/etc.) and updates the view straight from the
  response — no extra `GET`. Empty text/number inputs are sent as `null`;
  non-numeric amounts are caught client-side (inline error, no request
  sent) before anything reaches the server; a `422` is turned into
  readable per-field messages via `updateReceipt.ts`. **Cancel** discards
  all changes and sends no request. A stored `purchase_date` that isn't a
  valid ISO date renders as a plain text input (not `<input type="date">`,
  which would just show blank) with an "Original: ..." hint below it —
  *unless* `extractLeadingIsoDate()` (mirroring the backend's
  `normalize_purchase_date`) finds a leading ISO date in it (e.g.
  `"2025-06-26 11"`), in which case the `<input type="date">` is prefilled
  with just that leading date instead (never the raw text, which the
  server would reject) and no hint is shown. `focusField` (`'purchase_
  date' | 'total' | null`, default `null`) is set only by "Fix in Edit"
  (see below); a mount-only `useEffect` (never re-running on a later prop
  change within the same form instance) then focuses the matching input
  — `dateInputRef` (attached to whichever of the `<input type="date">`/
  plain-text date input actually renders) or `totalInputRef`.
  Never calls the extract endpoint.
  **Data-quality warnings, Edited badge, reset
  (`ReceiptResult.tsx`, `src/api/resetReceipt.ts`):** when `data.warnings`
  is non-empty, `ReceiptResult` renders an `Alert variant="warning"`
  ("Check these values" + bulleted messages, with only the `Alert`'s own
  icon — a second, inline icon was removed) above the data card; empty
  `warnings` renders nothing, and warnings never block any action. The
  "Check these values" line has `id={WARNINGS_HEADING_ID}` (exported,
  `'receipt-warnings-heading'`) and `tabIndex={-1}`, with a `focus:` ring
  (not `focus-visible:`, since it's only ever focused by a click):
  `ReviewBar`'s `warningCount`/`warningsTargetId` props (passed by
  `ReceiptUpload.tsx` as `result.warnings.length` and that id) show, only
  while `status === 'needs_review'` and the count is non-zero, a link
  "1 warning to check"/"N warnings to check" (warning icon + text,
  `text-warning` underlined, 4.92:1 on white) — a real `href="#<id>"`
  whose click calls `scrollIntoView({block: 'center'})` (clear of the
  sticky/fixed bar, no smooth scrolling) and then `focus({preventScroll:
  true})` on that line. It never blocks or disables approving.
  **"Fix in Edit"**: a warning whose `field` is exactly `purchase_date` or
  `total` (the only two `check_receipt` field names with one single input
  to jump to) additionally renders a small "Fix in Edit" button next to
  its message; every other warning (`store_name`, an `items[n]` line
  mismatch) stays text-only. Clicking it calls `onEdit(field)` —
  `ReceiptResult`'s `onEdit` prop is `(focusField?: 'purchase_date' |
  'total') => void`, the plain "Edit" button in the header still calling
  it with no argument. `ReceiptUpload.tsx` stores the given field as
  `editFocusField` state and passes it through to `ReceiptEditForm` as
  its new `focusField` prop (see above).
  **The meta line's `purchase_date`** (`ReceiptResult.tsx`'s
  `PurchaseDateMeta`, `UNRECOGNIZED_DATE_TITLE` now exported from
  `ReceiptItems.tsx` rather than duplicated): follows the exact same rule
  the Items table's `DateCell` already uses, via the same
  `formatDisplayDate()` — a valid ISO date renders as `DD.MM.YYYY` (its
  `aria-label`, "Date: ..., Currency: ...", says the same); an unrecognized
  value shows that raw text next to a small warning icon, the same
  `title`, and a hidden "Date not recognized"; a missing date renders
  `MissingValue`.
  **Discounts/Taxes summary**: each section heading is
  `Discounts${currencyLabel}`/`Taxes${currencyLabel}` (the same
  `currencyLabel` the item table's own column headers use, e.g.
  "Discounts (USD)") when currency is known, and `AmountRow` now calls
  `formatMoney(amount, currency, {includeCurrency: false})` — right-
  aligned, tabular, no per-row currency prefix (previously "EUR -0.24",
  which could misread as tax added on top of the total). A `null`
  currency simply drops the heading suffix; `formatMoney` already falls
  back to a plain number regardless of `includeCurrency`, so nothing
  else changes. With no discounts at all, the Discounts heading and its
  "None detected" collapse into one muted line, `` `Discounts${currencyLabel}:
  None detected` `` (Taxes keeps its heading + "None detected").
  **Total row:** "Total" on the left, the amount (`formatMoney`, with
  currency) right-aligned and `tabular-nums`, ending at the card's right
  padding like the table's Line total column. The exact string
  `` `Total: ${formatMoney(total, currency)}` `` stays in the DOM as an
  `sr-only` span (read once by screen readers, still what tests find); the
  two visible parts are `aria-hidden`.
  **Card border:** the data card (and `ReceiptFileViewer`'s card) use
  `border-border-subtle` — decorative containers, not controls.
  An "Edited" badge (warning-toned, `edited_at` in its `title`) sits next
  to the store name when `data.edited` is `true`. In the surrounding
  container, a secondary "Reset to AI result" button appears only when
  `edited` is `true`, at the opposite end of the footer row from the
  danger-ghost Delete button; clicking it shows an in-page confirmation
  (`Alert variant="warning"`, same pattern as the delete confirmation) —
  nothing sent until "Yes, reset"; pending shows "Resetting..." with every
  button in that panel disabled; success swaps in the response data
  directly (no extra `GET`); failure keeps the current data with the error
  shown, so the user can retry. Hidden while the edit form is open; never
  calls extract or PUT. `resetReceipt()` POSTs to
  `/receipts/{id}/reset`, same `ApiError` pattern as `deleteReceipt.ts`.
  **Original file viewer (`ReceiptFileViewer.tsx`, `src/api/receiptFileUrl.ts`,
  `src/api/receiptArchiveUrl.ts`,
  `ReceiptDetailLayout.tsx`):** `receiptFileUrl(id)` builds the
  `GET /receipts/{id}/file` URL (no `fetch` — an `<img src>`/`<iframe src>`
  loads it directly, so no CORS is needed). `ReceiptFileViewer` decides
  image vs. PDF from `contentType` first, then the filename extension,
  else defaults to image. Renders as a framed card: a header row with
  icon zoom/fit controls for
  images (`aria-label`s "Zoom out"/"Zoom in"/"Fit", 50%–300%) plus a
  "Rotate" button (icon + visible "Rotate", `aria-label` "Rotate 90 degrees
  clockwise"; images only, never shown for a PDF), an
  "Open original" link-styled `<a>` (kept a real anchor, not the `Button`
  component, so it stays `role="link"` for `target="_blank"`), and a
  "Download PDF" link-styled `<a>` right next to it, built from
  `receiptArchiveUrl(id)` (`GET /receipts/{id}/archive.pdf`) — a plain
  `href`, no `fetch`/CORS needed here either, since the server's
  `Content-Disposition: attachment` header is what makes the browser
  download it. Shown for both image and PDF receipts (unlike the zoom
  controls, which are image-only) and hidden together with "Open
  original" on the same `hasError` condition (a failed image load); a body with
  a `slate-100` background (so a white receipt stands out) that is either
  the image/iframe or, on a failed image load, an `Alert` with "The
  original file is not available." instead of a broken image. The PDF
  iframe's `src` is `` `${fileUrl}${PDF_VIEW_FRAGMENT}` `` —
  `PDF_VIEW_FRAGMENT = '#view=FitH&navpanes=0'` (exported) — a PDF open
  parameter fragment Chrome and Edge honor (fit the page to width, hide
  the side thumbnail panel), avoiding the double toolbar/horizontal-
  scrollbar/empty-area effect their default plugin viewer otherwise shows
  at this iframe's width; any other browser simply ignores an
  unrecognized fragment, and the browser's own PDF toolbar is never
  hidden (only the plugin's optional extras are).
  **Toolbar, one row:** zoom out, zoom % (`tabular-nums`), zoom in, Fit
  and Rotate as one group on the left (images only); "Open original" and
  "Download PDF" as a second group on the right. The row is `flex-wrap
  justify-between`: a lone item on a wrapped line sits at the start, so
  in a narrow panel the links' line starts at the left edge (no leading
  gap). A PDF has no view controls; an empty `aria-hidden` spacer keeps
  its links on the right. After a failed image load the whole row is left
  out. The file name is not shown as text: it is the "Open original"
  link's `title` and part of the image's `alt` ("Original receipt image
  (<name>)") / the PDF iframe's `title`. The links
  (`LINK_BUTTON_CLASSES`) copy `Button`'s `secondary`/`sm` classes: `h-11`
  (44px) below `sm`, `sm:h-10`, `rounded-control`, `font-medium`, `gap-2`.
  **Zoom (`imageLayout`):** zoom is relative to a *fitted* size, computed
  from the image's natural size (from `onLoad`) and the image area's
  measured size (`useElementSize`: a `ResizeObserver`, falling back to
  `requestAnimationFrame` + window `resize` where it doesn't exist): from
  `lg` up (`useMediaQuery('(min-width: 1024px)')`) the fitted scale makes
  the whole (rotated) image fit the area's width *and* height; below `lg`,
  its width only (as before). A box of the rotated image's pixel size
  (`margin: auto`, rounded to 2 decimals) takes its place in the layout,
  and the `<img>` inside is absolutely centered at its unrotated pixel
  size and rotated. Until both sizes are known (e.g. jsdom) the earlier
  percentage layout is used (`width: zoom%`, a wrapper for 90°/270°).
  **The zoom bug (fixed):** Tailwind's base styles set `img { max-width:
  100% }`, which silently capped the unrotated image's `width: 125%…300%`
  at the panel width, so zoom-in did nothing; and the image was centered
  with `justify-center`/`items-center`, which puts any overflow past the
  left/top edges where it can't be scrolled to. Now every `<img>` style
  sets `max-width: none`, and centering uses `margin: auto` (which
  collapses to 0 once the image is larger than the area), so a zoomed
  image scrolls to every edge. `ReceiptFileViewer.test.tsx` asserts both
  the `max-width` and the exact pixel sizes per zoom step.
  **Rotate (view only):** 0°/90°/180°/270°, never saved or sent anywhere.
  Stored together with the receipt id it was set for, so it reads as 0°
  the moment another receipt loads into the same mounted viewer (e.g.
  Previous/Next in review mode, which never remounts it) — no effect
  needed. Rotation swaps the box's width/height, so Fit and every zoom
  step apply to the rotated shape. Moving the `<img>` into/out of the
  wrapper re-creates the element (tests re-query it). An optional
  `fileUrl` prop exists only for `?view=styleguide`'s static samples; the
  app never passes it.
  **Height:** from `lg` up the viewer card is exactly
  `lg:h-[calc(100vh-6rem)]` (images and PDFs alike), its body `min-h-0
  flex-1 overflow-auto` so a zoomed image scrolls inside it; the image
  area is `lg:bg-surface-page` (`slate-100` below `lg`, unchanged). Below
  `lg` the height is unchanged (natural height for an image, 600px for a
  PDF).
  `ReceiptDetailLayout` wraps the saved-receipt view (`ReceiptResult`) and
  the edit view (`ReceiptEditForm`) in a shared two-column layout
  (`lg:grid-cols-[5fr_6fr]`, file left/data right, file panel
  `lg:sticky lg:top-20 lg:self-start` — it never stretches to the data
  column's height; the viewer inside caps its own height, see above) from
  the `lg` breakpoint
  up, inside the shell's wider `xl` `Container` size; below `lg` it
  renders a "Receipt data"/"Original" segmented control
  (`role="tablist"`/`role="tab"`, `aria-selected`) that toggles visibility
  with CSS only — both panels stay mounted, so typed edit-form input
  survives switching tabs. The extract response has no
  `original_filename`/`content_type` (only `GET /receipts/{id}` does), so
  right after extraction the viewer's filename falls back to the
  just-uploaded `File`/upload response and its content type is treated as
  unknown (extension-based detection). Every conditional class name here
  (and throughout the app) picks between complete static strings — never
  built by concatenating a variable into a class name — since Tailwind's
  JIT only generates CSS for literal class-name text it finds in the
  source.
  **"Upload another receipt" placement:** a text-style `<button>` (brand
  color, underlined, `min-h-[44px]` below `sm`) — it looks like a link but
  stays a button, since it resets this page's state rather than loading a
  URL — next to the
  "Back to history"/"Back to items" link, in one row above the two-column
  layout (`ReceiptDetailLayout`) — moved there from a `secondary` button at
  the bottom of `ReceiptResult`'s own card (that button, and the `onReset`
  prop that rendered it, are gone from `ReceiptResult.tsx`). Both links in
  that row are hidden together while a delete confirmation is open.
  **Deleting (`src/api/deleteReceipt.ts`):** a `danger-ghost` "Delete"
  button, in the surrounding container below `ReceiptResult` (separated
  from it by a divider — destructive and comparatively rare, unlike Edit,
  which is primary and in the header), hidden while the edit form is open,
  opens an in-page confirmation styled as a danger `Alert` (not
  `window.confirm`) — no request until "Yes, delete".
  A `204` navigates to `?view=history&notice=deleted` (a one-shot URL
  param `ReceiptHistory.tsx` reads once on mount, displays as "Receipt
  deleted.", then immediately strips via `replaceState` so a reload never
  redisplays it); a `404` navigates there with `notice=gone` ->
  "This receipt no longer exists." instead. Network/5xx failures keep the
  receipt on screen with the error shown so the user can retry — nothing
  is navigated away on failure. `deleteReceipt` never parses a body on
  success (a `204` has none).
  **Mobile-friendly items (`useMediaQuery`, `ReceiptResult.tsx`):**
  `src/hooks/useMediaQuery.ts` wraps `window.matchMedia`, returns `false`
  when it doesn't exist (jsdom's default — existing tests need no mock),
  and updates live on change with listener cleanup. Below `sm`
  (`max-width: 639px`), `ReceiptResult` renders items as cards
  (name heading, a Qty/Unit price/Line total definition list, currency
  shown once in the labels) instead of the table — only one variant is
  ever in the DOM, never both hidden with CSS.
  **Image preview (`ReceiptUpload.tsx`):** a valid JPG/PNG gets a thumbnail
  via `URL.createObjectURL` in the selected-file row (PDFs keep the file
  icon). The previous object URL is always revoked before the next one
  is created or discarded — on Remove, on replacing the file, after
  "Upload another receipt", and on unmount (via a ref, so the cleanup
  sees the latest URL) — at most one live URL at a time. jsdom has
  neither `URL.createObjectURL` nor `URL.revokeObjectURL`;
  `src/test/objectUrl.ts` is an explicit per-file mock (not a global
  polyfill) used by every test that selects an image.
  **Shared file validation (`src/fileValidation.ts`) and error messages
  (`src/errorMessages.ts`):** `isValidFile` (extension + MIME),
  `isLikelyValidPdf` (reads the file's first 5 bytes and checks for the
  `"%PDF-"` signature), `getExtension`, and the
  `ACCEPTED_EXTENSIONS`/`ACCEPTED_MIME_TYPES`/`IMAGE_EXTENSIONS`/
  `PDF_SIGNATURE` constants moved out of `ReceiptUpload.tsx` verbatim (no
  behavior change) so the batch upload engine, below, can reuse the exact
  same rules instead of duplicating them; `ReceiptUpload.tsx` now just
  imports them. Likewise `NETWORK_ERROR_MESSAGE`/
  `EXTRACTION_FAILED_MESSAGE`/`EXTRACTION_NOT_CONFIGURED_MESSAGE` (the
  single-file flow's inline constants) moved to `errorMessages.ts`, so
  both flows show the user the exact same wording for the same failure.
  **Batch upload queue engine (`src/batch/batchReducer.ts`,
  `src/batch/useBatchUpload.ts`) — the logic behind the batch UI below:**
  `batchReducer` is a pure `(state, action) => state` reducer (no API
  calls, no side effects) with two exported constants, `MAX_BATCH = 20`
  and `CONCURRENCY = 2`. A `BatchItem` has a local `id`, the `File`, a
  `status` (`"waiting" | "uploading" | "reading" | "done" | "failed"`),
  and optional `receiptId`/`error`/`errorKind`
  (`"upload" | "unreadable" | "unavailable" | "network"`)/
  `warningsCount`/`extracted` (`ExtractedSummary`: `store_name`/
  `purchase_date`/`total`/`currency`, each nullable, copied from the
  extract response by `ITEM_DONE` — set only on a done item, never on a
  skipped/failed one). `BatchState` holds `items`, `rejected`
  (`{fileName, reason}`), `pausedReason`
  (`"unavailable" | "network" | "stopped" | null`), the `apartmentId`
  captured once at `start()`, and `running`.
  `useBatchUpload()` wraps the reducer with a scheduler `useEffect` that
  re-evaluates after every state change: while `running` and
  `pausedReason === null`, it starts as many `"waiting"` items as there's
  room for (`CONCURRENCY` minus however many are currently
  `"uploading"`/`"reading"`) by calling `uploadReceipt` then
  `extractReceipt` directly (not dispatched — a plain async function
  called from inside the effect, which dispatches status-update actions
  as each call settles); once paused or stopped, the effect does nothing
  at all, so in-flight items simply finish on their own via their own
  already-running async calls, and nothing new ever starts. A
  `mountedRef` guards every dispatch inside that async function, so an
  unmount mid-request never triggers a state update.
  **Pause rules:** an upload failing with a real server response
  (any `ApiError`) fails just that one item (`errorKind: "upload"`, using
  `err.message` as-is, exactly like the single-file flow) and the queue
  keeps going; an upload failing with a network error (not an
  `ApiError`), or an extract failing with `503`, fails that item (keeping
  its `receiptId` if the failure happened at the extract step) **and**
  sets `pausedReason` (`"network"` or `"unavailable"`) so no new item
  starts until `resume()` clears it; an extract failing with any other
  server status (e.g. `502`) fails just that item
  (`errorKind: "unreadable"`) without pausing anything. `stop()` sets
  `pausedReason: "stopped"` (same "let in-flight finish, start nothing
  new" behavior); `resume()` clears whatever `pausedReason` is set.
  `retry(itemId)` moves the item to the end of `items` (so
  retries go to the back of the processing order), resets its `status` to
  `"waiting"` (clearing `error`/`errorKind`, keeping `receiptId` if it has
  one — so a retried item that already has a `receiptId` calls
  `extractReceipt` only, never `uploadReceipt` again). `remove(itemId)` is
  a no-op unless the item is `"waiting"` or `"failed"`. `reset()` is a
  no-op if anything is `"uploading"`/`"reading"`. `addFiles(files)`
  validates every file with `fileValidation.ts` (same rejection messages
  as the single-file flow, plus `"duplicate"` for a file whose name, size
  and `lastModified` all match one already in `items`, and a single
  summary rejected entry — not one per file — when accepted files would
  push the queue over `MAX_BATCH`); it *replaces* the whole queue when
  `!running` (re-picking files before starting discards the old
  selection, same spirit as the single-file flow), but *appends* to it
  while `running` (adding more receipts mid-batch). Since `state.apartmentId`
  is only ever set once, by `START`, and never touched by `STOP`/`RESUME`,
  every upload the scheduler ever starts — including retries and anything
  after a `resume()` — uses the exact apartment chosen at the original
  `start()` call. **Test note:** this project's Jest setup (plain esbuild,
  no `babel-plugin-jest-hoist`) doesn't support `jest.mock()`-based module
  mocking reliably, so `useBatchUpload.test.ts` mocks at the `fetch`
  boundary instead (the same pattern every other test file in this repo
  already uses), which exercises the real `uploadReceipt`/`extractReceipt`
  modules underneath.
  **Batch upload UI (`batch/BatchQueue.tsx`, `ReceiptUpload.tsx`):** the
  hidden file input gained `multiple`; picking or dropping exactly 1 file
  keeps the single-file flow byte-for-byte unchanged (same strings,
  button, preview row), picking or dropping 2+ replaces the current
  selection and switches to batch mode, rendering `BatchQueue` in place of
  the single-file row. The 2+ files are sorted by name — natural compare
  via `new Intl.Collator(undefined, {numeric: true, sensitivity: 'base'})`
  (so `"img2.jpg"` sorts before `"img10.jpg"`) — in `ReceiptUpload.tsx`'s
  `handleBatchFilesSelected()`, the one function both `handleFileChange`
  and `handleDrop` call for 2+ files, **before** `batch.addFiles(...)` is
  called — `useBatchUpload`/`batchReducer` themselves are untouched, so
  `addFiles`'s own replace-vs-append/duplicate/`MAX_BATCH` rules stay
  exactly as they were. Both the dropzone and every file input are
  disabled while `isBusy || batch.running` (`isInputDisabled`); selecting
  a single file while a finished/failed batch is still shown calls
  `batch.reset()` first, so the two panels never coexist.
  **The dropzone shrinks once `isBatchActive`:** the full dropzone (icon +
  "Drag receipts here, or" + "Browse files" + the JPG/PNG/PDF subtitle) only
  renders with 0 or 1 file; the moment 2+ files are queued, a separate,
  shorter `role="button"` bar ("Add more files") renders instead, reusing
  the exact same `openFilePicker`/`handleZoneKeyDown`/drag handlers and
  the same hidden `<input multiple>` — still disabled while running. The
  "Take photo" button and the apartment `RadioCardGroup` are unaffected by
  this switch.
  **`BatchQueue.tsx`'s row is one compact ~56px line:** a 40×40px
  thumbnail (`<img>` with `object-contain` on a `slate-100` background for
  an image file, or the file icon in the same box for a PDF), the
  truncated name with a `title`, size via `formatFileSize`, the existing
  icon+text status chip (Waiting/Uploading…/Reading…/Done/Failed — never
  color alone), and an **icon-only Remove button** (`X` icon,
  `aria-label="Remove <file name>"`, same `ghost`/`sm` `Button` so it
  keeps its 44px touch target below `sm` — replacing the old plain-text
  "Remove" button, which is why the one existing test asserting
  `/^remove$/i` on a batch row needed updating to the new
  `'Remove <name>'` name; the single-file flow's own, separate "Remove"
  button is untouched). A **done** row's `<a href="/?receipt=<id>"
  target="_blank" rel="noopener noreferrer">Open</a>`/"Check values (N)"
  badge — preceded by an `ExtractedSummaryLine`, "`<store>` · `<date via
  DateCell>` · `<formatMoney(total, currency)>`" (`MissingValue` for a
  missing part, `DateCell`'s "Date not recognized" marker for a non-ISO
  date; rendered only when `extracted` is set) — and a **failed** row's error text (same shared messages as the
  single-file flow) + "Retry" button, now render on their own line
  *beneath* the main 56px line, so every row's main line stays the same
  height regardless of status. "Remove" is offered for waiting/failed rows
  only, matching the engine's own no-op rule.
  **Thumbnails (`useThumbnails`, inside `BatchQueue.tsx`):** one object URL
  per queued **image** file (checked via `fileValidation.ts`'s
  `IMAGE_EXTENSIONS`/`getExtension` — a PDF never gets one), created
  lazily inside a `useEffect` keyed on `items` (never during render), via
  a `Map<itemId, url>` held in `useState` + a `useRef` mirror (so the
  unmount-cleanup effect always sees the latest map without needing it in
  its own deps). The effect diffs **ids**, not statuses: an id already
  present is left alone (a Waiting→Uploading→Done transition never
  recreates its thumbnail), but an id no longer in `items` has its URL
  revoked immediately — covering Remove, a whole-queue replace before
  starting (`addFiles`'s own "replace when not running" case produces
  brand-new ids), and the panel unmounting entirely on "Read more
  receipts"/reset. A second, unmount-only effect revokes whatever's left
  in the map, covering several thumbnails disappearing at once.
  **Summary line / `<progress>` switch, and the sticky action bar, both in
  `ReceiptUpload.tsx`:** before `batch.running` (never yet started), a
  plain text summary — `` `${batch.items.length} receipts ·
  ${formatFileSize(totalBytes)}` `` plus `` ` · for ${apartmentShortName}`
  `` when an apartment is chosen (`totalBytes` is the **sum** of every
  queued file's size, formatted once, not per-file) — replaces what used
  to always be a `<progress>` element; no `<progress>` exists yet at this
  stage. The moment `start()` flips `batch.running` to `true`, this
  becomes the `<progress id="batch-progress">` (`accent-brand` for a
  brand-colored fill — Tailwind's `accent-*` utility maps the CSS
  `accent-color` property, which modern browsers use to tint native form
  controls including `<progress>`) plus the unchanged "X of Y read, Z
  failed" `role="status"` text, and **stays** that way through running,
  any paused state, and finished, since `running` is never reset back to
  `false` by `STOP` or finishing (the same flag already used for
  `isBatchFinished` elsewhere). This summary/progress block, together with
  every stage's primary button(s) (start/"Read N receipts", "Stop", the
  paused `Alert` + "Resume", or the finished `Alert` +
  "Review in History"/"Read more receipts") and the OpenAI note, now live
  inside one `<div className="sticky bottom-0 -mx-6 -mb-6 ... bg-surface
  border-t">` directly below `BatchQueue`'s row list (negative margins
  escape the surrounding `Card`'s own `p-6` so the bar's border/background
  span the full card width) — pinning the controls to the bottom of the
  viewport while the card is in view, instead of leaving them at the
  bottom of a 20-row list. Internal logic (pause rules, finished
  detection, the `apartmentId` read, etc.) is unchanged from before — only
  the JSX location moved.
  **Start/stop/pause/finish** (unchanged logic, relocated into the sticky
  bar): before `start()`, a primary "Read N receipts" button (disabled
  until an apartment is chosen and N ≥ 1, same "Choose an apartment to
  continue." helper, shown for `file || isBatchActive`) plus the muted
  "Each receipt is sent to OpenAI to read it (N requests)." note; while
  running and not paused, a secondary "Stop" button; while paused
  (`pausedReason`: `'unavailable'`/`'network'` from the engine, or
  `'stopped'` after Stop), an `Alert` (`error` variant for the first two,
  `warning` for `'stopped'`) with
  `EXTRACTION_NOT_CONFIGURED_MESSAGE`/`NETWORK_ERROR_MESSAGE`/a local
  `STOPPED_MESSAGE` ("Stopped. The remaining receipts were not
  processed.") plus a "Resume" button. Once nothing is waiting or in
  flight (`batchWaitingOrInFlight`, derived from item statuses), a success
  `Alert` ("Done: X read, Y failed.", text unchanged, now followed by an
  "Open yearly report" link to `?view=report` via `navigateTo`) offers "Review in History"
  (`navigateTo('?view=history&apartment=<id>&status=needs_review')`,
  reading the component's own `apartmentId` state, which can't drift from
  what `start()` captured since the apartment group is disabled for the
  whole run) and "Read more receipts" (`batch.reset()`, leaving
  `apartmentId` untouched); failed rows stay listed with Retry even once
  finished. A `useEffect` adds a `beforeunload` listener only while some
  item is actually `uploading`/`reading` (`batchInFlight` — stricter than
  `running`, since a stopped batch's in-flight items still finish on their
  own) and removes it the moment nothing is left in flight.
  **Duplicate warnings before uploading (`src/hash/sha256.ts`,
  `src/api/checkDuplicates.ts`, batch item status `"skipped"`):** the
  backend hashes every upload and refuses (`409 DUPLICATE_FILE`) one that
  already matches a saved receipt unless `allow_duplicate=true` is sent;
  the frontend now also hashes client-side so the owner sees a warning
  immediately, without waiting on that 409 — but the server's own check
  is still the only thing that actually prevents a duplicate save, since
  client-side hashing can fail or race another tab/device.
  `sha256Hex(file)` reads the bytes via `FileReader` (not
  `Blob.arrayBuffer()`, unimplemented in this project's jsdom test
  environment, though real browsers support both) and hashes them with
  `crypto.subtle.digest('SHA-256', ...)`; returns `null` — never throws —
  when `crypto.subtle` isn't available (no secure context, an old
  browser) or the bytes can't be read, so a caller always has a safe
  "skip the check" fallback.
  `useBatchUpload` takes an optional `{hasher, checkDuplicates}` (both
  default to `sha256Hex`/the real `checkDuplicates` API call, but are
  injectable so every test supplies a fake instead of mocking `fetch` or
  polyfilling `crypto.subtle`). `BatchItem` gained `hash`/`existing`/
  `allowDuplicate`; `BatchItemStatus` gained `"skipped"`; `BatchErrorKind`
  gained `"duplicate"` (the server already has this file; `existing` is
  its `ReceiptSummary`) and `"duplicate_in_batch"` (another file already
  in this queue has the identical hash — no saved receipt, no
  `existing`). Right after `addFiles` dispatches `ADD_FILES`, it awaits
  one `runDuplicateCheck(toAdd)`: hashes the new items (at most 2 at a
  time, mirroring the upload/extract scheduler's own `CONCURRENCY`),
  flags any whose hash matches an earlier item already in the queue
  (from this `addFiles` call or an earlier one — `knownHashes` is built
  from every item in the current queue with a recorded hash, regardless
  of status) as `"duplicate_in_batch"` with no server call at all, then
  sends every remaining hash in **one** `checkDuplicates(...)` call
  (never one per file) and flags a returned match as `"duplicate"`.
  `BatchState` gained `checkingDuplicates`/`duplicateCheckFailed`: the
  former is `true` only while this whole process is in flight; the
  latter is set only when the `checkDuplicates` request itself rejects
  (never just because hashing came back `null`, and never when there was
  nothing left to send) — cleared again the moment a new check starts.
  Neither hashing failure nor a failed request ever blocks `addFiles`
  itself; the queue always continues exactly as if duplicate-checking
  didn't exist, since the server guards every upload regardless.
  A `409 DUPLICATE_FILE` from the upload call itself (the pre-check
  missed it, was skipped, or raced another save) is caught in
  `processItem` and dispatches `ITEM_SKIPPED` (`errorKind: "duplicate"`,
  `existing` from `err.details.existing`) — never a failure, never
  pauses the queue, exactly like any other already-handled error path
  there. "Upload anyway" (`uploadAnyway(itemId)` → `UPLOAD_ANYWAY`)
  clears a skipped item back to `"waiting"` and sets
  `allowDuplicate: true`, so its next upload attempt sends
  `allow_duplicate=true` (`processItem` now calls `uploadReceipt(item.
  file, apartmentId, item.allowDuplicate)`) — the normal scheduler then
  just picks it back up; the flag survives a later `RETRY`, which already
  spreads the rest of the item unchanged. `REMOVE` now also accepts a
  `"skipped"` item, alongside `"waiting"`/`"failed"`.
  **`BatchQueue.tsx` skipped rows:** a badge, "Already saved" or "Same
  file twice" (a small two-overlapping-squares icon, never color alone),
  next to the same Remove icon button `"waiting"`/`"failed"` rows
  already have (the condition there now includes `"skipped"`). For a
  server match only (`duplicate_in_batch` has no saved receipt to
  describe, so neither of these render for it): a line "Same file as
  `<store>` · `<date DD.MM.YYYY, via formatDisplayDate>` · `<amount via
  formatMoney>` · `<apartment short name>`" (`MissingValue` for any part
  the saved receipt doesn't have — store/date/total/apartment each
  checked independently), a real `<a>` "Open saved receipt"
  (`target="_blank"`, `rel="noopener noreferrer"`) to `/?receipt=<id>`,
  and an "Upload anyway" button (omitted for `duplicate_in_batch`, which
  has nothing to upload "anyway" to — it's just a second copy of a file
  still in this very queue).
  **Counts and strings, adjusted only when something was actually
  skipped (every existing string stays byte-identical otherwise):** the
  pre-start summary line (`batchSummaryText`) gains `", S skipped"` only
  when `S > 0`; the running progress line ("`X` of `Y` read, `Z`
  failed") gains the same suffix, and its `<progress>` value now adds
  the skipped count too (skipped counts as "finished," same as done/
  failed, for both the bar and the "Done" summary); the Start button's
  "Read `N` receipts" counts only non-skipped items
  (`batchNonSkippedCount`), disabled (together with a "`All files are
  already saved.`" line replacing the OpenAI-note line) once that count
  is `0` with at least one item skipped; the finished `Alert` ("Done:
  `X` read, `Y` failed.") gains `" Z skipped."` only when `Z > 0`. Above
  all of this, a `role="status"` "Checking for duplicates..." shows
  while `batch.checkingDuplicates` is true (Start also disabled for it),
  and a muted "Could not check for duplicates before uploading." shows
  only when `batch.duplicateCheckFailed` is true. **Correction:**
  `isBatchFinished` originally only checked "nothing waiting/uploading/
  reading" (`!batchWaitingOrInFlight`) — since a whole queue can now
  become all-`"skipped"` *before* Start is ever clicked, that alone could
  go true pre-start and show the finished `Alert` instead of the normal
  pre-start panel; it now also requires `batch.running`, so an
  all-skipped, never-started queue correctly shows "All files are
  already saved." instead.
  **Single-file flow:** no pre-check request at all here — only the
  upload call's own response matters. A `409 DUPLICATE_FILE` sets a new
  `duplicateInfo` state (a `ReceiptSummary`, cleared at every point
  `error`/`success` already are: `processFile`, `handleBatchFilesSelected`,
  `handleRemoveFile`, `handleReset`, and the start of every submit) and
  renders a warning `Alert` instead of the generic error one: "This file
  is already saved as `<store>`, `<date>`, `<amount>` (`<apartment short
  name>`)." plus "Open saved receipt" and an "Upload anyway" button.
  `handleSubmit`/"Upload anyway" both call one shared `submitUpload
  (allowDuplicate: boolean)` — the only difference between them is that
  flag — so nothing is ever extracted until the upload itself succeeds,
  on either path.
  **Skeleton loading states (`components/ui/Skeleton.tsx`):** every
  loading area (the history list, the saved-receipt view, next to the
  extraction status) is a `role="status" aria-busy="true"` region that
  keeps the exact original loading string in the DOM (visible or
  `sr-only`) next to `animate-pulse`/`motion-reduce:animate-none`
  skeleton blocks — the region (and `aria-busy`) disappears once loading
  ends.
  **Style guide (`StyleGuide.tsx`, `env.ts`, `?view=styleguide`):**
  dev-only page showing every `Button`/`Alert` variant, the nav tab's
  active/inactive states, the logo mark (the receipt-shaped `AppMark`,
  kept in sync with `App.tsx`'s own copy), a "Page header" section with
  two static `PageHeader` samples (one with just a description, one with
  an `actions` button, demonstrating the one-`<h1>`-per-view component),
  a "Numbered section headings" section showing the `SectionHeading`
  number-badge pattern standalone (including the "Required" tag on
  section 1, plus the "Receipts for `<short name>`" variant), an "Upload
  side panel" section rendering the real `UploadSidePanelSkeleton`/
  `HelpPanel`/`ReceiptsOverview` (sample data with a long store name,
  missing values and an unrecognized date), an "Upload form
  status line" section toggling between the three mutually exclusive
  helper texts (neither chosen / file-only / apartment-only) above a
  disabled "Read receipt" sample, the dropzone's
  idle/drag-over/file-selected states (idle `bg-brand-soft`, drag-over
  `bg-brand-subtle` + `border-brand`, a visible "Browse files" button
  inside it), a `Skeleton` sample, the
  card-variant items list, the warnings panel/Edited badge/reset
  confirmation, a `BatchQueue` sample (compact rows, one per status
  including "Already saved"/"Same file twice", plus
  rejected files — reflecting the same component the real batch flow
  uses), a "Batch duplicate-check states" section ("Checking for
  duplicates...", a failed-check sample, and "All files are already
  saved." with its disabled button), a single-file duplicate `Alert`
  sample, the batch paused (unavailable/network/stopped)/finished
  states, a dedicated "Batch summary line and sticky action bar" section
  (toggles between the before-start summary text and the after-start
  progress/button state, over a short scrollable sample list, for a quick
  visual check of the sticky-positioning markup), a "Reading tips
  (collapsible, under the dropzone)" section showing the
  `<details>`/`<summary>` tips element on its own, and the Items view's
  loading/table (normal, unrecognized-date,
  missing-values, long-title and long-store rows)/matching cards/both
  empty states/error/"Show more" states (plus a standalone "Sort by"
  select sample, not wired to any of the above — a static visual check of
  the control itself, same spirit as the other isolated samples on this
  page), with static sample data (no network
  calls) — open it after any visual change, since jsdom cannot see
  colors or layout. Gated on `env.ts`'s `isDev` (`import.meta.env.DEV`,
  isolated into its own module specifically so tests can
  `jest.doMock('./env', ...)` to flip it — `import.meta.env.DEV` itself is
  a compile-time constant, not something a single test run can toggle).
  Not linked from the header. `App.tsx`'s dynamic `import('./StyleGuide')`
  must use the literal `import.meta.env.DEV` (not `isDev`) specifically so
  Vite's dead-code elimination can drop it from a production build —
  confirmed by grepping `dist/assets/*.js` for "StyleGuide" after a build,
  not assumed.
