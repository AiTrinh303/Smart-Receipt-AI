import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError } from './api/ApiError'
import { getReceiptFacets } from './api/getReceiptFacets'
import { listItems } from './api/listItems'
import type { ApartmentFacet, ItemRow, ItemSort } from './api/types'
import { apartmentShortName } from './format/apartmentShortName'
import { formatDisplayDate } from './format/formatDisplayDate'
import ReceiptFilters, {
  NONE_FILTER_VALUE,
  STATUS_OPTIONS,
  effectiveStatus,
  effectiveYear,
} from './ReceiptFilters'
import { ApartmentPill } from './components/ui/ApartmentTone'
import Alert from './components/ui/Alert'
import Button from './components/ui/Button'
import ClampedText from './components/ui/ClampedText'
import MissingValue from './components/ui/MissingValue'
import PageHeader from './components/ui/PageHeader'
import Skeleton from './components/ui/Skeleton'
import Select from './components/ui/Select'
import StatusBadge from './components/ui/StatusBadge'
import { formatMoney } from './components/ui/formatMoney'
import { useMediaQuery } from './hooks/useMediaQuery'
import { navigateTo, isPlainLeftClick } from './navigation'

const PAGE_SIZE = 50
const MAX_SEARCH_LENGTH = 100
const LOADING_ROW_COUNT = 4

const NETWORK_ERROR_MESSAGE = 'Could not reach the server. Please try again.'
const LIST_FAILED_MESSAGE = 'Could not load items. Please try again.'
export const UNRECOGNIZED_DATE_TITLE =
  'This date could not be read as a valid date. Open the receipt and fix it with Edit.'

const FOCUS_TAB_INDEX_SESSION_KEY = 'receiptItemsFocusTabIndex'

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
}

