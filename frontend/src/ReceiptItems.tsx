import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError } from './api/ApiError'
import { getReceiptFacets } from './api/getReceiptFacets'
import { listItems } from './api/listItems'
import type { ApartmentFacet, ItemRow, ItemSort } from './api/types'
import { apartmentShortName } from './format/apartmentShortName'
import { formatDisplayDate } from './format/formatDisplayDate'
import ReceiptFilters, { effectiveStatus, effectiveYear } from './ReceiptFilters'
import { ApartmentPill } from './components/ui/ApartmentTone'
import Button from './components/ui/Button'
import Card from './components/ui/Card'
import ClampedText from './components/ui/ClampedText'
import MissingValue from './components/ui/MissingValue'
import PageHeader from './components/ui/PageHeader'
import Skeleton from './components/ui/Skeleton'
import Pagination from './components/ui/Pagination'
import Select from './components/ui/Select'
import StatusBadge from './components/ui/StatusBadge'
import { formatMoney } from './components/ui/formatMoney'
import { useMediaQuery } from './hooks/useMediaQuery'
import { navigateTo, isPlainLeftClick } from './navigation'
import { parsePage } from './pageParam'

/** Items per page (`&page=N` in the URL, omitted for page 1). */
export const PAGE_SIZE = 20
const MAX_SEARCH_LENGTH = 100
const LOADING_ROW_COUNT = 4

const NETWORK_ERROR_MESSAGE = 'Could not reach the server. Please try again.'
const LIST_FAILED_MESSAGE = 'Could not load items. Please try again.'
export const UNRECOGNIZED_DATE_TITLE =
  'This date could not be read as a valid date. Open the receipt and fix it with Edit.'

const FOCUS_TAB_INDEX_SESSION_KEY = 'receiptItemsFocusTabIndex'
/** One-shot flag set by a pagination click, read once after the next mount
 * (a page change is a full remount): scroll to the table and focus the
 * summary. Never set by the browser's own Back/Forward. */
const FOCUS_PAGE_SUMMARY_SESSION_KEY = 'receiptItemsFocusPageSummary'

const ITEMS_DESCRIPTION = 'Search every purchased item across all your receipts.'

const DEFAULT_ITEM_SORT: ItemSort = 'date_desc'
const SORT_OPTIONS: { value: ItemSort; label: string }[] = [
  { value: 'date_desc', label: 'Date (newest first)' },
  { value: 'date_asc', label: 'Date (oldest first)' },
  { value: 'amount_desc', label: 'Amount (high to low)' },
  { value: 'amount_asc', label: 'Amount (low to high)' },
  { value: 'store', label: 'Store (A-Z)' },
]
const ALLOWED_ITEM_SORT_VALUES = SORT_OPTIONS.map((option) => option.value)

export function DateCell({ value }: { value: string | null }) {
  const display = formatDisplayDate(value)
  if (display.kind === 'missing') {
    return <MissingValue />
  }
  if (display.kind === 'raw') {
    return (
      <span className="inline-flex items-center gap-1" title={UNRECOGNIZED_DATE_TITLE}>
        <WarningIcon />
        {display.text}
        <span className="sr-only">Date not recognized</span>
      </span>
    )
  }
  return <>{display.text}</>
}

function WarningIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5 flex-shrink-0 text-warning" fill="none">
      <path
        d="M10 3.5l8 13.5H2l8-13.5z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M10 8.5v3.5M10 11.75h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

/** The apartment as a soft pill in its own tone (src/format/apartmentTone.ts):
 * short name visible, full name in `title`. `apartmentId` picks the tone;
 * without it the pill is neutral. */
export function ApartmentCell({ name, apartmentId }: { name: string | null; apartmentId?: string | null }) {
  if (!name) {
    return <MissingValue />
  }
  const short = apartmentShortName(name)
  return (
    <ApartmentPill apartmentId={apartmentId} title={name}>
      <span className="truncate">{short}</span>
    </ApartmentPill>
  )
}

export function QuantityCell({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return <MissingValue />
  }
  return <>{value}</>
}

export function MoneyCell({ value, currency }: { value: number | null; currency: string | null }) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return <MissingValue />
  }
  return <>{formatMoney(value, currency)}</>
}

