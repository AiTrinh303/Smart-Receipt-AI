import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError } from './api/ApiError'
import { getReceiptFacets } from './api/getReceiptFacets'
import { listItems } from './api/listItems'
import type { ApartmentFacet, ItemRow } from './api/types'
import ReceiptFilters, { effectiveStatus, effectiveYear } from './ReceiptFilters'
import Alert from './components/ui/Alert'
import Button from './components/ui/Button'
import Skeleton from './components/ui/Skeleton'
import { formatMoney } from './components/ui/formatMoney'
import { useMediaQuery } from './hooks/useMediaQuery'
import { navigateTo } from './navigation'

const PAGE_SIZE = 50
const MAX_SEARCH_LENGTH = 100
const LOADING_ROW_COUNT = 4

const NOT_DETECTED = 'Not detected'

const NETWORK_ERROR_MESSAGE = 'Could not reach the server. Please try again.'
const LIST_FAILED_MESSAGE = 'Could not load items. Please try again.'

const FOCUS_TAB_INDEX_SESSION_KEY = 'receiptItemsFocusTabIndex'

function displayText(value: string | null | undefined): string {
  return value === null || value === undefined || value === '' ? NOT_DETECTED : value
}

function displayQuantity(value: number | null | undefined): string {
  return value === null || value === undefined || Number.isNaN(value) ? NOT_DETECTED : String(value)
}

interface ItemsUrlParams {
  apartment: string | null
  year: string | null
  status: string | null
  q: string | null
}

function readUrlParams(): ItemsUrlParams {
  const params = new URLSearchParams(window.location.search)
  return {
    apartment: params.get('apartment'),
    year: params.get('year'),
    status: params.get('status'),
    q: params.get('q'),
  }
}

function buildItemsSearch(params: ItemsUrlParams): string {
  const usp = new URLSearchParams()
  usp.set('view', 'items')
  if (params.apartment) usp.set('apartment', params.apartment)
  if (params.year) usp.set('year', params.year)
  if (params.status) usp.set('status', params.status)
  if (params.q) usp.set('q', params.q)
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

interface ItemRowLinkProps {
  row: ItemRow
  onOpen: (receiptId: string) => void
}

function ItemNameLink({ row, onOpen }: ItemRowLinkProps) {
  return (
    <a
      href={`/?receipt=${row.receipt_id}`}
      onClick={(e) => {
        e.preventDefault()
        onOpen(row.receipt_id)
      }}
      className="font-medium text-brand underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      {displayText(row.name)}
    </a>
  )
}

interface ItemCardProps {
  row: ItemRow
  showApartment: boolean
  onOpen: (receiptId: string) => void
}

function ItemCard({ row, showApartment, onOpen }: ItemCardProps) {
  return (
    <li className="rounded-md border border-border p-3">
      <ItemNameLink row={row} onOpen={onOpen} />
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="text-ink-muted">Date</dt>
        <dd className="text-right">{displayText(row.purchase_date)}</dd>
        <dt className="text-ink-muted">Qty</dt>
        <dd className="text-right tabular-nums">{displayQuantity(row.quantity)}</dd>
        <dt className="text-ink-muted">Unit price</dt>
        <dd className="whitespace-nowrap text-right tabular-nums">{formatMoney(row.unit_price, row.currency)}</dd>
        <dt className="text-ink-muted">Line total</dt>
        <dd className="whitespace-nowrap text-right tabular-nums">{formatMoney(row.line_total, row.currency)}</dd>
        <dt className="text-ink-muted">Store</dt>
        <dd className="text-right">{displayText(row.store_name)}</dd>
        {showApartment && (
          <>
            <dt className="text-ink-muted">Apartment</dt>
            <dd className="text-right">{displayText(row.apartment_name)}</dd>
          </>
        )}
      </dl>
    </li>
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

  const openItem = (receiptId: string) => {
    // Only carry a `from` param when a tab or filter is actually active --
    // the plain, unfiltered items view needs no round trip, matching
    // ReceiptHistory's own openReceipt.
    const hasActiveFilterOrTab = effectiveApartmentId !== null || anyFilterActive
    const from = hasActiveFilterOrTab ? `&from=${encodeURIComponent(window.location.search)}` : ''
    navigateTo(`?receipt=${receiptId}${from}`)
  }

  const goToUpload = (e: React.MouseEvent) => {
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
    navigateTo(buildItemsSearch({ apartment: urlParams.apartment, year: null, status: null, q: null }))
  }

  const tabs: { id: string | null; label: string }[] = [
    { id: null, label: 'All apartments' },
    ...(apartments ?? []).map((a) => ({ id: a.id, label: a.name })),
  ]

  const anyFilterActive = year !== null || status !== null || q !== null
  const isUnfiltered = effectiveApartmentId === null && !anyFilterActive
  const showApartmentColumn = effectiveApartmentId === null

  if (isLoading) {
    return (
      <div className="mx-auto flex max-w-4xl flex-col gap-4">
        <div
          role="status"
          aria-busy="true"
          className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-6"
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
      <div className="mx-auto flex max-w-4xl flex-col gap-4 rounded-lg border border-border bg-surface p-6">
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
        <Button variant="secondary" size="sm" className="self-start" onClick={retry}>
          Retry
        </Button>
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
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
      />

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
          {isSmallScreen ? (
            <ul className="flex flex-col gap-2">
              {items?.map((row) => (
                <ItemCard
                  key={`${row.receipt_id}-${row.line_index}`}
                  row={row}
                  showApartment={showApartmentColumn}
                  onOpen={openItem}
                />
              ))}
            </ul>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Purchased items</caption>
                <thead>
                  <tr className="border-b border-border text-ink-muted">
                    <th scope="col" className="whitespace-nowrap py-1 pr-2 font-medium">
                      Date
                    </th>
                    <th scope="col" className="py-1 pr-2 font-medium">
                      Item
                    </th>
                    <th scope="col" className="py-1 pr-2 text-right font-medium">
                      Qty
                    </th>
                    <th scope="col" className="whitespace-nowrap py-1 pr-2 text-right font-medium">
                      Unit price
                    </th>
                    <th scope="col" className="whitespace-nowrap py-1 pr-2 text-right font-medium">
                      Line total
                    </th>
                    <th scope="col" className="py-1 pr-2 font-medium">
                      Store
                    </th>
                    {showApartmentColumn && (
                      <th scope="col" className="py-1 font-medium">
                        Apartment
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {items?.map((row) => (
                    <tr key={`${row.receipt_id}-${row.line_index}`} className="border-b border-border/40">
                      <td className="whitespace-nowrap py-1 pr-2">{displayText(row.purchase_date)}</td>
                      <td className="py-1 pr-2">
                        <ItemNameLink row={row} onOpen={openItem} />
                      </td>
                      <td className="whitespace-nowrap py-1 pr-2 text-right tabular-nums">
                        {displayQuantity(row.quantity)}
                      </td>
                      <td className="whitespace-nowrap py-1 pr-2 text-right tabular-nums">
                        {formatMoney(row.unit_price, row.currency)}
                      </td>
                      <td className="whitespace-nowrap py-1 pr-2 text-right tabular-nums">
                        {formatMoney(row.line_total, row.currency)}
                      </td>
                      <td className="py-1 pr-2">{displayText(row.store_name)}</td>
                      {showApartmentColumn && <td className="py-1">{displayText(row.apartment_name)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <p role="status" className="text-sm text-ink-muted">
              {count} of {total} items
            </p>
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