function readUrlParams(): ItemsUrlParams {
  const params = new URLSearchParams(window.location.search)
  return {
    apartment: params.get('apartment'),
    year: params.get('year'),
    status: params.get('status'),
    q: params.get('q'),
    sort: params.get('sort'),
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

/** The Items table (from `sm` up). Each row is one whole-row link (see
 * `ItemRowLink`); `relative` on the `<tr>` anchors the link's stretched
 * `::after`. Exported so `?view=styleguide` renders the real thing. */
export function ItemsTable({ items, showApartment, hrefFor, onOpen }: ItemListProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed text-left text-sm">
        <caption className="sr-only">Purchased items</caption>
        <thead>
          <tr className="border-b border-border text-ink-muted">
            <th scope="col" className="w-24 whitespace-nowrap py-2 pl-2 pr-2 font-medium">
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
            <th scope="col" className="w-32 py-2 pr-2 text-right font-medium">
              Status
            </th>
          </tr>
        </thead>
        <tbody className="border-b border-border-subtle">
          {items.map((row, index) => (
            <tr
              key={`${row.receipt_id}-${row.line_index}`}
              className={`relative hover:bg-slate-50 ${rowDividerClass(items, index)}`}
            >
              <td className="whitespace-nowrap py-2 pl-2 pr-2 align-top">
                <DateCell value={row.purchase_date} />
              </td>
              <td className="py-2 pr-2 align-top">
                <ItemRowLink row={row} href={hrefFor(row.receipt_id)} onOpen={onOpen} />
              </td>
              <td className="whitespace-nowrap py-2 pr-2 text-right align-top tabular-nums">
                <QuantityCell value={row.quantity} />
              </td>
              <td className="whitespace-nowrap py-2 pr-2 text-right align-top tabular-nums">
                <MoneyCell value={row.unit_price} currency={row.currency} />
              </td>
              <td className="whitespace-nowrap py-2 pr-2 text-right align-top tabular-nums">
                <MoneyCell value={row.line_total} currency={row.currency} />
              </td>
              <td className="py-2 pl-4 pr-2 align-top">
                <StoreCell value={row.store_name} />
              </td>
              {showApartment && (
                <td className="py-2 pr-2 align-top">
                  <ApartmentCell name={row.apartment_name} apartmentId={row.apartment_id} />
                </td>
              )}
              <td className="py-2 pr-2 text-right align-top">
                <StatusCell status={row.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** The Items list below `sm`: one card per row, each card one whole-card
 * link (same `ItemRowLink`). */
export function ItemCardList({ items, showApartment, hrefFor, onOpen }: ItemListProps) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((row) => (
        <li
          key={`${row.receipt_id}-${row.line_index}`}
          className="relative rounded-md border border-border p-3 hover:bg-slate-50"
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
  const [count, setCount] = useState(0)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const requestIdRef = useRef(0)
  const isSmallScreen = useMediaQuery('(max-width: 639px)')

  const year = effectiveYear(urlParams.year)
  const status = effectiveStatus(urlParams.status)
  const q = effectiveQuery(urlParams.q)
  const sort = effectiveSort(urlParams.sort)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(null)
    setLoadMoreError(null)

    async function load() {
      // A fresh requestId, shared with handleShowMore below: whichever
      // request finishes last wins the id comparison, so a reply to an
      // older request (e.g. one still in flight when the user filters
      // again) can never overwrite a newer result.
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

        const response = await listItems({
          apartmentId: apartmentId ?? undefined,
          year: year ?? undefined,
          status: status ?? undefined,
          q: q ?? undefined,
          sort,
          limit: PAGE_SIZE,
          offset: 0,
        })
        if (cancelled || requestIdRef.current !== requestId) return
        setItems(response.items)
        setCount(response.count)
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

  const handleShowMore = async () => {
    const requestId = ++requestIdRef.current
    setIsLoadingMore(true)
    setLoadMoreError(null)

    try {
      const response = await listItems({
        apartmentId: effectiveApartmentId ?? undefined,
        year: year ?? undefined,
        status: status ?? undefined,
        q: q ?? undefined,
        sort,
        limit: PAGE_SIZE,
        offset: count,
      })
      if (requestIdRef.current !== requestId) return
      setItems((prev) => [...(prev ?? []), ...response.items])
      setCount((prev) => prev + response.count)
      setTotal(response.total)
    } catch (err) {
      if (requestIdRef.current !== requestId) return
      setLoadMoreError(err instanceof ApiError ? LIST_FAILED_MESSAGE : NETWORK_ERROR_MESSAGE)
    } finally {
      if (requestIdRef.current === requestId) setIsLoadingMore(false)
    }
  }

  // Only carry a `from` param when a tab or filter is actually active --
  // the plain, unfiltered items view needs no round trip, matching
  // ReceiptHistory's own receiptHref. The same href is the link's real
  // `href` (so a new tab keeps the way back) and what a plain click opens.
  const receiptHref = (receiptId: string): string => {
    const hasActiveFilterOrTab = effectiveApartmentId !== null || anyFilterActive
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
    navigateTo(buildItemsSearch({ ...urlParams, apartment: apartmentId }))
  }

  const handleYearChange = (value: string) => {
    navigateTo(buildItemsSearch({ ...urlParams, year: value || null }))
  }

  const handleStatusChange = (value: string) => {
    navigateTo(buildItemsSearch({ ...urlParams, status: value || null }))
  }

  const handleSortChange = (value: string) => {
    navigateTo(buildItemsSearch({ ...urlParams, sort: value || null }))
  }

  const handleSearchSubmit = (e?: FormEvent) => {
    e?.preventDefault()
    const trimmed = searchInput.trim()
    navigateTo(buildItemsSearch({ ...urlParams, q: trimmed || null }))
  }

  const handleClearSearch = () => {
    setSearchInput('')
    navigateTo(buildItemsSearch({ ...urlParams, q: null }))
  }

  const handleClearFilters = () => {
    navigateTo(
      buildItemsSearch({ apartment: urlParams.apartment, year: null, status: null, q: null, sort: urlParams.sort }),
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

  // "Waldglück · 2026 · Approved · "milch"" -- only the parts that are
  // actually active, in a fixed order, for the summary bar above the table.
  const selectedApartment = apartments?.find((a) => a.id === effectiveApartmentId) ?? null
  const filterSummaryParts = [
    selectedApartment ? apartmentShortName(selectedApartment.name) : null,
    year ? (year === NONE_FILTER_VALUE ? 'No valid date' : year) : null,
    status ? (STATUS_OPTIONS.find((option) => option.value === status)?.label ?? null) : null,
    q ? `"${q}"` : null,
  ].filter((part): part is string => part !== null)
  const filterSummaryText = filterSummaryParts.length > 0 ? filterSummaryParts.join(' · ') : null

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

  const searchBox = (
    <form onSubmit={handleSearchSubmit} className="flex flex-col gap-1">
      <label htmlFor="items-search-input" className="text-sm font-medium text-ink">
        Search items or stores
      </label>
      <div className="flex gap-2">
        <input
          id="items-search-input"
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          maxLength={MAX_SEARCH_LENGTH}
          className="h-11 min-h-[44px] flex-1 rounded-md border border-border bg-surface px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        />
        {searchInput && (
          <Button type="button" variant="ghost" size="sm" onClick={handleClearSearch}>
            Clear
          </Button>
        )}
        <Button type="submit" size="sm">
          Search
        </Button>
      </div>
    </form>
  )

  const sortSelect = (
    <div className="md:w-48">
      <Select
        id="items-sort-select"
        label="Sort by"
        value={sort}
        onChange={handleSortChange}
        options={SORT_OPTIONS}
      />
    </div>
  )

  const extraFilter = (
    <div className="flex flex-col gap-3 md:flex-row md:items-end">
      <div className="flex-1">{searchBox}</div>
      {sortSelect}
    </div>
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
        extraFilter={extraFilter}
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p role="status" className="text-sm text-ink-muted">
              {count} of {total} items
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {filterSummaryText && <p className="text-sm text-ink-muted">{filterSummaryText}</p>}
              {anyFilterActive && (
                <Button variant="secondary" size="sm" onClick={handleClearFilters}>
                  Clear filters
                </Button>
              )}
            </div>
          </div>

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

          <div className="flex flex-col gap-2">
            {loadMoreError && (
              <>
                <Alert variant="error">{loadMoreError}</Alert>
                <Button variant="secondary" size="sm" className="self-start" onClick={handleShowMore}>
                  Retry
                </Button>
              </>
            )}
            {!loadMoreError && count < total && (
              <Button
                variant="secondary"
                size="sm"
                className="self-start"
                onClick={handleShowMore}
                disabled={isLoadingMore}
                loading={isLoadingMore}
                loadingText="Loading..."
              >
                Show more
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default ReceiptItems