export function StoreCell({ value }: { value: string | null }) {
  if (!value) {
    return <MissingValue />
  }
  return <ClampedText text={value} lines={1} />
}

export function StatusCell({ status }: { status: string | null | undefined }) {
  if (status !== 'needs_review' && status !== 'approved') {
    return <MissingValue />
  }
  return <StatusBadge status={status} />
}

interface ItemsUrlParams {
  apartment: string | null
  year: string | null
  status: string | null
  q: string | null
  sort: string | null
  page: string | null
}

function readUrlParams(): ItemsUrlParams {
  const params = new URLSearchParams(window.location.search)
  return {
    apartment: params.get('apartment'),
    year: params.get('year'),
    status: params.get('status'),
    q: params.get('q'),
    sort: params.get('sort'),
    page: params.get('page'),
  }
}

function buildItemsSearch(params: ItemsUrlParams): string {
  const usp = new URLSearchParams()
  usp.set('view', 'items')
  if (params.apartment) usp.set('apartment', params.apartment)
  if (params.year) usp.set('year', params.year)
  if (params.status) usp.set('status', params.status)
  if (params.q) usp.set('q', params.q)
  // The default sort is omitted from the URL, same spirit as every other
  // "unset" filter here.
  if (params.sort && params.sort !== DEFAULT_ITEM_SORT) usp.set('sort', params.sort)
  // Page 1 is never written; any other valid page is.
  const page = parsePage(params.page)
  if (page > 1) usp.set('page', String(page))
  return `?${usp.toString()}`
}

/** A q longer than the backend's own limit is dropped entirely, same spirit
 * as an invalid year/status -- "ignored", never sent, never a crash. */
function effectiveQuery(rawQuery: string | null): string | null {
  if (rawQuery === null) return null
  const trimmed = rawQuery.trim()
  if (trimmed === '' || trimmed.length > MAX_SEARCH_LENGTH) return null
  return trimmed
}

/** An unrecognized sort value is ignored (falls back to the default), never
 * sent to the server and never a crash -- same spirit as an invalid
 * year/status. */
function effectiveSort(rawSort: string | null): ItemSort {
  if (rawSort !== null && (ALLOWED_ITEM_SORT_VALUES as string[]).includes(rawSort)) {
    return rawSort as ItemSort
  }
  return DEFAULT_ITEM_SORT
}

/** The item name as the row's one real link. Plain text (no underline);
 * its `::after` is stretched over the whole row/card (which is
 * `relative`), so clicking anywhere on the row follows it, and the row's
 * focus ring is drawn on that same `::after`. A plain click navigates in
 * place via `onOpen`; ctrl/cmd/shift/alt-click or a non-primary button is
 * left to the browser, so "open in new tab" works with the real `href`. */
function ItemRowLink({
  row,
  href,
  onOpen,
}: {
  row: ItemRow
  href: string
  onOpen: (receiptId: string) => void
}) {
  return (
    <a
      href={href}
      onClick={(e) => {
        if (!isPlainLeftClick(e)) {
          return
        }
        e.preventDefault()
        onOpen(row.receipt_id)
      }}
      className={ITEM_ROW_LINK_CLASSES}
    >
      {row.name ? <ClampedText text={row.name} lines={2} /> : <MissingValue />}
    </a>
  )
}

const ITEM_ROW_LINK_CLASSES =
  'block font-medium text-ink focus-visible:outline-none ' +
  "after:absolute after:inset-0 after:content-[''] " +
  'focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 ' +
  'focus-visible:after:outline-brand'

export interface ItemListProps {
  items: ItemRow[]
  showApartment: boolean
  /** The receipt link for a row (with `&from=` when a tab/filter is active). */
  hrefFor: (receiptId: string) => string
  onOpen: (receiptId: string) => void
}

/** Rows of one receipt share a light divider; the first row of the next
 * receipt (in whatever order the list is sorted) gets a slightly stronger
 * one, so a receipt's lines read as a group. Decorative only. */
function rowDividerClass(items: ItemRow[], index: number): string {
  if (index === 0) {
    return ''
  }
  return items[index - 1].receipt_id !== items[index].receipt_id
    ? 'border-t border-border/40'
    : 'border-t border-border-subtle'
}

