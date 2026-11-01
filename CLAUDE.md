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
  ratios, and when to use each shared component. Shared UI components live
  in `src/components/ui/` (`Button`, `Card`, `Alert`, `Spinner`, `Container`,
  `RadioCardGroup`, `formatFileSize`) — reach for these instead of ad hoc
  markup. All
  interactive elements need a visible `focus-visible` ring and a minimum
  44px touch target on small screens; never convey state with color alone.
  User-visible strings and roles that existing tests assert on (e.g.
  "Uploading...", "Extracting receipt data...", "Receipt not found",
  "Upload another receipt", the 502/503 messages) must stay exactly as they
  are unless a task explicitly asks to change them.
  `src/api/` holds API call modules (`uploadReceipt.ts`, `extractReceipt.ts`,
  `getReceipt.ts`, `listReceipts.ts` (accepts `{limit?, apartmentId?,
  year?, status?, categoryId?}`, building the query string itself),
  `getApartments.ts`,
  `updateReceiptApartment.ts`, `getCategories.ts`, `updateReceiptCategory.ts`,
  `updateReceiptStatus.ts`, `getReceiptFacets.ts` (`GET /receipts/facets`,
  optional `apartmentId`), shared `ApiError` (carries an optional `missing:
  string[]`, set only for a `422` from `updateReceiptStatus` whose body is
  `{detail: {message, missing}}` — every other error, including a
  malformed body, falls back to a plain message with no `missing`), shared
  response types in
  `types.ts` — including `ReceiptSummary`, the list-row shape,
  `Apartment` (`id`/`name`), `Category` (`id`/`name`), `ReceiptStatus`
  (`'needs_review' | 'approved'`), `ApartmentFacet` (`id`/`name`/`count`)
  and `ReceiptFacets` (`apartments`/`total`/`years`/`has_undated`);
  `ReceiptExtraction` and `ReceiptSummary`
  both carry flat `apartment_id`/`apartment_name` (`string | null`) and
  `category_id`/`category_name` (`string | null`) plus `status`
  (`ReceiptStatus`), matching
  every backend receipt-shaped response); the backend URL is read from
  `VITE_API_URL` (`.env.example` / `.env`, the latter gitignored).
  `ReceiptUpload.tsx` uploads a file then automatically calls extract and
  renders `ReceiptResult.tsx` with the structured result.
  **Apartment choice (`hooks/useApartments.ts`, `ui/RadioCardGroup.tsx`):**
  the upload form shows a `RadioCardGroup` above the dropzone, legend "Which
  apartment is this receipt for?", nothing preselected. `useApartments`
  fetches `GET /apartments` only while the plain upload form is about to
  render (never while reopening/showing/failing to load a saved receipt by
  id); a *successful* result is cached at module scope (so "Upload another
  receipt" never re-fetches it) but a failure is never cached, so its
  `retry()` tries again. States above the dropzone: loading ("Loading
  apartments..." in a `role="status" aria-busy="true"` region with two
  `Skeleton` blocks), failure (`Alert variant="error"` + "Retry", upload
  impossible either way), or the loaded group. "Read receipt" stays disabled
  until a valid file **and** a chosen apartment are both present; with only
  a file, a muted "Choose an apartment to continue." hint is shown, tied to
  the group via `aria-describedby`. The chosen `apartmentId` is plain
  component state, untouched by `handleRemoveFile`/`processFile`/
  `handleReset`, so it survives Remove, a new file, and "Upload another
  receipt" within the session (never persisted across a real reload).
  `uploadReceipt(file, apartmentId)` sends `apartment_id` as a second
  `FormData` field.
  Dependency direction: UI components (`App.tsx`, `ReceiptUpload.tsx`,
  `ReceiptResult.tsx`, `ReceiptHistory.tsx`) -> `src/api/` ->
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
  `ReceiptHistory.tsx` (`?view=history`) or `ReceiptUpload.tsx` (otherwise —
  including `?receipt=<id>`) to render, keying each on the current
  `location.search` so external navigation remounts cleanly without
  disturbing `ReceiptUpload`'s own internal `replaceState` calls.
  `ReceiptHistory.tsx` lists saved receipts (store, date, total; "Not
  detected" for anything missing, each row's `apartment_name` as a small
  icon+text badge or plain muted "Not assigned" when it's `null`/missing
  (hidden entirely inside a specific apartment tab — redundant there),
  `category_name` as a plain outlined badge or muted "No category" when
  `null`/missing, and `status` as a `StatusBadge` (icon+text, shared with
  `ReceiptClassification.tsx`)) and navigates to `?receipt=<id>` on row
  click; `ReceiptUpload.tsx` adds a "Back to history" link when showing a
  result.
  **Splitting the history by apartment, with filters:** all state lives in
  the URL (`?view=history&apartment=<id>&year=<v>&status=<v>&category=
  <v>`), never component state — a tab/select change calls the existing
  `navigateTo()`, which (via `App.tsx`'s `key={locationKey}`) fully
  remounts `ReceiptHistory`, the same mechanism `ReceiptUpload` already
  relies on, so no new "re-fetch on filter change" effect was needed.
  `ReceiptHistory` reads the URL once per mount (`readUrlParams()`), waits
  for `useCategories(true)` to settle (success or failure — gates the
  single data-loading effect via its `isLoading`), then: (1) fetches
  `GET /receipts/facets` **unscoped** — always needed for the tab bar's
  counts, and this is also the apartment-id validation source (a URL
  `apartment` not among the returned ids is dropped, never sent to the
  list endpoint); (2) if that leaves a valid apartment, fetches
  `GET /receipts/facets?apartment_id=...` **again**, scoped, purely to get
  the Year select's `years`/`has_undated` limited to that apartment (its
  `apartments`/`total` are discarded — ticket-specified behavior: only
  years/`has_undated` are apartment-scoped); (3) validates `year`
  (`/^\d{4}$/` or `"none"`) and `status` (the two literal allowed values)
  structurally, `category` against the loaded `useCategories` list
  referentially, each invalid value simply dropped (never sent) rather
  than erroring — this is "ignored," distinct from a well-formed value
  that legitimately matches zero receipts; (4) calls `listReceipts(...)`
  with whatever survived. The tab bar follows the WAI-ARIA tabs pattern:
  `role="tablist"` (`aria-label="Apartment"`), one `role="tab"` per
  apartment plus a leading "All apartments (N)", roving `tabIndex`
  (selected = `0`, else `-1`), `aria-selected`, and selected = bold text +
  white background/shadow against the tab bar's `slate-100`, never color
  alone. Arrow keys/Home/End navigate immediately (automatic activation);
  since that navigation remounts the whole component, a one-shot
  `sessionStorage` key (`receiptHistoryFocusTabIndex`, read/cleared in an
  effect gated on `!isLoading` — the tab bar doesn't exist in the DOM
  until loading finishes) restores keyboard focus to the newly selected
  tab across that remount. "N receipts" is a `role="status"`; "Clear
  filters" shows only when a year/status/category select (not just an
  apartment tab) is active, and resets exactly those three, leaving the
  apartment tab alone, per spec. The plain "No receipts yet..." empty
  state is reserved for truly no filters at all (`isUnfiltered`); any
  other empty result shows "No receipts match these filters." instead,
  relying on the one "Clear filters" button above rather than a second
  copy. Opening a receipt attaches `&from=<encoded search>` to
  `?receipt=<id>` **only** when a tab/filter is actually active (so the
  unfiltered case's URL shape is byte-for-byte unchanged, keeping an
  existing test's exact-URL assertion intact); `ReceiptUpload.tsx`'s
  "Back to history" link reads that `from` param (`getHistoryReturnSearch()`,
  only trusting a value starting with `?view=history`) to return to the
  same tab/filters, falling back to the plain `?view=history`.
  **Changing the apartment on a saved receipt (`ReceiptApartment.tsx`,
  `src/api/updateReceiptApartment.ts`):** rendered by the saved-receipt
  container (the same `if (result)` branch used right after extraction and
  when reopening `?receipt=<uuid>`) directly above `ReceiptResult` —
  `ReceiptResult.tsx` itself is never touched. The same `RadioCardGroup`,
  legend "Apartment", with the receipt's `apartment_id` selected (or
  nothing selected, with no extra message, when it's `null`); it fetches
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
  **Category and review status on a saved receipt
  (`ReceiptClassification.tsx`, `hooks/useCategories.ts`,
  `ui/StatusBadge.tsx`):** rendered next to `ReceiptApartment` in the same
  non-editing branch (so it's hidden on the same condition, while the edit
  form is open) — `ReceiptResult.tsx` itself is never touched. A native
  `<select>` (visible `<label>` "Category", placeholder option "Choose a
  category", the receipt's `category_id` selected or the placeholder when
  it's `null`) fetches its own list via `useCategories(true)` (same
  cache-successful-only/never-cache-failure pattern as `useApartments`, its
  own module-level cache, test-only `clearCategoriesCache()`). Changing it
  calls `PUT /receipts/{id}/category`: "Saving..." and the select disabled
  while pending; success calls back up with the response (no extra `GET`)
  and shows "Saved" in a `role="status"`; failure shows an
  `Alert variant="error"` and reverts the select to its previous value.
  Separately, a `StatusBadge` shows the current `status`
  ("Needs review"/warning-toned clock icon, or "Approved"/success-toned
  check icon — never color alone) next to a primary "Mark as approved"
  button (shown when `needs_review`) or a secondary "Back to needs review"
  button (shown when `approved`); either calls
  `PUT /receipts/{id}/status`, showing "Saving..." and disabling the
  visible button (not hiding it) while pending. A `422` with
  `{detail: {message, missing}}` is turned into a plain-words
  `Alert variant="error"` by a local `describeMissing()` mapping each code
  (`apartment`/`category`/`date` -> "a valid purchase date"/`total`) and
  joining them ("To approve this receipt, also set: apartment,
  category."), appending "You can fix the date with Edit." only when
  `date` is in the list; the status is left unchanged on this failure.
  Calls neither `extractReceipt` nor the plain `updateReceipt`/
  `PUT /receipts/{id}`.
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
  server would reject) and no hint is shown.
  Never calls the extract endpoint.
  **Data-quality warnings, Edited badge, reset
  (`ReceiptResult.tsx`, `src/api/resetReceipt.ts`):** when `data.warnings`
  is non-empty, `ReceiptResult` renders an `Alert variant="warning"`
  ("Check these values", icon + bulleted messages) above the data card;
  empty `warnings` renders nothing, and warnings never block any action.
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
  original file is not available." instead of a broken image.
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
  the single-file row (the dropzone/apartment group/camera button stay).
  Both are disabled while `isBusy || batch.running`
  (`isInputDisabled`); selecting a single file while a finished/failed
  batch is still shown calls `batch.reset()` first, so the two panels
  never coexist. `BatchQueue` renders a `<ul>` (file icon, truncated name
  with a `title`, size via the shared `formatFileSize`, an icon+text
  status chip for Waiting/Uploading…/Reading…/Done/Failed — never color
  alone), a native `<progress>` with a `<label>` and a `role="status"`
  summary ("X of Y read, Z failed"), and rejected files in a warning
  `Alert` as `"<name>: <reason>"` (or just the reason with no filename,
  e.g. the MAX_BATCH overflow entry). A done row with a `receiptId` gets a
  real `<a href="/?receipt=<id>" target="_blank"
  rel="noopener noreferrer">Open</a>` — a real anchor rather than
  `navigateTo()`, since the queue only lives in this page's memory and
  navigating away would lose it — plus a "Check values (N)" badge when
  `warningsCount > 0`; a failed row shows its error (same shared messages
  as the single-file flow) and a "Retry" button; "Remove" is offered for
  waiting/failed rows only, matching the engine's own no-op rule.
  **Start/stop/pause/finish**, in `ReceiptUpload.tsx`: before `start()`, a
  primary "Read N receipts" button (disabled until an apartment is chosen
  and N ≥ 1, same "Choose an apartment to continue." helper, now shown for
  `file || isBatchActive`) plus a muted "Each receipt is sent to OpenAI to
  read it (N requests)." note; while running and not paused, a secondary
  "Stop" button; while paused (`pausedReason`: `'unavailable'`/`'network'`
  from the engine, or `'stopped'` after Stop), an `Alert` (`error` variant
  for the first two, `warning` for `'stopped'`) with
  `EXTRACTION_NOT_CONFIGURED_MESSAGE`/`NETWORK_ERROR_MESSAGE`/a new local
  `STOPPED_MESSAGE` ("Stopped. The remaining receipts were not
  processed.") plus a "Resume" button. Once nothing is waiting or in
  flight (`batchWaitingOrInFlight`, derived from item statuses — the
  engine's own `running` flag is deliberately never reset back to `false`
  by `STOP`/finishing, so it can't be used for this check), a success
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
  active/inactive states, the logo mark, the dropzone's
  idle/drag-over/file-selected states, a `Skeleton` sample, the
  card-variant items list, the warnings panel/Edited badge/reset
  confirmation, a `BatchQueue` sample (one row per status plus rejected
  files) and the batch paused (unavailable/network/stopped)/finished
  states, with static sample data (no network
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
    `Category` (id/name/sort_order/active) and `DEFAULT_CATEGORIES` — the
    ten seeded, PLACEHOLDER expense categories (to be confirmed with a tax
    advisor), seeded the same way as `DEFAULT_APARTMENTS`; `ReceiptStatus`
    — plain string constants `NEEDS_REVIEW`/`APPROVED` (not an Enum, so
    they serialize as plain strings) and `ALLOWED_RECEIPT_STATUSES`.
    `SavedReceipt` and `ReceiptSummary` additionally carry flat
    `category_id`/`category_name` (`str | None`) and `status` (`str`,
    `"needs_review"` or `"approved"`) — same key set and JSON types across
    extract/GET/PUT/reset/apartment-PUT/list-item, see
    [docs/adr/0003-category-and-review-status.md](docs/adr/0003-category-and-review-status.md).
    `LineItemRow` — one flattened `GET /items` row (`receipt_id`,
    `line_index`, `name`, `quantity`, `unit_price`, `line_total`,
    `currency`, `purchase_date`, `store_name`, `apartment_id`,
    `apartment_name`, `category_name`, `status`); never stored, built
    fresh per request by `rules.flatten_line_items()`.
    `rules.py` (allowed file
    types, size limit, `media_type_for_extension()` — a pure
    extension -> fixed media type map used by the file-serving endpoint, so
    `Content-Type` is never taken from client input — plus two more pure
    functions: `normalize_purchase_date(raw)` extracts a leading ISO date
    (`"2025-06-26 11"`/`"2025-06-26T11:04:00"` -> `"2025-06-26"`) and
    returns `None` for anything else (never guesses day/month order for
    `"26/06/2025"`, never raises); `check_receipt(data, today)` — `today`
    is an injected parameter so callers/tests are deterministic — returns
    `MISSING_STORE`/`MISSING_DATE`/`DATE_NOT_STANDARD`/`FUTURE_DATE`
    (1-day grace)/`MISSING_TOTAL`/`TOTAL_MISMATCH` (skipped unless every
    item has a usable amount; tolerant of either tax-added-on-top or
    tax-already-included, tolerance `0.05`)/`LINE_MISMATCH` (per
    `Decimal(str(value))` math, never raw floats); raises domain
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
    skips calling this at all for a blank query),
    `ports.py` (`ReceiptExtractor` Protocol + `ExtractionError` /
    `ExtractionUnavailableError`, `ReceiptRepository` Protocol —
    `save_upload`/`get_upload`/`save_receipt`/`get_receipt`/
    `list_receipts`/`update_receipt`/`reset_receipt`/`delete_receipt`/
    `list_apartments`/`get_apartment`/`set_receipt_apartment`/
    `list_categories`/`get_category`/`set_receipt_category`/
    `set_receipt_status`/`get_receipt_facets`/`list_matching_receipts`,
    plus the
    strict, separate `ReceiptUpdate`/`LineItemUpdate`/`DiscountUpdate`/
    `TaxUpdate` models in `models.py` for user-submitted corrections, and
    `ApartmentAssignment` (`apartment_id: str`, `extra="forbid"`) for
    `PUT /receipts/{id}/apartment`'s body, `CategoryAssignment`
    (`category_id: str`, `extra="forbid"`) for
    `PUT /receipts/{id}/category`'s body, and `StatusAssignment`
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
    so the real cause is still logged), `file_storage.py` (saving/finding
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
    `receipts`, `apartments` and `categories` tables; schema created via
    `CREATE TABLE IF NOT EXISTS`, plus a small additive migration on
    construction — `PRAGMA table_info` then
    `ALTER TABLE ... ADD COLUMN` only for a column that's missing, never
    dropping/recreating a table, so existing rows always survive an
    upgrade; this is how `edited_at`, the nullable `apartment_id` columns
    on `uploads`/`receipts`, the nullable `category_id` column, and the
    `status TEXT NOT NULL DEFAULT 'needs_review'` column on `receipts`
    were all added — the `NOT NULL DEFAULT` applies to existing rows too,
    so every receipt that predates the column still gets `needs_review`.
    `apartments` and `categories` are both new tables (no migration
    needed there) seeded with `DEFAULT_APARTMENTS`/`DEFAULT_CATEGORIES`
    via `INSERT OR IGNORE` every time, so it's idempotent).
    `list_apartments`/`list_categories` return only `active = 1` rows
    ordered by `sort_order`; `get_apartment`/`get_category` return a row
    regardless of `active` (the route distinguishes "unknown" from
    "inactive" itself, and a receipt's `apartment_name`/`category_name`
    must still resolve even if deactivated later).
    `save_receipt`'s `INSERT`/`ON CONFLICT` deliberately omits
    `category_id` from the `ON CONFLICT` `SET` clause (same reasoning as
    `apartment_id`: a first save inserts `NULL`, a re-extract leaves
    whatever is already there untouched) but always resets `status` to
    `'needs_review'` on every save, first or re-extract alike, since the
    underlying data was just replaced.
    `set_receipt_category`/`set_receipt_status` mirror
    `set_receipt_apartment`: one transaction, updates only `category_id`/
    `status` plus `updated_at`, returns `None` if no `receipts` row exists
    (so the route 404s), never touches `edited_at`, `extracted_json`,
    `ai_result_json`, `created_at`, or each other's column.
    `list_receipts` orders by `created_at DESC, receipt_id ASC` (stable
    tie-break) and builds each row from `extracted_json` (same source as
    `get_receipt`, so `total`'s JSON type matches); a row with unparseable
    `extracted_json` is logged (receipt_id only) and skipped rather than
    failing the whole list.
    **Filtering (`apartment_id`/`year`/`undated`/`status`/`category_id`/
    `no_category` params):** `apartment_id`, `status` and `category_id`
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
    `sort_order`, `{"id", "name"}` per item, `GET /categories` — same
    shape, active categories only, ordered by `sort_order`,
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
    `{"items": [], "count": 0}` never `404`. Optional filters, AND-combined,
    no params unchanged from before, validated by the shared
    `_validate_receipt_filters(repository, apartment_id, year, status,
    category_id)` helper (also used by `GET /items`, below, so the two
    endpoints' filter rules can never drift apart): `apartment_id` (422 via
    `repository.get_apartment()` if unknown — same check and message as the
    apartment PUT), `year` (`_parse_year_filter()`: a 4-digit `\d{4}`
    2000–2100 or the literal string `"none"` for null/non-ISO dates; the
    `\d{4}` regex check happens *before* `int()` + range, so `"2025x"`/
    `"25"`/`"20255"` are rejected the same way a too-small/too-large year
    is, all `422`), `status` (`"needs_review"`/`"approved"` else `422`),
    `category_id` (a known id via `repository.get_category()`, or the
    literal string `"none"` for a null category, else `422` — `"none"` is
    checked *before* calling `get_category()`, so it's never treated as an
    unknown id). `GET /receipts/facets?apartment_id=<optional>` —
    registered *before* `GET /receipts/{receipt_id}` in `routes.py` (source
    order is what FastAPI matches on) so the literal path `/receipts/facets`
    is never captured by that route's `{receipt_id}` segment; 422 for an
    unknown `apartment_id`; returns `repository.get_receipt_facets(...)
    .model_dump()` directly.
    `GET /items` — a flat list of purchased line items across receipts:
    `{"items": [...], "count": <returned>, "total": <all matching rows>}`.
    Accepts the identical `apartment_id`/`year`/`status`/`category_id`
    (same `_validate_receipt_filters()` call, same `422` rules) plus `q`
    (stripped; `422` if longer than `MAX_ITEM_SEARCH_LENGTH` = 100 *after*
    stripping; a blank result is treated as "no search," not an error) and
    `limit`/`offset` (`Query(default=100, ge=1, le=500)`/
    `Query(default=0, ge=0)`, else `422`). Calls
    `repository.list_matching_receipts(**filters)` (unlimited, already
    apartment/year/status/category-filtered), then — entirely in Python,
    documented in a code comment as fine at this app's scale but not
    forever — flattens every matching receipt via
    `domain.rules.flatten_line_items`, filters by `q` via
    `domain.rules.matches_query` when `q` isn't blank, and slices
    `rows[offset : offset + limit]`; `total` is `len(rows)` *before* that
    slice, `count` is `len(page)` after it. Row order (receipt
    `created_at` DESC/`receipt_id` ASC, then `line_index` ASC) falls out
    entirely from `list_matching_receipts`'s own order plus
    `flatten_line_items` enumerating each receipt's `items` in place — no
    separate sort needed. `PUT /receipts/{receipt_id}`
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
    `ON CONFLICT` branch never overwrites `apartment_id`.
    `PUT /receipts/{receipt_id}/category` — same shape of rules as the
    apartment PUT above, against `CategoryAssignment` and
    `repository.get_category()`/`set_receipt_category()`.
    `PUT /receipts/{receipt_id}/status` — body validated against
    `StatusAssignment` (FastAPI's own `422` for a missing/invalid/extra
    field); 400 non-UUID id; 404 if no `receipts` row exists. Setting
    `ReceiptStatus.NEEDS_REVIEW` is always allowed; setting
    `ReceiptStatus.APPROVED` first calls `_missing_approval_fields(saved)`
    — a pure helper checking, in this fixed order, `apartment_id is None`,
    `category_id is None`, `normalize_purchase_date(purchase_date) is
    None` (the same shared date rule `domain.rules` uses elsewhere — never
    a bare `date.fromisoformat`, so a stray-but-recoverable date like
    `"2025-06-26 11"` still counts as valid), and `total is None` — and if
    that list is non-empty, `422`s with
    `{"detail": {"message": "...", "missing": [...]}}` listing only the
    actually-missing ones, never all four unconditionally. Data-quality
    `warnings` are deliberately never checked here — approval is a human
    decision, not a data-quality gate. 500 generic on a repository
    failure; 200 with the same shape as GET either way. Calls
    `repository.set_receipt_status(...)`, never `update_receipt`/
    `reset_receipt`/`set_receipt_apartment`/`set_receipt_category` — so
    `edited_at`, `extracted_json`, `ai_result_json`, `created_at`,
    `apartment_id` and `category_id` are always left untouched.
    **Editing an approved receipt:** `PUT /receipts/{id}` (the
    data-correction endpoint) never reads or changes `status` — an
    already-approved receipt silently stays `approved` after a
    correction; `tests/test_category_status_endpoints.py`'s
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
    `"warnings"`, `"category_id"`, `"category_name"` and `"status"`.
    `extract_receipt`'s response includes `category_id`/`category_name`/
    `status` the same way it does `apartment_id`/`apartment_name` — read
    from the `get_receipt()` re-fetch right after saving, falling back to
    `None`/`ReceiptStatus.NEEDS_REVIEW` if that re-fetch somehow returns
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
