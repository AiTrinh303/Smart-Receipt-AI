# CLAUDE.md

Reference context for Claude Code working in this repository.

## Project overview

Smart Receipt AI is a web app that helps users organize shopping receipts and
understand their spending without manual data entry. Manually entering
receipt details (store, date, items, prices, tax, total) is time-consuming
and error-prone. MVP: a user uploads one receipt (image or PDF), AI extracts
the purchase info, and the result is displayed for review.

## Tech stack

- Frontend: Vite + React + TypeScript + Tailwind CSS
- Backend: FastAPI (Python)
- Testing: Jest + React Testing Library (frontend)

## Project structure

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
  `getReceipt.ts`, `listReceipts.ts` (accepts `{limit?, apartmentId?,
  year?, status?}`, building the query string itself),
  `getApartments.ts`,
  `updateReceiptApartment.ts`,
  `updateReceiptStatus.ts`, `getReceiptFacets.ts` (`GET /receipts/facets`,
  optional `apartmentId`), `listItems.ts` (`GET /items`, accepts
  `{apartmentId?, year?, status?, q?, limit?, offset?}`, same
  query-string-building pattern as `listReceipts.ts`), shared `ApiError`
  (carries an optional `missing:
  string[]`, set only for a `422` from `updateReceiptStatus` whose body is
  `{detail: {message, missing}}` — every other error, including a
  malformed body, falls back to a plain message with no `missing`), shared
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
  two under-the-button cases, never the apartment-only one.
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
  `uploadReceipt(file, apartmentId)` sends `apartment_id` as a second
  `FormData` field.
  **Upload page layout (`SectionHeading`, `HelpPanel`, `TipsDetails`, all
  local to `ReceiptUpload.tsx`):** the form `Card` is split into two
  `SectionHeading`s — a small circular number badge (`aria-hidden="true"`)
  next to an `<h2>` reading just the word ("Apartment", "Receipts"; the
  number is never part of the heading's accessible name) — section 1
  holds the `RadioCardGroup` (and its helper text), section 2 holds the
  file input/dropzone/camera button/tips-or-nothing/batch-or-single-file
  content, exactly as before, just re-nested; every string inside stayed
  the same. `App.tsx`'s `mainSize` gives Upload the wider `xl` `Container`
  (previously `lg`, now matching Items/receipt-detail — only History
  stays at `lg`), and the page wraps its content in `grid gap-6
  lg:grid-cols-12 lg:items-start` with the form `lg:col-span-7` and a
  help-panel column `lg:col-span-5` — plain CSS, collapsing to one
  stacked column below `lg`. Whether that second column actually renders
  `HelpPanel` is decided in JS, not CSS: `isWideScreen =
  useMediaQuery('(min-width: 1024px)')` — `true` renders the static,
  no-fetch `HelpPanel` ("How it works": choose the apartment / add photos
  or PDFs / review and approve, each with its own number badge, plus the
  same tips list already expanded) and skips `TipsDetails` entirely;
  `false` (including whenever `matchMedia` doesn't exist, jsdom's
  default) renders `TipsDetails` and skips `HelpPanel` — **never both**,
  since both show the identical tips text and a CSS-only
  show/hide-one-of-two approach would leave that text in the DOM twice at
  once. `HelpPanel` uses the plain `Card` elevation (`shadow-card`, no
  override — it originally added `shadow-popover` on top, which read as
  a floating popup rather than a panel beside the form) and, from `lg`
  up, `lg:sticky lg:top-20 lg:self-start` (80px clears the shell's `h-16`
  header with 16px to spare), so it stays in view while the (usually
  taller) form scrolls. The dropzone (both the full and the compact "Add
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
  variant's instructional text is now "Drag a receipt here, or" followed
  by a real secondary `Button` reading "Browse files" (`onClick` calls
  `e.stopPropagation()` before `openFilePicker()`, since the button sits
  nested inside the dropzone's own `role="button"` `<div>` which already
  opens the picker on any click — without stopping propagation the click
  bubbles up and double-fires it) then the size/type line — replacing the
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
  **Navigation (`App.tsx`, `src/navigation.ts`):** no router library — a
  tiny `navigateTo(search)` helper does `history.pushState` and dispatches a
  synthetic `popstate` event (since `pushState`/`replaceState` never fire
  one themselves); `App.tsx` listens for `popstate` (real browser
  back/forward and the synthetic ones) to decide, from the URL, which of
  `ReceiptHistory.tsx` (`?view=history`), `ReceiptItems.tsx`
  (`?view=items`), or `ReceiptUpload.tsx` (otherwise —
  including `?receipt=<id>`) to render, keying each on the current
  `location.search` so external navigation remounts cleanly without
  disturbing `ReceiptUpload`'s own internal `replaceState` calls. The
  header nav has three links (Upload/History/Items); `getActiveNav()`/
  `getPageName()` (-> `document.title`, e.g. "Items · Smart Receipt AI")
  both switch on the same three-way `View` type, same `aria-current`
  treatment for all three.
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
  `ReceiptHistory.tsx` lists saved receipts as compact rows
  (`HistoryRow`, exported) — one ~56px row from `sm` up (store via
  `ClampedText`, 1 line/full text in `title`; the date via `DateCell`,
  imported from `ReceiptItems.tsx` rather than duplicated — `DD.MM.YYYY`
  for a valid ISO date, the raw text + the same warning icon/`title`/
  hidden "Date not recognized" for anything else, `MissingValue` when
  missing; the total right-aligned via `formatMoney`; then the badges),
  two lines below `sm` (store+total; date+badges) — only one layout
  ever mounted, via `useMediaQuery('(max-width: 639px)')`, same pattern
  as `ReceiptResult.tsx`/`ReceiptItems.tsx`. Each row's `apartment_name`
  is a small icon+text badge showing `apartmentShortName(name)` (`aria-
  hidden`, decorative) with the full name as both its `title` and a
  hidden (`sr-only`) span, or plain muted "Not assigned" when it's
  `null`/missing — shown only in "All apartments" (hidden inside a
  specific apartment tab — redundant there). `status` is a `StatusBadge`
  (icon+text, shared with `ReceiptReviewStatus.tsx`/`ReviewBar.tsx`),
  shown only when the Status filter is "All" — redundant otherwise, same
  reasoning as the apartment badge. Each row is a real `<a href="/?
  receipt=<id>{&from=...}">` (not a `<button>`, so opening one in a new
  tab works) with the exact same `from` mechanism/target as before;
  `ReceiptUpload.tsx` adds a "Back to history" link when showing a
  result.
  **Splitting the history by apartment, with filters:** all state lives in
  the URL (`?view=history&apartment=<id>&year=<v>&status=<v>`), never
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
  "N receipts" is a `role="status"`, unchanged (no "Show more"/paging
  exists yet for this list — `GET /receipts` has neither `offset` nor
  `total`, see the backend `routes.py` entry above); "Clear
  filters" shows only when a year/status select (not just an
  apartment tab) is active, and resets both, leaving the
  apartment tab alone, per spec. The plain "No receipts yet..." empty
  state is reserved for truly no filters at all (`isUnfiltered`); any
  other empty result shows "No receipts match these filters." instead,
  relying on the one "Clear filters" button above rather than a second
  copy. Opening a receipt attaches `&from=<encoded search>` to
  `?receipt=<id>` **only** when a tab/filter is actually active (so the
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
  identical apartment-tab UI — its tabs are built as plain
  `{id, label: a.name}`, deliberately with **no count suffix**, since
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
  `md:w-48`); `ReceiptHistory` never passes `extraFilter`, so its own
  layout (`sm:flex-row`, `flex-1` selects) is completely unchanged —
  confirmed by every `ReceiptHistory` test passing unchanged after this
  was added. Changing the sort, like every other filter/search change
  here, fully remounts the page via `navigateTo()`, so paging resets to
  `offset=0` for free — no separate "reset paging" state exists.
  "Clear filters" leaves the chosen sort untouched (sort is an ordering
  preference, not a filter: it's excluded from `anyFilterActive` and the
  filter-summary text), and the existing `requestIdRef` stale-response
  guard and `limit`/`offset` "Show more" pagination are unchanged, with
  `sort` simply threaded through to both `listItems()` call sites.
  **Table (`sm` and up) vs. a card list below it**, via `useMediaQuery`,
  same pattern as `ReceiptResult.tsx` — never both mounted. The table is
  `table-fixed` with an explicit width on every column except Item
  (`w-24` Date, `w-16` Qty, `w-24` Unit price, `w-24` Line total, `w-40`
  Store, `w-28` Apartment, `w-28` Status — Item absorbs whatever's left),
  so Date and the numeric columns stay `whitespace-nowrap` and never
  wrap; rows are `py-2` with a light `border-border/40` divider and
  `hover:bg-slate-50`, no zebra striping. Columns: Date, Item, Qty, Unit
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
  in `ClampedText` (1 line); the item name (via `ItemNameLink`, still not
  exported) wraps in `ClampedText` (2 lines) when non-null, else renders
  `MissingValue` as the link's own content — the link itself is
  **dark `text-ink` with an always-visible underline**, turning
  `hover:text-brand`/`focus-visible:text-brand` only on
  hover/focus (changed from the original brand-colored-always-underlined
  style, which read as noisy at table scale). `StatusCell` renders the
  existing `StatusBadge` for a recognized status, else `MissingValue`.
  Amounts use `formatMoney` **with** `includeCurrency` (its default)
  rather than `false`, since — unlike `ReceiptResult.tsx`'s
  one-currency-per-receipt table — rows here can carry different
  currencies, so each amount must say which one (e.g. "EUR 4.99"). The
  item link attaches the same `&from=`
  mechanism as History's rows (`e.preventDefault()` + `navigateTo`).
  **Cards** (below `sm`) show the same name link (2 lines), a muted
  "`DateCell` · store" line, an amount line that keeps "Qty"/"Unit
  price"/"Line total" as plain text next to each value, and a badge row
  (`ApartmentCell` in "All apartments", `StatusCell` always).
  **A summary bar above the table**: the existing "`count` of `total`
  items" `role="status"` stays on the left; on the right, `filterSummaryText`
  joins whichever of apartment short name / year (or "No valid date") /
  the `STATUS_OPTIONS` label / `"query"` are actually active with ` · `
  (e.g. `Waldglück · 2026 · Approved · "milch"`, omitting any inactive
  part), next to the existing "Clear filters" button (shown under the
  same `anyFilterActive` rule as before — the apartment tab alone never
  shows it).
  Pagination is "Show more", not infinite
  scroll: `GET /items` is called with `limit`/`offset`, and the button
  (shown below the table while
  `count < total`, disabled/`loading` while a page is in flight) requests
  `offset: count` and **appends** the response's rows via
  `setItems((prev) => [...(prev ?? []), ...response.items])` — never
  replacing what's already shown. A failed "Show more" leaves the
  existing rows alone and shows its own `Alert variant="error"` + "Retry"
  (`loadMoreError`, separate state from the main `error`). **Race
  safety:** a single `requestIdRef`, shared by the main load effect and
  `handleShowMore`, is incremented at the start of every fetch; each
  `setState` call after an `await` first checks
  `requestIdRef.current !== requestId` and bails if so, so a reply to a
  request that's no longer the latest one issued can never overwrite
  state a newer request already set — layered on top of the same
  per-mount `cancelled`-closure pattern `ReceiptHistory` already uses
  (a filter/search change is a full remount, whose cleanup already
  discards a stale in-flight response), with the request id specifically
  covering "Show more", the one fetch not driven by that per-mount
  effect. Loading/error/empty states otherwise mirror `ReceiptHistory`'s
  shape exactly (`role="status" aria-busy="true"` + "Loading items...",
  `Alert variant="error"` + Retry, "No items yet. Upload a receipt." vs.
  "No items match these filters." + "Clear filters").
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
  `ReceiptHistory.tsx` and `ReceiptResult.tsx` still show `purchase_date`
  via the older, plain `displayText()` (raw string or "Not detected") —
  deliberately untouched by this rule's introduction; only new/redesigned
  display code is expected to adopt `formatDisplayDate()`.
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
  **Changing the apartment on a saved receipt (`ReceiptApartment.tsx`,
  `src/api/updateReceiptApartment.ts`):** rendered by the saved-receipt
  container (the same `if (result)` branch used right after extraction and
  when reopening `?receipt=<uuid>`) directly above `ReceiptResult` —
  `ReceiptResult.tsx` itself is never touched. The same `RadioCardGroup`,
  legend "Apartment" — unchanged — with the receipt's `apartment_id`
  selected (or nothing selected, with no extra message, when it's `null`);
  options now show `apartmentShortName(name) ?? name` (bold) and
  `apartmentPlace(name)` (muted second line, only for a three-segment
  name) exactly like the upload form's own apartment choice, via the same
  `secondaryLabel`/`accessibleName` props on `RadioCardGroup` — the
  accessible name and `title` tooltip stay the full name regardless. It
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
  `listReceipts({apartmentId, year, status, limit: 200})` using that same
  `from` value's own filters, parsed with the exact `effectiveYear`/
  `effectiveStatus` helpers `ReceiptFilters.tsx` already validates its own
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
  when `status === 'needs_review'`, a second primary "Approve and next"
  button next to "Mark as approved". **Staying mounted across moves:**
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
  ("Check these values", icon + bulleted messages) above the data card;
  empty `warnings` renders nothing, and warnings never block any action.
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
  `formatDisplayDate()` — a valid ISO date renders unchanged (this never
  reformats a *valid* date, only marks an *invalid* one); an unrecognized
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
  else changes. The Total row's exact text is untouched.
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
  else defaults to image. Renders as a framed card: a header row with the
  (truncated, `title`-attributed) file name, icon zoom/fit controls for
  images (`aria-label`s "Zoom out"/"Zoom in"/"Fit", 50%–300%), an
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
  `ReceiptDetailLayout` wraps the saved-receipt view (`ReceiptResult`) and
  the edit view (`ReceiptEditForm`) in a shared two-column layout
  (`lg:grid-cols-[5fr_6fr]`, file left/data right, file panel `sticky`
  with its own scroll area near viewport height) from the `lg` breakpoint
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
  **"Upload another receipt" placement:** a `ghost` `Button` next to the
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
  `src/batch/useBatchUpload.ts`) — logic only, no UI yet:**
  `batchReducer` is a pure `(state, action) => state` reducer (no API
  calls, no side effects) with two exported constants, `MAX_BATCH = 20`
  and `CONCURRENCY = 2`. A `BatchItem` has a local `id`, the `File`, a
  `status` (`"waiting" | "uploading" | "reading" | "done" | "failed"`),
  and optional `receiptId`/`error`/`errorKind`
  (`"upload" | "unreadable" | "unavailable" | "network"`)/
  `warningsCount`. `BatchState` holds `items`, `rejected`
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
  "Drag a receipt here, or choose a file" + the JPG/PNG/PDF subtitle) only
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
  badge, and a **failed** row's error text (same shared messages as the
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
  `Alert` ("Done: X read, Y failed.") offers "Review in History"
  (`navigateTo('?view=history&apartment=<id>&status=needs_review')`,
  reading the component's own `apartmentId` state, which can't drift from
  what `start()` captured since the apartment group is disabled for the
  whole run) and "Read more receipts" (`batch.reset()`, leaving
  `apartmentId` untouched); failed rows stay listed with Retry even once
  finished. A `useEffect` adds a `beforeunload` listener only while some
  item is actually `uploading`/`reading` (`batchInFlight` — stricter than
  `running`, since a stopped batch's in-flight items still finish on their
  own) and removes it the moment nothing is left in flight.
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
  section 1), an "Upload help panel" section showing
  the static `HelpPanel` content (three "How it works" steps plus the
  expanded tips) exactly as it renders at `lg` and up, an "Upload form
  status line" section toggling between the three mutually exclusive
  helper texts (neither chosen / file-only / apartment-only) above a
  disabled "Read receipt" sample, the dropzone's
  idle/drag-over/file-selected states (idle `bg-brand-soft`, drag-over
  `bg-brand-subtle` + `border-brand`, a visible "Browse files" button
  inside it), a `Skeleton` sample, the
  card-variant items list, the warnings panel/Edited badge/reset
  confirmation, a `BatchQueue` sample (compact rows, one per status, plus
  rejected files — reflecting the same component the real batch flow
  uses), the batch paused (unavailable/network/stopped)/finished
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
- `backend/` — FastAPI app with a Python venv and
  `requirements.txt`/`requirements-dev.txt`, layered per
  [docs/adr/0001-layered-backend.md](docs/adr/0001-layered-backend.md):
  - `domain/` — `models.py` (`ReceiptData` and friends, plus `SavedUpload`,
    `SavedReceipt` — adds `edited: bool` / `edited_at: str | None` to
    `ReceiptData` (`edited` is just `edited_at is not None`, computed in the
    repository, not stored as its own column) — and `ReceiptSummary` — the
    last a small list-row model: receipt_id, original_filename, store_name,
    purchase_date, currency, total, created_at — for persisted data (no
    `edited`/`warnings` here; the list endpoint is intentionally unchanged);
    `ReceiptWarning` — code/field/
    message/`details` (decimal strings, never floats), computed fresh on
    every response and never stored); `Apartment` (id/name/sort_order/
    active) and `DEFAULT_APARTMENTS` — the two seeded holiday apartments
    (exact ids `oberaudorf-bergblick`/`sankt-englmar-waldglueck`, exact
    names including "Waldglück"), seeded via `INSERT OR IGNORE` on every
    repository construction so it's idempotent and safe to re-run.
    `SavedUpload`, `SavedReceipt` and `ReceiptSummary` all carry flat
    `apartment_id`/`apartment_name` (`str | None`) — same key set and JSON
    types across upload/extract/GET/PUT/reset/list-item, see
    [docs/adr/0002-apartments-and-expense-ledger.md](docs/adr/0002-apartments-and-expense-ledger.md).
    `ReceiptStatus`
    — plain string constants `NEEDS_REVIEW`/`APPROVED` (not an Enum, so
    they serialize as plain strings) and `ALLOWED_RECEIPT_STATUSES`.
    `SavedReceipt` and `ReceiptSummary` additionally carry flat
    `status` (`str`,
    `"needs_review"` or `"approved"`) — same key and JSON type across
    extract/GET/PUT/reset/apartment-PUT/list-item, see
    [docs/adr/0003-category-and-review-status.md](docs/adr/0003-category-and-review-status.md)
    (an expense-category classification also lived here —
    `Category`/`DEFAULT_CATEGORIES`, `category_id`/`category_name` on
    `SavedReceipt`/`ReceiptSummary`/`LineItemRow` — until it was removed;
    see
    [docs/adr/0004-remove-categories.md](docs/adr/0004-remove-categories.md)
    for why, and how any old category data left in a database is kept
    dormant, never migrated).
    `LineItemRow` — one flattened `GET /items` row (`receipt_id`,
    `line_index`, `name`, `quantity`, `unit_price`, `line_total`,
    `currency`, `purchase_date`, `store_name`, `apartment_id`,
    `apartment_name`, `status`); never stored, built
    fresh per request by `rules.flatten_line_items()`.
    `rules.py` (allowed file
    types, size limit, `media_type_for_extension()` — a pure
    extension -> fixed media type map used by the file-serving endpoint, so
    `Content-Type` is never taken from client input — plus two more pure
    functions: `normalize_purchase_date(raw)` extracts a leading ISO date
    (`"2025-06-26 11"`/`"2025-06-26T11:04:00"` -> `"2025-06-26"`, via
    `_LEADING_ISO_DATE_PATTERN`) **or** a leading dotted German date,
    `D.M.YYYY`/`DD.MM.YYYY` (`"2.6.2026"`/`"02.06.2026"`/
    `"02.06.2026 11:04"` -> `"2026-06-02"`, via
    `_LEADING_DOTTED_DATE_PATTERN` — 1-2 digit day/month, exactly 4-digit
    year, dots only, optionally one trailing space/comma + arbitrary
    extra text) **or** a leading month-name date, `D[.]? Month YYYY`
    (`"02 Juni 2026"`/`"2. Dezember 2025"`/`"15 Mär 2026"`/
    `"1 March 2026"` -> `"2026-06-02"`/`"2025-12-02"`/`"2026-03-15"`/
    `"2026-03-01"`, via `_LEADING_MONTH_NAME_DATE_PATTERN` — 1-2 digit
    day, optional dot right after the day, one or more spaces, a German or
    English month name (full or abbreviated, case-insensitive via
    `.casefold()`, optional trailing dot on an abbreviation), exactly
    4-digit year, optionally one trailing space/comma + arbitrary extra
    text, same convention as the other two shapes). The month word is
    resolved against `MONTH_NAMES_BY_WORD`, a module-level constant
    mapping every accepted German and English spelling (full and
    abbreviated) to its month number — an unrecognized word simply fails
    that lookup, returning `None`, and
    returns `None` for anything else (never guesses day/month order for
    `"26/06/2025"`, and deliberately never recognizes slash dates or
    2-digit years — both still explicitly out of scope). Every
    shape is validated against a real calendar by constructing a
    `date(year, month, day)` and catching the `ValueError` it raises for
    an out-of-range day/month (e.g. `"31.04.2026"`, a non-leap-year
    `"29.02.2025"`, or `"31 Februar 2026"`) — never a hand-rolled day-count
    table, and never
    raises itself. Since every call site that normalizes a date for
    display/filtering/sorting (`get_receipt`, the year filter,
    `has_undated`, `flatten_line_items`, `sort_line_items`, and — indirectly, since it's
    always handed an already-normalized value — `check_receipt`'s
    `DATE_NOT_STANDARD` check, and the status-PUT approval gate's
    `_missing_approval_fields`) funnels through this one function, teaching
    it the dotted format, and later the month-name format, was each time
    the *only* code change needed to make a
    legacy row whose stored text is that format behave as fully dated
    everywhere, with its stored row never rewritten; `check_receipt(data, today)` — `today`
    is an injected parameter so callers/tests are deterministic — returns
    `MISSING_STORE`/`MISSING_DATE`/`DATE_NOT_STANDARD`/`FUTURE_DATE`
    (1-day grace)/`MISSING_TOTAL`/`TOTAL_MISMATCH` (skipped unless every
    item has a usable amount; tolerant of either tax-added-on-top or
    tax-already-included, tolerance `0.05`)/`LINE_MISMATCH` (per
    `Decimal(str(value))` math, never raw floats — raised only when the
    line total matches *neither* the plain `quantity x unit_price` check
    within `TOTAL_TOLERANCE` (`0.05`) *nor* `quantity x unit_price x (1 +
    rate)` within `VAT_LINE_TOTAL_TOLERANCE` (`0.02`) for a `rate` in
    `GERMAN_VAT_RATES = (0.07, 0.19)` — the latter covers a German receipt
    that prints an item's unit price net of VAT next to a line total
    gross of VAT, e.g. a 2.23 net unit price next to a 2.39 gross line
    total at 19% VAT; a real mismatch, explained by neither check, still
    warns); raises domain
    exceptions, no HTTP/FastAPI/file I/O; `flatten_line_items(saved_receipt)`
    — pure, no I/O — turns one `SavedReceipt`'s `items` into `LineItemRow`s
    in their original order (`line_index` 0, 1, 2, ...), normalizing
    `purchase_date` for display with the same `normalize_purchase_date`
    call `get_receipt()` uses (never duplicated, never computes or converts
    money, nulls stay null); `matches_query(row, q)` — pure — splits `q`
    (assumed already trimmed) on whitespace and requires every word to
    appear, via `str.casefold()` (not `.lower()`), in the row's item name
    or store name; a null item name can still match through the store
    name; an empty `q` matches every row, though `api/routes.py` simply
    skips calling this at all for a blank query); `sort_line_items(rows,
    sort)` — pure, no I/O — `DEFAULT_ITEM_SORT = "date_desc"`,
    `ALLOWED_ITEM_SORT_VALUES = ("date_desc", "date_asc", "amount_desc",
    "amount_asc", "store")`. Expects `rows` already in the tie-break
    order (receipt `created_at` DESC, `receipt_id` ASC, `line_index`
    ASC — the order `list_matching_receipts`/`flatten_line_items`
    naturally produce) and relies on Python's sort being **stable**:
    sorting by just the primary criterion reproduces that full tie-break
    order for free among rows sharing the same primary key, with no need
    to re-state it as a compound key. `"store"` sorts by
    `store_name.casefold()`, a `None` name always last. `"amount_desc"`/
    `"amount_asc"` sort by `line_total` as `Decimal(str(value))` — never
    a raw float — a `None` `line_total` always last in both directions
    (mixed currencies are compared by number only — a deliberate
    simplification, no conversion). `"date_desc"`/`"date_asc"` (default)
    sort by `normalize_purchase_date(row.purchase_date)` — safe to call
    again even though `flatten_line_items` already normalized the row's
    `purchase_date` for display, since re-normalizing an already-ISO date
    is a no-op and re-normalizing an already-unparseable raw string still
    correctly returns `None` — a row with no valid date always sorts
    last, in both directions (every "last" case is implemented by
    partitioning into two lists — e.g. `with_amount`/`without_amount` —
    sorting only the first stably, then concatenating, rather than
    encoding "missing" into the sort key itself, which would risk
    putting it first when `reverse=True`).
    `ports.py` (`ReceiptExtractor` Protocol + `ExtractionError` /
    `ExtractionUnavailableError`, `ReceiptRepository` Protocol —
    `save_upload`/`get_upload`/`save_receipt`/`get_receipt`/
    `list_receipts`/`update_receipt`/`reset_receipt`/`delete_receipt`/
    `list_apartments`/`get_apartment`/`set_receipt_apartment`/
    `set_receipt_status`/`get_receipt_facets`/`list_matching_receipts`,
    plus the
    strict, separate `ReceiptUpdate`/`LineItemUpdate`/`DiscountUpdate`/
    `TaxUpdate` models in `models.py` for user-submitted corrections, and
    `ApartmentAssignment` (`apartment_id: str`, `extra="forbid"`) for
    `PUT /receipts/{id}/apartment`'s body, and `StatusAssignment`
    (`status: str`, `extra="forbid"`, a `field_validator` rejecting
    anything outside `ALLOWED_RECEIPT_STATUSES`) for
    `PUT /receipts/{id}/status`'s body — each its own model, deliberately
    separate from `ReceiptUpdate`, so a classification change can never be
    confused with (or smuggled into) a data correction — deliberately
    distinct from the lenient `ReceiptData` family used to parse AI output,
    which must stay lenient). `ExtractionError` means the receipt itself couldn't
    be read (unparseable output, timeout, bad request);
    `ExtractionUnavailableError` means the AI *service* isn't usable (bad
    key, no credit, unknown model, rate limit) — they map to `502` and
    `503` respectively in `api/routes.py`, so a misconfigured key doesn't
    look like an unreadable receipt. Must never import `adapters`, `api`,
    `fastapi`, `openai`, `sqlite3`, or `config.py`.
  - `adapters/` — `openai_extractor.py` (`OpenAIReceiptExtractor`, the
    OpenAI API call — maps `AuthenticationError`/`PermissionDeniedError`/
    `NotFoundError`/`RateLimitError` to `ExtractionUnavailableError`,
    everything else to `ExtractionError`, always via `raise ... from exc`
    so the real cause is still logged; `EXTRACTION_INSTRUCTIONS` includes
    one rule for `purchase_date` — return `YYYY-MM-DD`, converting German
    month names and dotted dates (day first), null if unsure — matching
    `domain.rules.normalize_purchase_date`'s own accepted shapes, so the AI
    is nudged toward a format this app can already parse even before
    `normalize_purchase_date` runs server-side as a fallback), `file_storage.py` (saving/finding
    files in `uploads/` by UUID filename; `delete_file` looks up the file
    the same way `find_file` does — by the validated UUID, inside
    `UPLOAD_DIR` only, never a client-supplied path — and treats an
    already-missing file as a no-op, not an error, so a retry is safe),
    `sqlite_repository.py`
    (**concurrency:** every method opens its own short-lived connection via
    `_connect()` and closes it immediately — never one shared/reused
    connection — so `sqlite3`'s default `check_same_thread=True` is never
    at risk; combined with `sqlite3.connect()`'s default 5s busy timeout,
    this has been verified safe for light concurrency (a handful of
    parallel upload+extract requests) by `tests/test_concurrency.py`,
    without needing WAL mode or any other change.
    `SqliteReceiptRepository`: stdlib `sqlite3`, no ORM; `uploads`,
    `receipts` and `apartments` tables; schema created via
    `CREATE TABLE IF NOT EXISTS`, plus a small additive migration on
    construction — `PRAGMA table_info` then
    `ALTER TABLE ... ADD COLUMN` only for a column that's missing, never
    dropping/recreating a table, so existing rows always survive an
    upgrade; this is how `edited_at`, the nullable `apartment_id` columns
    on `uploads`/`receipts`, and the
    `status TEXT NOT NULL DEFAULT 'needs_review'` column on `receipts`
    were all added — the `NOT NULL DEFAULT` applies to existing rows too,
    so every receipt that predates the column still gets `needs_review`.
    `apartments` is a new table (no migration
    needed there) seeded with `DEFAULT_APARTMENTS`
    via `INSERT OR IGNORE` every time, so it's idempotent). (A `categories`
    table and a `category_id` column/migration on `receipts` existed here
    too, until the expense-category feature was removed — see
    [docs/adr/0004-remove-categories.md](docs/adr/0004-remove-categories.md).
    A database that already has them keeps them, untouched and unread; a
    new database never gets them.)
    `list_apartments` returns only `active = 1` rows
    ordered by `sort_order`; `get_apartment` returns a row
    regardless of `active` (the route distinguishes "unknown" from
    "inactive" itself, and a receipt's `apartment_name`
    must still resolve even if deactivated later).
    `save_receipt`'s `INSERT`/`ON CONFLICT` deliberately omits
    `apartment_id` from the `ON CONFLICT` `SET` clause: a first save inserts
    it, a re-extract leaves whatever is already there untouched; it also
    always resets `status` to
    `'needs_review'` on every save, first or re-extract alike, since the
    underlying data was just replaced.
    `set_receipt_status` mirrors
    `set_receipt_apartment`: one transaction, updates only
    `status` plus `updated_at`, returns `None` if no `receipts` row exists
    (so the route 404s), never touches `edited_at`, `extracted_json`,
    `ai_result_json`, `created_at`, or `apartment_id`.
    `list_receipts` orders by `created_at DESC, receipt_id ASC` (stable
    tie-break) and builds each row from `extracted_json` (same source as
    `get_receipt`, so `total`'s JSON type matches); a row with unparseable
    `extracted_json` is logged (receipt_id only) and skipped rather than
    failing the whole list.
    **Filtering (`apartment_id`/`year`/`undated`/`status` params):**
    `apartment_id` and `status`
    (plain column equality) are filtered in a parameterized SQL `WHERE`
    clause built from a list of clauses/params — never string-formatted
    user input. `year`/`undated` can't be done that way without duplicating
    date-validity logic in SQL, so they're filtered in Python instead, by
    calling `domain.rules.normalize_purchase_date` on each matching row's
    `extracted_json`-sourced `purchase_date` (the same shared rule
    `check_receipt`/`save_receipt`/`get_receipt` all use) — a year matches
    only when normalization succeeds and the result starts with that year
    (so a raw `"26/06/2025"` never matches `year=2025`, only `undated`).
    Because the date filter runs after the SQL query, the SQL side has NO
    `LIMIT` when any filter is given; `limit` is applied in Python as rows
    are accepted, after the corrupted-JSON skip and the date filter, so a
    filtered call never over- or under-counts.
    The SQL `WHERE`-building and the row-filtering/parsing loop above both
    live in a private `_filtered_receipt_rows(conn, ...)` shared by
    `list_receipts` and `list_matching_receipts` — the latter is
    `GET /items`'s source: same filters, same order, no `limit`, but each
    row rebuilt into a full `SavedReceipt` (not a `ReceiptSummary`) so
    `domain.rules.flatten_line_items` has every item to flatten. Unlike
    `list_receipts`'s summaries, `list_matching_receipts`'s
    `SavedReceipt.purchase_date` is left raw/unnormalized — normalizing it
    for display is `flatten_line_items`'s job, not the adapter's, so that
    responsibility stays in one place (`domain/rules.py`) rather than
    being duplicated across two adapter methods. `get_receipt_facets`
    (`ApartmentFacet`/`ReceiptFacets` in `models.py`) computes `apartments`
    (one row per apartment via `LEFT JOIN` + `COUNT`, always *every*
    receipt for that apartment, ignoring `apartment_id`) and `total`
    (`COUNT(*)` over all receipts) in one query each; `years`/`has_undated`
    are computed the same way as the date filter above (via
    `normalize_purchase_date` over each row's `extracted_json`), scoped to
    `apartment_id` via a parameterized `WHERE` when one is given.
    `update_receipt` replaces `extracted_json` and
    the four denormalized columns, sets `edited_at` to now, in one
    transaction, refreshes `updated_at`, and **never touches
    `ai_result_json` or `created_at`** — the original AI output stays
    byte-for-byte intact; returns `None` (never creates a row) if the
    receipt doesn't exist. `reset_receipt` is the reverse: parses
    `ai_result_json` with the same lenient `ReceiptData` model used for AI
    output, re-applies the same date normalization extraction does, writes
    that into `extracted_json` and the four denormalized columns, clears
    `edited_at` to `NULL`, refreshes `updated_at`, keeps `created_at` — one
    transaction, `ai_result_json` itself never touched; returns `None` if
    the receipt doesn't exist (so the route 404s), and is safe to call
    repeatedly (idempotent) or on a receipt that was never edited.
    `set_receipt_apartment` updates only `apartment_id` and `updated_at` on
    the `receipts` row (plus `apartment_id` on the matching `uploads` row,
    when one exists) in one transaction — never `edited_at`,
    `extracted_json`, `ai_result_json` or `created_at`, since this is a
    classification change, not an edit; returns `None` if the receipt
    doesn't exist (so the route 404s), else re-fetches via `get_receipt`.
    `delete_receipt` removes the row from both
    `receipts` and `uploads` in one transaction, returning whether a
    `receipts` row existed. Must never import `api`.
    **Date normalization:** `save_receipt` captures `ai_result_json` from
    the data exactly as the AI returned it *before* normalizing — so a raw,
    unparseable date is preserved there forever — then normalizes
    `purchase_date` in place (via `domain.rules.normalize_purchase_date`)
    for both the caller's `data` object and `extracted_json`/the
    `purchase_date` column; an unparseable date is kept as-is (not
    discarded) so the user can see and correct it. `get_receipt`
    additionally normalizes `purchase_date` for display only (never
    rewriting the stored row) so a pre-normalization row shows the clean
    date too, without a migration. `update_receipt` needs no normalization
    on write, since `ReceiptUpdate.purchase_date`'s own validator already
    requires `null` or a valid ISO date.
    **Money rule:** `total` is never stored as a float — the adapter
    converts with `Decimal(str(value))` to an exact decimal string (e.g.
    `19.99`, not a binary-float expansion) in a dedicated column kept for
    future search/summary use; the live API always reads `total` back from
    `extracted_json` (the full `ReceiptData`, parsed with its original
    float), never from that decimal-string column, so no rounding error
    ever reaches a response.
  - `api/` — `app.py` (creates the FastAPI app, CORS middleware — origins
    from `CORS_ORIGINS`, methods `GET`/`POST`/`PUT`/`DELETE` (not `"*"`;
    PUT and DELETE were added for Issue 10 — PUT was missing before then,
    so the edit form's Save was silently blocked by the browser's CORS
    preflight even though curl and Jest's mocked `fetch` never exercise
    real CORS enforcement and so never caught it) — and a `lifespan`
    handler that creates the repository — and therefore the SQLite schema
    — at startup, not the deprecated `on_event`),
    `routes.py` (`/health`, `GET /apartments` — active apartments only,
    `sort_order`, `{"id", "name"}` per item (a `GET /categories` endpoint
    existed here too, until the expense-category feature was removed —
    see
    [docs/adr/0004-remove-categories.md](docs/adr/0004-remove-categories.md);
    the path now simply 404s, like any other undefined route),
    `POST /receipts/upload` —
    `apartment_id` is a **required** form field, validated via
    `repository.get_apartment()` *before* the existing file-type/size
    validation and before anything is written (missing -> FastAPI's own
    `422`; unknown -> `422` "Unknown apartment."; inactive -> `422` "This
    apartment is no longer active." — none of these touch disk or create
    an uploads row), stored on the uploads row, echoed in the response as
    `apartment_id`/`apartment_name`,
    `POST /receipts/{receipt_id}/extract`, `GET /receipts/{receipt_id}`,
    `GET /receipts?limit=N` — list, newest first, `limit` default 50
    (1–200, else `422`), `{"items": [...], "count": N}`, empty DB ->
    `{"items": [], "count": 0}` never `404`. **No `offset` param and no
    `total` field** — unlike `GET /items` below, which has both — so
    there is currently no way to page past the first `limit` receipts;
    a frontend ticket ("Tidy History filters and add Show more") hit
    this gap and stopped rather than guess at a backend change (see
    [docs/design.md](docs/design.md)'s "Tidying History filters" section
    for exactly what `GET /receipts` would need — an `offset` param and
    a `total` field, mirroring `GET /items` — to support it). Optional filters, AND-combined,
    no params unchanged from before, validated by the shared
    `_validate_receipt_filters(repository, apartment_id, year, status)`
    helper (also used by `GET /items`, below, so the two
    endpoints' filter rules can never drift apart): `apartment_id` (422 via
    `repository.get_apartment()` if unknown — same check and message as the
    apartment PUT), `year` (`_parse_year_filter()`: a 4-digit `\d{4}`
    2000–2100 or the literal string `"none"` for null/non-ISO dates; the
    `\d{4}` regex check happens *before* `int()` + range, so `"2025x"`/
    `"25"`/`"20255"` are rejected the same way a too-small/too-large year
    is, all `422`), `status` (`"needs_review"`/`"approved"` else `422`).
    (A `category_id` filter existed here too; it was removed along with the
    rest of the expense-category feature — see
    [docs/adr/0004-remove-categories.md](docs/adr/0004-remove-categories.md)
    — so a client still sending it now gets it silently ignored, like any
    other undeclared query parameter, rather than a `422`.)
    `GET /receipts/facets?apartment_id=<optional>` —
    registered *before* `GET /receipts/{receipt_id}` in `routes.py` (source
    order is what FastAPI matches on) so the literal path `/receipts/facets`
    is never captured by that route's `{receipt_id}` segment; 422 for an
    unknown `apartment_id`; returns `repository.get_receipt_facets(...)
    .model_dump()` directly.
    `GET /items` — a flat list of purchased line items across receipts:
    `{"items": [...], "count": <returned>, "total": <all matching rows>}`.
    Accepts the identical `apartment_id`/`year`/`status`
    (same `_validate_receipt_filters()` call, same `422` rules, same
    "unrecognized parameter is ignored" behavior for a stray `category_id`)
    plus `q`
    (stripped; `422` if longer than `MAX_ITEM_SEARCH_LENGTH` = 100 *after*
    stripping; a blank result is treated as "no search," not an error),
    `sort` (`Query(default=DEFAULT_ITEM_SORT)`, 422 if not in
    `ALLOWED_ITEM_SORT_VALUES` — checked right after the shared filter
    validation, before the `q` length check), and
    `limit`/`offset` (`Query(default=100, ge=1, le=500)`/
    `Query(default=0, ge=0)`, else `422`). Calls
    `repository.list_matching_receipts(**filters)` (unlimited, already
    apartment/year/status-filtered), then — entirely in Python,
    documented in a code comment as fine at this app's scale but not
    forever — flattens every matching receipt via
    `domain.rules.flatten_line_items`, filters by `q` via
    `domain.rules.matches_query` when `q` isn't blank, sorts via
    `domain.rules.sort_line_items(rows, sort)` (always — even for the
    default — so the explicit `sort=date_desc` and no `sort` param at all
    produce byte-identical responses), and *then* slices
    `rows[offset : offset + limit]`; `total` is `len(rows)` *before* that
    slice, `count` is `len(page)` after it. Without a `sort` param, row
    order (receipt
    `created_at` DESC/`receipt_id` ASC, then `line_index` ASC) used to
    fall out
    entirely from `list_matching_receipts`'s own order plus
    `flatten_line_items` enumerating each receipt's `items` in place; that
    tie-break order is now the *fallback* within `sort_line_items` (see
    `domain/rules.py` above) rather than the only order, since
    `date_desc` is now the explicit default sort rather than "no
    sorting at all" — a deliberate, intentional change to the previously
    implicit default order (the pre-existing ordering tests in
    `tests/test_items.py` needed no changes, since every row in them
    shares the same `purchase_date`, so `date_desc`'s stable tie-break
    reproduces the exact order those tests already asserted; new tests
    cover every sort mode explicitly). `PUT /receipts/{receipt_id}`
    — corrects the editable fields, `FastAPI`-validates the body against
    `ReceiptUpdate` (auto-`422`), 404 if the receipt doesn't exist (PUT
    never creates one), 200 with the same shape/types as GET,
    `POST /receipts/{receipt_id}/reset` — discards edits, restores
    `ai_result_json` into the displayed data (never touching
    `ai_result_json` itself), clears `edited`/`edited_at`; 400/404 the same
    way as the other id-taking routes, 500 generic on a repository failure,
    200 with the same shape as GET; idempotent (safe to call repeatedly or
    on a never-edited receipt); never calls `get_extractor` or touches the
    stored file. Already allowed by the existing CORS `allow_methods` list
    (`tests/test_reset_and_edited.py` has a preflight test for it anyway).
    `PUT /receipts/{receipt_id}/apartment` — moves a receipt to a different
    apartment: body validated against `ApartmentAssignment` (missing/null
    `apartment_id`, or any extra field -> FastAPI's own `422`); 400 for a
    non-UUID id; 404 if no `receipts` row exists (checked via `get_receipt`
    before the apartment is validated, same as the other id-taking routes);
    422 via `repository.get_apartment()` for an unknown or inactive
    apartment (same messages as upload's check); 500 generic on a
    repository failure; 200 with the same shape as GET (including
    `warnings`). Calls `repository.set_receipt_apartment(...)`, never
    `update_receipt`/`reset_receipt` — so `edited_at`, `extracted_json`,
    `ai_result_json` and `created_at` are always left untouched. A later
    re-extract keeps this apartment, since `extract_receipt`'s own
    `ON CONFLICT` branch never overwrites `apartment_id`. (A
    `PUT /receipts/{receipt_id}/category` endpoint existed here too, until
    the expense-category feature was removed — see
    [docs/adr/0004-remove-categories.md](docs/adr/0004-remove-categories.md);
    the path now simply 404s.)
    `PUT /receipts/{receipt_id}/status` — body validated against
    `StatusAssignment` (FastAPI's own `422` for a missing/invalid/extra
    field); 400 non-UUID id; 404 if no `receipts` row exists. Setting
    `ReceiptStatus.NEEDS_REVIEW` is always allowed; setting
    `ReceiptStatus.APPROVED` first calls `_missing_approval_fields(saved)`
    — a pure helper checking, in this fixed order, `apartment_id is None`,
    `normalize_purchase_date(purchase_date) is
    None` (the same shared date rule `domain.rules` uses elsewhere — never
    a bare `date.fromisoformat`, so a stray-but-recoverable date like
    `"2025-06-26 11"` still counts as valid), and `total is None` — and if
    that list is non-empty, `422`s with
    `{"detail": {"message": "...", "missing": [...]}}` listing only the
    actually-missing ones, never all three unconditionally (a category
    check used to be part of this list too — see
    [docs/adr/0004-remove-categories.md](docs/adr/0004-remove-categories.md)).
    Data-quality
    `warnings` are deliberately never checked here — approval is a human
    decision, not a data-quality gate. 500 generic on a repository
    failure; 200 with the same shape as GET either way. Calls
    `repository.set_receipt_status(...)`, never `update_receipt`/
    `reset_receipt`/`set_receipt_apartment` — so
    `edited_at`, `extracted_json`, `ai_result_json`, `created_at` and
    `apartment_id` are always left untouched.
    **Editing an approved receipt:** `PUT /receipts/{id}` (the
    data-correction endpoint) never reads or changes `status` — an
    already-approved receipt silently stays `approved` after a
    correction; `tests/test_status_endpoints.py`'s
    `test_editing_an_approved_receipt_keeps_it_approved` documents this
    rather than adding a gate, per the ticket that introduced it.
    `DELETE /receipts/{receipt_id}` — 204 (empty body) on success, 400 for
    a non-UUID id, 404 if no `receipts` row exists (unknown id, or
    uploaded-but-never-extracted — nothing touched on disk or in the DB);
    order of operations is confirm-exists -> remove file -> remove DB
    rows, so a failure partway through always leaves a state a retry can
    finish (an already-gone file is a no-op, not an error).
    **`warnings`:** extract, GET and PUT (and the reset endpoint, below)
    all merge `"warnings": [w.model_dump() for w in check_receipt(data,
    date.today())]` into their response dict via the shared
    `_warnings_payload()` helper — computed fresh on every request, never
    stored, never blocking any action. The extract/GET/PUT contract test
    (`tests/test_get_receipt.py`'s `EXTRACTED_FIELD_NAMES`) includes
    `"warnings"` and `"status"`.
    `extract_receipt`'s response includes
    `status` the same way it does `apartment_id`/`apartment_name` — read
    from the `get_receipt()` re-fetch right after saving, falling back to
    `ReceiptStatus.NEEDS_REVIEW` if that re-fetch somehow returns
    nothing.
    `GET /receipts/{receipt_id}/file` — serves the original upload via
    `FileResponse` for a saved receipt (same existence check as GET); 400
    for a non-UUID id, 404 if no saved receipt exists or the file is
    missing from disk (logged server-side with the receipt_id only).
    `Content-Type` always comes from `domain.rules.media_type_for_extension`
    on the *stored* file's extension — never the client-supplied
    `content_type` and never sniffed — plus `X-Content-Type-Options:
    nosniff`, `Content-Disposition: inline` (no filename, ever) and
    `Cache-Control: private, no-cache`. No `X-Frame-Options` is set, since
    the frontend may show a PDF in a same-origin iframe. **No
    authentication**, same as every other endpoint here: anyone who can
    reach the server and knows a receipt id can fetch its file.
    `GET /receipts/{receipt_id}/archive.pdf`
    (`adapters/pdf_archive.py`, `domain.rules.archive_filename`) —
    downloads a saved receipt as a single-page PDF, for uniform documents
    regardless of the original format; same 400/404 checks as the plain
    file endpoint above (UUID, saved receipt exists, file exists on disk).
    Defined with plain `def` (not `async def`) specifically so FastAPI
    runs Pillow's conversion in its threadpool, never blocking the event
    loop; nothing here is ever written to disk or the database — the
    original is only ever read, never modified (`test_receipt_archive.py`
    hashes the stored file before/after the call to prove this).
    `make_archive_pdf(path)`: a `.pdf` original is returned byte-for-byte
    via `path.read_bytes()`, no re-encoding at all; a `.jpg`/`.jpeg`/
    `.png` is opened with `PIL.Image.open()` (which only reads header
    metadata, not pixel data), and its `width * height` is checked against
    `MAX_PIXELS` (`60_000_000`) **before** anything calls `.load()`/
    `.convert()`/`.resize()` — so a small file crafted to decode into a
    huge image (a decompression bomb) is rejected cheaply, never
    decoded. `prepare_image(img)`: `ImageOps.exif_transpose()` first (so a
    sideways phone photo's orientation tag — e.g. tag 6 — rotates the
    pixels and correctly swaps width/height, rather than leaving the
    image sideways), then any `RGBA`/`LA`/transparent-`P`-mode image is
    flattened onto a plain white background and converted to `RGB`
    (non-transparent images are just `.convert("RGB")`'d directly), then
    downscaled — **never upscaled** — via `Image.LANCZOS` only if the
    long edge exceeds `MAX_LONG_EDGE` (`3000`), aspect ratio preserved.
    The PDF itself is `prepared.save(buffer, format="PDF")` with no
    extra arguments, so Pillow sizes the page to the image itself (no
    forced A4) and copies no EXIF/metadata from the original into the
    output. Any failure (corrupt/truncated image, oversized image, I/O
    error) raises `ArchiveError` (chaining the real cause via `from exc`
    for the server log), which the route maps to `422` with the fixed,
    generic message `"This file could not be converted to PDF."` — the
    real exception is logged via `logger.exception(...)`, identified by
    receipt_id only, exactly like the extract/save/update/delete failure
    paths elsewhere in this file. `domain.rules.archive_filename(...)`
    builds the `Content-Disposition` filename: every part (apartment id,
    date, store name, amount+currency) is independently slugified —
    lowercased, transliterated to ASCII (`"ß"` → `"ss"`, accents stripped
    via NFKD), everything outside `a-z`/`0-9`/`.`/`-` collapsed to a
    single `-` — so a hostile store name (CRLF/header-injection attempts,
    path traversal, quotes, non-ASCII) can never produce an unsafe
    filename; a missing/invalid part becomes a fixed placeholder
    (`"no-apartment"`/`"undated"`/`"unknown-store"`/`"no-total"`) rather
    than being silently dropped. `purchase_date` is only used if
    `date.fromisoformat()` accepts it (never guessed); `total` is
    formatted via `Decimal(str(total))` with exactly 2 decimals — never
    float arithmetic. The store-name part is capped at 40 chars, the
    whole filename (incl. `.pdf`) at 120. **`PIL` is used only in
    `adapters/`** — `domain/rules.py`'s `archive_filename` never imports
    it, and `PIL` was added to `domain`'s forbidden-modules list in
    `.importlinter` alongside `fastapi`/`openai`/`sqlite3` (confirmed
    still `KEPT` by `lint-imports`). **Pillow is a new dependency**
    (`requirements.txt`, pinned to the latest stable release at the time
    it was added) — `make_archive_pdf` is written generically enough
    (any file in → PDF bytes out, for one receipt) to be reused later for
    a batch/ZIP export, without changes;
    the `get_extractor` and `get_repository` dependencies; server-side
    logging of extraction, save, update, and delete failures; maps domain
    exceptions to HTTP status codes: 400/413 from upload rules, 502 from
    `ExtractionError`, 503 from `ExtractionUnavailableError` or when
    `OPENAI_API_KEY` is not configured, 500 generic on a repository
    save/update/delete or file-removal failure — raw error text is never
    returned to the client).
    **Apartment on extract:** before saving, `extract_receipt` reads
    `repository.get_upload(receipt_id).apartment_id` (`None` if no uploads
    row) and passes it to `save_receipt(...)` — that call's own `INSERT`
    sets it on a first save, while its `ON CONFLICT` branch *omits*
    `apartment_id` from the `SET` clause entirely, so a re-extract leaves
    whatever is already stored untouched rather than overwriting it with
    `None`. The response's `apartment_id`/`apartment_name` come from a
    `get_receipt()` re-fetch right after saving (reusing its join, rather
    than duplicating the lookup) so they always reflect the receipt's true
    stored apartment, not just the upload's.
    A custom `RequestValidationError` handler in `app.py` stringifies any
    non-finite float (`NaN`/`Infinity`) echoed back in a `422` error's
    `"input"` field — otherwise Starlette's own JSON encoder crashes
    trying to serialize the error response itself, since stdlib `json`
    accepts `NaN` as *input* but refuses to emit it as *output*.
  - `main.py` stays a thin entry point (`from api.app import app`) so
    `uvicorn main:app --reload --port 8001` keeps working.
  - `config.py` stays at the backend root; reads `backend/.env`
    (`backend/.env.example`, the former gitignored). CORS allowed origins
    come from `CORS_ORIGINS` (default `http://localhost:5173`).
    `OPENAI_API_KEY` is normalized to `None` ("not configured") when
    missing, empty, or equal to the `.env.example` placeholder
    (`your-key-here`) — so a forgotten placeholder key behaves exactly
    like a missing one (503, no provider call) instead of reaching OpenAI.
    `DATABASE_PATH` (default `data/receipts.db`) configures the SQLite
    file; a relative value is resolved against `backend/` (the folder
    containing `config.py`), not the current working directory, so
    starting `uvicorn` from elsewhere (e.g. `--app-dir backend` from the
    repo root) never creates a second, empty database — an absolute value
    is used as given. `backend/data/` and `*.db` are gitignored.
  - Dependency direction: `api` -> `adapters` -> `domain`, and `api` ->
    `domain` directly. Enforced by import-linter (`backend/.importlinter`).
  - `scripts/` — operational tooling, deliberately outside the
    domain/adapters/api layers (not covered by `.importlinter`, and must
    never be imported by any of those three): `_common.py` (shared
    constants/hashing: `MANIFEST_FILENAME`, `DB_ARCNAME`, `UPLOADS_PREFIX`,
    `BACKUP_GLOB_PATTERN`, `sha256_file`/`sha256_bytes`), `backup.py`
    (`python scripts/backup.py [--out DIR] [--keep N]` — copies the
    database via `sqlite3.Connection.backup`, not a plain file copy, so the
    copy is consistent even while the server is running; runs
    `PRAGMA integrity_check` on the copy before zipping anything and aborts
    with no zip left behind if it isn't `"ok"`; zips `receipts.db`, every
    `backend/uploads/` file except `.gitkeep`, and a `manifest.json` of row
    counts + a SHA-256 per file; writes to a `.partial` name and
    `os.replace`s it into place only once complete; re-opens and verifies
    the finished zip against its own manifest; `--keep N`, default 30,
    deletes only the oldest files matching `receipts-backup-*.zip` in the
    output directory. Pure backup/verify logic (`run_backup`) takes
    explicit `database_path`/`uploads_dir` arguments and never imports
    `config`/`adapters` itself — only the CLI's `main()` does, lazily, so
    the logic stays trivially testable against temp paths. Never reads or
    copies `backend/.env`), `restore.py`
    (`python scripts/restore.py ZIPFILE --target DIR [--force]` — restores
    into a plain data folder, **never the live data directly**; every zip
    member is read into memory and fully validated — manifest present,
    every path safe (no absolute path, no `..`, zip-slip protected), every
    file's SHA-256 matching the manifest, the restored database passing
    `PRAGMA integrity_check` with row counts matching the manifest — before
    anything is written to `--target`, so a rejected zip leaves the target
    untouched; refuses a `--target` that already has data unless `--force`,
    which moves the existing `receipts.db`/`uploads/` into
    `<target>/pre-restore-<timestamp>/` first instead of deleting them).
  - **Note:** calling the extract endpoint sends the receipt file to
    OpenAI; the resulting receipt data is then stored locally in SQLite
    (the file itself stays in `backend/uploads/`, never in the database).
    **Delete only removes local state** (the database record and the
    local file) — it cannot and does not delete the copy OpenAI already
    received when the receipt was extracted.

## Running locally

```bash
# Frontend dev server
cd frontend && npm run dev

# Backend dev server (runs on port 8001, matching frontend's VITE_API_URL)
cd backend && source venv/bin/activate && uvicorn main:app --reload --port 8001

# Frontend tests
cd frontend && npm test

# Backend tests
cd backend && source venv/bin/activate && pytest

# Backend boundary check (venv active)
cd backend && source venv/bin/activate && lint-imports

# Frontend boundary check
cd frontend && npm run check:deps
```

## Conventions

- Keep changes scoped to what's asked — don't add features, UI, or
  abstractions beyond the current task.
- `frontend/` and `backend/` changes should stay separate; only touch both
  when a task explicitly requires it.
- Do not commit automatically — only commit when explicitly told to.
- Before every commit: run `pytest`, `lint-imports` (backend, venv active),
  `npm test` and `npm run check:deps` (frontend).
- Never delete files you did not create.
- Never overwrite `backend/.env` — use `cp -n` (not `cp`) when seeding it
  from `.env.example`, and never print, copy, or commit its contents or
  any API key.
- Current phase: early MVP build. Features are being added incrementally
  per ticket — see GitHub Issues for the backlog.
- **Color or style changes must be verified against the built CSS, not
  just the Tailwind config or component source.** jsdom cannot see
  colors, layout, or contrast — all 100+ frontend tests can pass while a
  button is genuinely invisible in a real browser. After any such change,
  run `npm run build` and grep the generated `dist/assets/*.css` for the
  actual classes involved (e.g. `grep -o '\.bg-brand{[^}]*}' dist/assets/*.css`)
  and read the real `background-color`/`color`/`border-color` value —
  don't assume a class exists or resolves correctly just because it's
  spelled correctly in the source. Delete `dist/` afterward; never commit
  it. See `src/components/ui/Button.contrast.test.ts` for a test-level
  version of this same check (resolves the real Tailwind theme and
  verifies every token/contrast pair), and open `?view=styleguide` (dev
  only) to look at every component state directly.