export const ITEMS_SEARCH_PLACEHOLDER = 'e.g. Kaffee, Rossmann'

/** Complete static class strings for the search group (never built from
 * a variable). The group owns the one border, radius and focus ring; the
 * input has none of its own. `has-[input:focus-visible]` rings the whole
 * bar only while the *input* is focused -- not when the "×" or the Search
 * button is (each of those draws its own inset ring), so there's never a
 * double ring. The `*_RING` strings are the same rings drawn statically,
 * for the style guide's "focused" samples only. */
const SEARCH_GROUP_CLASSES =
  'flex h-11 rounded-control border border-border bg-surface ' +
  'has-[input:focus-visible]:outline has-[input:focus-visible]:outline-2 ' +
  'has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-brand'
const SEARCH_GROUP_RING = 'outline outline-2 outline-offset-2 outline-brand'
/** Primary (brand fill, white text), joined to the input: `-my-px -mr-px`
 * lays it over the group's own top/right/bottom border so it is exactly
 * the group's 44px height and only its outer corners are rounded. Its
 * focus ring is inset and white (6.29:1 on brand), since a brand ring on
 * a brand fill wouldn't show. */
const SEARCH_BUTTON_CLASSES =
  '-my-px -mr-px inline-flex h-11 flex-shrink-0 items-center gap-1.5 rounded-r-control bg-brand px-4 ' +
  'text-sm font-medium text-white transition-colors duration-150 hover:bg-brand-hover ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-white ' +
  'motion-reduce:transition-none'
const SEARCH_BUTTON_RING = 'outline outline-2 outline-offset-[-4px] outline-white'

function MagnifierIcon({ className }: { className: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className={className} fill="none">
      <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12.5 12.5L17 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

/** The Items search bar: one control group -- the visible label, then one
 * bordered, `rounded-control` bar holding the input (a decorative
 * magnifier inside on the left, a "×" with aria-label "Clear search"
 * inside on the right while there is text) and the primary "Search"
 * submit button (magnifier + text) joined to its right edge. 44px tall,
 * the same as the Selects in the row below. Tab order: input -> × ->
 * Search. `autoComplete="off"`: no browser history popup over the bar.
 *
 * The input is transparent and not positioned, so the icon behind its
 * text area always shows (BW's bug was an opaque, `relative` input
 * painting over it).
 * Exported so `?view=styleguide` renders the real thing; the caller wraps
 * it in the <form>. `sampleFocus` is for the style guide only: it draws
 * the input's or the button's focus ring statically. */
export function ItemsSearchField({
  id,
  value,
  onChange,
  onClear,
  sampleFocus,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  onClear: () => void
  sampleFocus?: 'input' | 'button'
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        Search items or stores
      </label>
      <div
        className={`${SEARCH_GROUP_CLASSES} ${sampleFocus === 'input' ? SEARCH_GROUP_RING : ''}`}
      >
        <div className="relative flex min-w-0 flex-1">
          <MagnifierIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <input
            id={id}
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            maxLength={MAX_SEARCH_LENGTH}
            placeholder={ITEMS_SEARCH_PLACEHOLDER}
            autoComplete="off"
            className="min-w-0 flex-1 rounded-l-control border-0 bg-transparent pl-9 pr-11 text-sm text-ink placeholder:text-ink-muted focus:outline-none"
          />
          {value && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={onClear}
              className="absolute -bottom-px -top-px right-0 inline-flex w-11 items-center justify-center rounded-md text-lg leading-none text-ink-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-brand"
            >
              <span aria-hidden="true">×</span>
            </button>
          )}
        </div>
        <button
          type="submit"
          className={`${SEARCH_BUTTON_CLASSES} ${sampleFocus === 'button' ? SEARCH_BUTTON_RING : ''}`}
        >
          <MagnifierIcon className="h-4 w-4" />
          Search
        </button>
      </div>
    </div>
  )
}

/** The Items table (from `sm` up), inside one Card with its column header
 * row -- the same card, header style and side padding as History's list.
 * Each row is one whole-row link (see
 * `ItemRowLink`); `relative` on the `<tr>` anchors the link's stretched
 * `::after`. Exported so `?view=styleguide` renders the real thing. */
export function ItemsTable({ items, showApartment, hrefFor, onOpen }: ItemListProps) {
  return (
    <Card className="overflow-hidden">
      <div className="-m-5 overflow-x-auto sm:-m-6">
        <table className="w-full table-fixed text-left text-sm">
          <caption className="sr-only">Purchased items</caption>
          <thead>
            <tr className="border-b border-border-subtle text-xs text-ink-muted">
              <th scope="col" className="w-28 whitespace-nowrap py-2 pl-4 pr-2 font-medium">
                Date
              </th>
              <th scope="col" className="py-2 pr-2 font-medium">
                Item
              </th>
              <th scope="col" className="w-16 py-2 pr-2 text-right font-medium">
                Qty
              </th>
              <th scope="col" className="w-24 whitespace-nowrap py-2 pr-2 text-right font-medium">
                Unit price
              </th>
              <th scope="col" className="w-24 whitespace-nowrap py-2 pr-2 text-right font-medium">
                Line total
              </th>
              <th scope="col" className="w-44 py-2 pl-4 pr-2 font-medium">
                Store
              </th>
              {showApartment && (
                <th scope="col" className="w-32 py-2 pr-2 font-medium">
                  Apartment
                </th>
              )}
              <th scope="col" className="w-32 py-2 pl-2 pr-4 text-right font-medium">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((row, index) => (
              <tr
                key={`${row.receipt_id}-${row.line_index}`}
                className={`relative hover:bg-slate-50 ${rowDividerClass(items, index)}`}
              >
                <td className="whitespace-nowrap py-2.5 pl-4 pr-2 align-top">
                  <DateCell value={row.purchase_date} />
                </td>
                <td className="py-2.5 pr-2 align-top">
                  <ItemRowLink row={row} href={hrefFor(row.receipt_id)} onOpen={onOpen} />
                </td>
                <td className="whitespace-nowrap py-2.5 pr-2 text-right align-top tabular-nums">
                  <QuantityCell value={row.quantity} />
                </td>
                <td className="whitespace-nowrap py-2.5 pr-2 text-right align-top tabular-nums">
                  <MoneyCell value={row.unit_price} currency={row.currency} />
                </td>
                <td className="whitespace-nowrap py-2.5 pr-2 text-right align-top tabular-nums">
                  <MoneyCell value={row.line_total} currency={row.currency} />
                </td>
                <td className="py-2.5 pl-4 pr-2 align-top">
                  <StoreCell value={row.store_name} />
                </td>
                {showApartment && (
                  <td className="py-2.5 pr-2 align-top">
                    <ApartmentCell name={row.apartment_name} apartmentId={row.apartment_id} />
                  </td>
                )}
                <td className="py-2.5 pl-2 pr-4 text-right align-top">
                  <StatusCell status={row.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

/** The Items list below `sm`: one row per item inside one Card, divided
 * like History's small rows; each row is one whole-row link (same
 * `ItemRowLink`). */
export function ItemCardList({ items, showApartment, hrefFor, onOpen }: ItemListProps) {
  return (
    <Card className="overflow-hidden">
      <ul className="-m-5 divide-y divide-border-subtle sm:-m-6">
        {items.map((row) => (
          <li
            key={`${row.receipt_id}-${row.line_index}`}
            className="relative px-4 py-3 hover:bg-slate-50"
          >
            <ItemRowLink row={row} href={hrefFor(row.receipt_id)} onOpen={onOpen} />
            <p className="mt-1 flex items-center gap-1 text-sm text-ink-muted">
              <DateCell value={row.purchase_date} /> <span aria-hidden="true">·</span>{' '}
              {row.store_name ? row.store_name : <MissingValue />}
            </p>
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span>
                Qty <span className="tabular-nums">
                  <QuantityCell value={row.quantity} />
                </span>
              </span>
              <span className="whitespace-nowrap">
                Unit price{' '}
                <span className="tabular-nums">
                  <MoneyCell value={row.unit_price} currency={row.currency} />
                </span>
              </span>
              <span className="whitespace-nowrap">
                Line total{' '}
                <span className="tabular-nums">
                  <MoneyCell value={row.line_total} currency={row.currency} />
                </span>
              </span>
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {showApartment && <ApartmentCell name={row.apartment_name} apartmentId={row.apartment_id} />}
              <StatusCell status={row.status} />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function ReceiptItems() {
  const [urlParams] = useState(readUrlParams)
  const [searchInput, setSearchInput] = useState(urlParams.q ?? '')

  const [apartments, setApartments] = useState<ApartmentFacet[] | null>(null)
  const [years, setYears] = useState<number[]>([])
  const [hasUndated, setHasUndated] = useState(false)
  const [effectiveApartmentId, setEffectiveApartmentId] = useState<string | null>(null)

  const [items, setItems] = useState<ItemRow[] | null>(null)
  const [currentPage, setCurrentPage] = useState(() => parsePage(urlParams.page))
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [reloadToken, setReloadToken] = useState(0)

  const requestIdRef = useRef(0)
  const listTopRef = useRef<HTMLDivElement>(null)
  const summaryRef = useRef<HTMLParagraphElement>(null)
  const isSmallScreen = useMediaQuery('(max-width: 639px)')

  const year = effectiveYear(urlParams.year)
  const status = effectiveStatus(urlParams.status)
  const q = effectiveQuery(urlParams.q)
  const sort = effectiveSort(urlParams.sort)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(null)

    async function load() {
      // A fresh requestId: a reply to an older request (e.g. one still in
      // flight when the user filters again) can never overwrite a newer
      // result.
      const requestId = ++requestIdRef.current

      try {
        // Unscoped first: always needed for the tab bar, and it also
        // validates the URL's `apartment` value against real ids.
        const tabFacets = await getReceiptFacets()
        if (cancelled || requestIdRef.current !== requestId) return

        const knownApartmentIds = new Set(tabFacets.apartments.map((a) => a.id))
        const apartmentId =
          urlParams.apartment && knownApartmentIds.has(urlParams.apartment) ? urlParams.apartment : null

        let scopedYears = tabFacets.years
        let scopedHasUndated = tabFacets.has_undated
        if (apartmentId) {
          try {
            const scoped = await getReceiptFacets(apartmentId)
            scopedYears = scoped.years
            scopedHasUndated = scoped.has_undated
          } catch {
            // Keep the unscoped values rather than fail the whole page over
            // a facet that's only used to populate the Year select.
          }
        }
        if (cancelled || requestIdRef.current !== requestId) return

        setApartments(tabFacets.apartments)
        setYears(scopedYears)
        setHasUndated(scopedHasUndated)
        setEffectiveApartmentId(apartmentId)

        const filters = {
          apartmentId: apartmentId ?? undefined,
          year: year ?? undefined,
          status: status ?? undefined,
          q: q ?? undefined,
          sort,
          limit: PAGE_SIZE,
        }
        const requestedPage = parsePage(urlParams.page)
        let page = requestedPage
        let response = await listItems({ ...filters, offset: (page - 1) * PAGE_SIZE })
        if (cancelled || requestIdRef.current !== requestId) return

        // A page past the end shows the last page instead, and the address
        // bar is corrected in place (no remount).
        const lastPage = Math.max(1, Math.ceil(response.total / PAGE_SIZE))
        if (page > lastPage) {
          page = lastPage
          response = await listItems({ ...filters, offset: (page - 1) * PAGE_SIZE })
          if (cancelled || requestIdRef.current !== requestId) return
        }
        if (page !== requestedPage || (urlParams.page !== null && String(page) !== urlParams.page)) {
          window.history.replaceState(window.history.state, '', buildItemsSearch({ ...urlParams, page: String(page) }))
        }

        setCurrentPage(page)
        setItems(response.items)
        setTotal(response.total)
      } catch (err) {
        if (cancelled || requestIdRef.current !== requestId) return
        setError(err instanceof ApiError ? LIST_FAILED_MESSAGE : NETWORK_ERROR_MESSAGE)
      } finally {
        if (!cancelled && requestIdRef.current === requestId) setIsLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
    // urlParams/year/status/q are captured once per mount (the whole page
    // remounts on any navigation).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadToken])

  const retry = () => setReloadToken((n) => n + 1)

  // After a pagination click (only then -- see FOCUS_PAGE_SUMMARY_SESSION_KEY),
  // once the new page has loaded: bring the table into view and move focus
  // to the "Showing a–b of N" summary.
  useEffect(() => {
    if (isLoading || items === null) return
    let flagged = false
    try {
      flagged = window.sessionStorage.getItem(FOCUS_PAGE_SUMMARY_SESSION_KEY) !== null
      window.sessionStorage.removeItem(FOCUS_PAGE_SUMMARY_SESSION_KEY)
    } catch {
      flagged = false
    }
    if (!flagged) return
    listTopRef.current?.scrollIntoView?.({ block: 'start' })
    summaryRef.current?.focus({ preventScroll: true })
  }, [isLoading, items])

  // Only carry a `from` param when a tab, filter or a page past the first
  // is active -- the plain, unfiltered first page needs no round trip,
  // matching ReceiptHistory's own receiptHref. With the page in `from`,
  // "Back to items" returns to the same page. The same href is the link's real
  // `href` (so a new tab keeps the way back) and what a plain click opens.
  const receiptHref = (receiptId: string): string => {
    const hasActiveFilterOrTab = effectiveApartmentId !== null || anyFilterActive || currentPage > 1
    const from = hasActiveFilterOrTab ? `&from=${encodeURIComponent(window.location.search)}` : ''
    return `/?receipt=${receiptId}${from}`
  }

  const openItem = (receiptId: string) => {
    navigateTo(receiptHref(receiptId).slice(1))
  }

  const goToUpload = (e: React.MouseEvent) => {
    if (!isPlainLeftClick(e)) {
      return
    }
    e.preventDefault()
    navigateTo('')
  }

  const goToTab = (apartmentId: string | null) => {
    navigateTo(buildItemsSearch({ ...urlParams, apartment: apartmentId, page: null }))
  }

  const handleYearChange = (value: string) => {
    navigateTo(buildItemsSearch({ ...urlParams, year: value || null, page: null }))
  }

  const handleStatusChange = (value: string) => {
    navigateTo(buildItemsSearch({ ...urlParams, status: value || null, page: null }))
  }

  const handleSortChange = (value: string) => {
    navigateTo(buildItemsSearch({ ...urlParams, sort: value || null, page: null }))
  }

  const handleSearchSubmit = (e?: FormEvent) => {
    e?.preventDefault()
    const trimmed = searchInput.trim()
    navigateTo(buildItemsSearch({ ...urlParams, q: trimmed || null, page: null }))
  }

  const handleClearSearch = () => {
    setSearchInput('')
    navigateTo(buildItemsSearch({ ...urlParams, q: null, page: null }))
  }

  const pageHref = (page: number): string => `/${buildItemsSearch({ ...urlParams, page: String(page) })}`

  const goToPage = (page: number) => {
    try {
      window.sessionStorage.setItem(FOCUS_PAGE_SUMMARY_SESSION_KEY, '1')
    } catch {
      // Storage unavailable: the page still changes, just without the focus move.
    }
    navigateTo(buildItemsSearch({ ...urlParams, page: String(page) }))
  }

  const handleClearFilters = () => {
    navigateTo(
      buildItemsSearch({
        apartment: urlParams.apartment,
        year: null,
        status: null,
        q: null,
        sort: urlParams.sort,
        page: null,
      }),
    )
  }

  const tabs: { id: string | null; label: string; accessibleName?: string }[] = [
    { id: null, label: 'All apartments' },
    // Short name visible (with the tone dot ReceiptFilters adds), full name
    // as the tab's accessible name and tooltip -- like History's tabs, but
    // without counts (facets count receipts, not items).
    ...(apartments ?? []).map((a) => ({
      id: a.id,
      label: apartmentShortName(a.name) ?? a.name,
      accessibleName: a.name,
    })),
  ]

  const anyFilterActive = year !== null || status !== null || q !== null
  const isUnfiltered = effectiveApartmentId === null && !anyFilterActive
  const showApartmentColumn = effectiveApartmentId === null

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const firstShown = total === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1
  const lastShown = Math.min(currentPage * PAGE_SIZE, total)

  // The count line above the table: "268 items", or with a search
  // '12 items for "milch"' -- `total` is every matching row, not the page.
  const countText = `${total} ${total === 1 ? 'item' : 'items'}${q ? ` for "${q}"` : ''}`

  if (isLoading) {
    return (
      <div className="flex w-full flex-col gap-4">
        <PageHeader title="Items" description={ITEMS_DESCRIPTION} />
        <div
          role="status"
          aria-busy="true"
          className="flex flex-col gap-3 rounded-card border border-border-subtle bg-surface p-6 shadow-card"
        >
          <span className="sr-only">Loading items...</span>
          {Array.from({ length: LOADING_ROW_COUNT }).map((_, index) => (
            <Skeleton key={index} className="h-12 w-full" />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex w-full flex-col gap-4">
        <PageHeader title="Items" description={ITEMS_DESCRIPTION} />
        <div className="flex flex-col gap-4 rounded-card border border-border-subtle bg-surface p-6 shadow-card">
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
          <Button variant="secondary" size="sm" className="self-start" onClick={retry}>
            Retry
          </Button>
        </div>
      </div>
    )
  }

  // Row 1: the search form, full width (see ItemsSearchField).
  const searchBox = (
    <form onSubmit={handleSearchSubmit}>
      <ItemsSearchField
        id="items-search-input"
        value={searchInput}
        onChange={setSearchInput}
        onClear={handleClearSearch}
      />
    </form>
  )

  // Row 2's third column (Year and Status come from ReceiptFilters).
  const sortSelect = (
    <Select id="items-sort-select" label="Sort by" value={sort} onChange={handleSortChange} options={SORT_OPTIONS} />
  )

  return (
    <div className="flex w-full flex-col gap-4">
      <PageHeader title="Items" description={ITEMS_DESCRIPTION} />
      <ReceiptFilters
        tabs={tabs}
        selectedApartmentId={effectiveApartmentId}
        onSelectApartment={goToTab}
        focusSessionKey={FOCUS_TAB_INDEX_SESSION_KEY}
        years={years}
        hasUndated={hasUndated}
        yearValue={year}
        onYearChange={handleYearChange}
        yearSelectId="items-year-select"
        statusValue={status}
        onStatusChange={handleStatusChange}
        statusSelectId="items-status-select"
        topRow={searchBox}
        extraFilter={sortSelect}
      />

      {items && items.length === 0 ? (
        isUnfiltered ? (
          <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-6">
            <p className="text-sm text-ink-muted">No items yet. Upload a receipt.</p>
            <a
              href="/"
              onClick={goToUpload}
              className="text-sm font-medium text-brand underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              Upload a receipt
            </a>
          </div>
        ) : (
          <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-6">
            <p className="text-sm text-ink-muted">No items match these filters.</p>
            <Button variant="secondary" size="sm" className="self-start" onClick={handleClearFilters}>
              Clear filters
            </Button>
          </div>
        )
      ) : (
        <>
          {/* One line above the table: the count (with the search, if
              any) on the left, "Clear filters" on the right while any
              filter or search is active -- the same line as History's. */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p role="status" className="text-sm text-ink-muted">
              {countText}
            </p>
            {anyFilterActive && (
              <Button variant="secondary" size="sm" onClick={handleClearFilters}>
                Clear filters
              </Button>
            )}
          </div>

          <div ref={listTopRef} />
          {isSmallScreen ? (
            <ItemCardList
              items={items ?? []}
              showApartment={showApartmentColumn}
              hrefFor={receiptHref}
              onOpen={openItem}
            />
          ) : (
            <ItemsTable
              items={items ?? []}
              showApartment={showApartmentColumn}
              hrefFor={receiptHref}
              onOpen={openItem}
            />
          )}

          {totalPages > 1 && (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p
                ref={summaryRef}
                role="status"
                tabIndex={-1}
                className="text-sm text-ink-muted focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-brand"
              >
                Showing {firstShown}–{lastShown} of {total}
              </p>
              <Pagination currentPage={currentPage} totalPages={totalPages} hrefForPage={pageHref} onPageChange={goToPage} />
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default ReceiptItems
