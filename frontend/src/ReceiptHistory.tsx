import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ApiError } from './api/ApiError'
import { getReceiptFacets } from './api/getReceiptFacets'
import { listReceipts } from './api/listReceipts'
import type { ApartmentFacet, ReceiptSummary } from './api/types'
import { apartmentShortName } from './format/apartmentShortName'
import { DateCell } from './ReceiptItems'
import ReceiptFilters, { effectiveStatus, effectiveYear } from './ReceiptFilters'
import Alert from './components/ui/Alert'
import Button from './components/ui/Button'
import Card from './components/ui/Card'
import ClampedText from './components/ui/ClampedText'
import PageHeader from './components/ui/PageHeader'
import Skeleton from './components/ui/Skeleton'
import StatusBadge from './components/ui/StatusBadge'
import { formatMoney } from './components/ui/formatMoney'
import { useMediaQuery } from './hooks/useMediaQuery'
import { navigateTo } from './navigation'

const LOADING_ROW_COUNT = 4
const PAGE_SIZE = 50

const HISTORY_DESCRIPTION = 'Browse every saved receipt, filtered by apartment, year or status.'

const NOT_DETECTED = 'Not detected'
const NOT_ASSIGNED = 'Not assigned'

const FOCUS_TAB_INDEX_SESSION_KEY = 'receiptHistoryFocusTabIndex'

function ApartmentIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5 flex-shrink-0" fill="none">
      <path
        d="M4 17.5V5.5a1 1 0 011-1h4.5v13M11.5 17.5V9h3.5a1 1 0 011 1v7.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M6 7.5h1M6 10.5h1M6 13.5h1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

/** The apartment shows the short name visibly (same convenience as the
 * Items view's ApartmentCell and the upload form's apartment choice), but
 * keeps the full name available both as a `title` tooltip and as hidden
 * text for assistive tech that doesn't read `title` -- the visible short
 * name is purely decorative (`aria-hidden`) so the two are never both
 * announced. Muted icon + text rather than a filled pill, so a list of
 * rows doesn't turn into a column of colored blocks. */
function ApartmentBadge({ apartmentName }: { apartmentName: string | null | undefined }) {
  if (!apartmentName) {
    return <span className="text-xs text-ink-muted">{NOT_ASSIGNED}</span>
  }

  const short = apartmentShortName(apartmentName) ?? apartmentName

  return (
    <span title={apartmentName} className="inline-flex min-w-0 items-center gap-1 text-xs text-ink-muted">
      <ApartmentIcon />
      <span aria-hidden="true" className="truncate">
        {short}
      </span>
      <span className="sr-only">{apartmentName}</span>
    </span>
  )
}

interface HistoryRowProps {
  item: ReceiptSummary
  href: string
  onOpen: (receiptId: string) => void
  showApartmentBadge: boolean
  showStatusBadge: boolean
  isSmallScreen: boolean
}

/** One row of the History list, rendered inside `HistoryRowList` (one Card,
 * rows separated by a divider). A real `<a>` link (same href/`from`
 * mechanism as the Items view's row links), so opening one in a new tab
 * works. From `sm` up, every value sits in a fixed-width column (store
 * takes the rest) so dates and amounts line up from row to row and under
 * `HistoryHeaderRow`'s labels, which use the same widths. Below `sm`
 * it's two lines. Only one of the two layouts is ever mounted, decided in
 * JS via `isSmallScreen`, same pattern as ReceiptResult.tsx/ReceiptItems.tsx. */
export function HistoryRow({ item, href, onOpen, showApartmentBadge, showStatusBadge, isSmallScreen }: HistoryRowProps) {
  const amount = formatMoney(item.total, item.currency)
  const store = item.store_name ? (
    <ClampedText text={item.store_name} lines={1} className="min-w-0 flex-1 font-medium text-ink" />
  ) : (
    <span className="min-w-0 flex-1 font-medium text-ink">{NOT_DETECTED}</span>
  )

  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault()
        onOpen(item.receipt_id)
      }}
      className="flex min-h-[44px] items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand"
    >
      {isSmallScreen ? (
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-center justify-between gap-3">
            {store}
            <span className="flex-shrink-0 whitespace-nowrap font-semibold tabular-nums text-ink">{amount}</span>
          </span>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-muted">
            <span className="tabular-nums">
              <DateCell value={item.purchase_date} />
            </span>
            {showApartmentBadge && <ApartmentBadge apartmentName={item.apartment_name} />}
            {showStatusBadge && <StatusBadge status={item.status} />}
          </span>
        </span>
      ) : (
        <>
          {store}
          <span className="w-28 flex-shrink-0 whitespace-nowrap tabular-nums text-ink-muted">
            <DateCell value={item.purchase_date} />
          </span>
          <span className="w-28 flex-shrink-0 whitespace-nowrap text-right font-semibold tabular-nums text-ink">
            {amount}
          </span>
          {showApartmentBadge && (
            <span className="flex w-24 min-w-0 flex-shrink-0">
              <ApartmentBadge apartmentName={item.apartment_name} />
            </span>
          )}
          {showStatusBadge && (
            <span className="flex w-28 flex-shrink-0">
              <StatusBadge status={item.status} />
            </span>
          )}
        </>
      )}
    </a>
  )
}

/** The list around `HistoryRow`s: one Card, rows separated by a decorative
 * `divide-border-subtle` line (the rows themselves carry no border). The
 * negative margins cancel the Card's own padding so a row's hover
 * background reaches the card's edges; `overflow-hidden` clips it to the
 * rounded corners, which is why the row's focus ring is drawn inset. */
export function HistoryRowList({ header, children }: { header?: ReactNode; children: ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <div className="-m-5 sm:-m-6">
        {header}
        <ul className="divide-y divide-border-subtle">{children}</ul>
      </div>
    </Card>
  )
}

/** Column labels above the rows (from `sm` up only -- the two-line small
 * layout has no columns to label). The same padding, gap and fixed widths
 * as `HistoryRow`'s wide layout, so each label sits over its values; the
 * Apartment/Status labels appear exactly when those columns do.
 * `aria-hidden`: purely visual -- each row link already reads its own
 * values, and a header that isn't a real table header would only be read
 * as stray words. */
export function HistoryHeaderRow({
  showApartment,
  showStatus,
}: {
  showApartment: boolean
  showStatus: boolean
}) {
  return (
    <div
      aria-hidden="true"
      className="flex items-center gap-3 border-b border-border-subtle px-4 py-2 text-xs font-medium text-ink-muted"
    >
      <span className="min-w-0 flex-1">Store</span>
      <span className="w-28 flex-shrink-0">Date</span>
      <span className="w-28 flex-shrink-0 text-right">Total</span>
      {showApartment && <span className="w-24 flex-shrink-0">Apartment</span>}
      {showStatus && <span className="w-28 flex-shrink-0">Status</span>}
    </div>
  )
}

const NETWORK_ERROR_MESSAGE = 'Could not reach the server. Please try again.'
const LIST_FAILED_MESSAGE = 'Could not load receipt history. Please try again.'

/** Reads a one-shot `?notice=` param (set by ReceiptUpload after a delete)
 * and strips it from the URL immediately, so reloading or navigating back
 * never redisplays it. */
function getAndClearNotice(): string | null {
  const params = new URLSearchParams(window.location.search)
  const notice = params.get('notice')
  if (notice === null) {
    return null
  }

  params.delete('notice')
  const query = params.toString()
  const newUrl = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`
  window.history.replaceState({}, '', newUrl)

  if (notice === 'deleted') return 'Receipt deleted.'
  if (notice === 'gone') return 'This receipt no longer exists.'
  if (notice === 'reviewed') return 'All receipts in this list are reviewed.'
  return null
}

interface HistoryUrlParams {
  apartment: string | null
  year: string | null
  status: string | null
}

function readUrlParams(): HistoryUrlParams {
  const params = new URLSearchParams(window.location.search)
  return {
    apartment: params.get('apartment'),
    year: params.get('year'),
    status: params.get('status'),
  }
}

function buildHistorySearch(params: HistoryUrlParams): string {
  const usp = new URLSearchParams()
  usp.set('view', 'history')
  if (params.apartment) usp.set('apartment', params.apartment)
  if (params.year) usp.set('year', params.year)
  if (params.status) usp.set('status', params.status)
  return `?${usp.toString()}`
}

function ReceiptHistory() {
  const [notice] = useState(getAndClearNotice)
  const [urlParams] = useState(readUrlParams)

  const [apartments, setApartments] = useState<ApartmentFacet[] | null>(null)
  const [totalCount, setTotalCount] = useState(0)
  const [years, setYears] = useState<number[]>([])
  const [hasUndated, setHasUndated] = useState(false)
  const [effectiveApartmentId, setEffectiveApartmentId] = useState<string | null>(null)

  const [items, setItems] = useState<ReceiptSummary[] | null>(null)
  const [listCount, setListCount] = useState(0)
  const [listTotal, setListTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const requestIdRef = useRef(0)
  const isSmallScreen = useMediaQuery('(max-width: 639px)')

  const year = effectiveYear(urlParams.year)
  const status = effectiveStatus(urlParams.status)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(null)
    setLoadMoreError(null)

    async function load() {
      // A fresh requestId, shared with handleShowMore below: whichever
      // request finishes last wins the id comparison, so a reply to an
      // older request (e.g. one still in flight when the user filters
      // again, which fully remounts this component anyway, or a slow
      // "Show more" from a previous page) can never overwrite a newer
      // result.
      const requestId = ++requestIdRef.current

      try {
        // Unscoped first: this is always needed for the tab bar's counts,
        // and also validates the URL's `apartment` value against real ids.
        const tabFacets = await getReceiptFacets()
        if (cancelled || requestIdRef.current !== requestId) return

        const knownApartmentIds = new Set(tabFacets.apartments.map((a) => a.id))
        const apartmentId = urlParams.apartment && knownApartmentIds.has(urlParams.apartment) ? urlParams.apartment : null

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
        setTotalCount(tabFacets.total)
        setYears(scopedYears)
        setHasUndated(scopedHasUndated)
        setEffectiveApartmentId(apartmentId)

        const response = await listReceipts({
          apartmentId: apartmentId ?? undefined,
          year: year ?? undefined,
          status: status ?? undefined,
          limit: PAGE_SIZE,
          offset: 0,
        })
        if (cancelled || requestIdRef.current !== requestId) return
        setItems(response.items)
        setListCount(response.count)
        setListTotal(response.total)
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
    // urlParams/year/status are captured once per mount (the whole page
    // remounts on any navigation).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadToken])

  const retry = () => {
    setReloadToken((n) => n + 1)
  }

  const handleShowMore = async () => {
    const requestId = ++requestIdRef.current
    setIsLoadingMore(true)
    setLoadMoreError(null)

    try {
      const response = await listReceipts({
        apartmentId: effectiveApartmentId ?? undefined,
        year: year ?? undefined,
        status: status ?? undefined,
        limit: PAGE_SIZE,
        offset: listCount,
      })
      if (requestIdRef.current !== requestId) return
      setItems((prev) => [...(prev ?? []), ...response.items])
      setListCount((prev) => prev + response.count)
      setListTotal(response.total)
    } catch (err) {
      if (requestIdRef.current !== requestId) return
      setLoadMoreError(err instanceof ApiError ? LIST_FAILED_MESSAGE : NETWORK_ERROR_MESSAGE)
    } finally {
      if (requestIdRef.current === requestId) setIsLoadingMore(false)
    }
  }

  // Only carry a `from` param when a tab or filter is actually active --
  // the plain, unfiltered history view needs no round trip, and this
  // keeps `?receipt=<id>` exactly as it was for that common case.
  const receiptHref = (receiptId: string): string => {
    const hasActiveFilterOrTab = effectiveApartmentId !== null || anyFilterActive
    const from = hasActiveFilterOrTab ? `&from=${encodeURIComponent(window.location.search)}` : ''
    return `/?receipt=${receiptId}${from}`
  }

  const openReceipt = (receiptId: string) => {
    navigateTo(receiptHref(receiptId).slice(1))
  }

  const goToUpload = (e: React.MouseEvent) => {
    e.preventDefault()
    navigateTo('')
  }

  const goToTab = (apartmentId: string | null) => {
    navigateTo(buildHistorySearch({ ...urlParams, apartment: apartmentId }))
  }

  const handleYearChange = (value: string) => {
    navigateTo(buildHistorySearch({ ...urlParams, year: value || null }))
  }

  const handleStatusChange = (value: string) => {
    navigateTo(buildHistorySearch({ ...urlParams, status: value || null }))
  }

  const handleClearFilters = () => {
    navigateTo(buildHistorySearch({ apartment: urlParams.apartment, year: null, status: null }))
  }

  const tabs: { id: string | null; label: string; accessibleName?: string }[] = [
    { id: null, label: `All apartments (${totalCount})` },
    ...(apartments ?? []).map((a) => ({
      id: a.id,
      label: `${apartmentShortName(a.name) ?? a.name} (${a.count})`,
      accessibleName: a.name,
    })),
  ]

  const yearValue = year
  const statusValue = status

  const anyFilterActive = yearValue !== null || statusValue !== null
  const noticeBanner = notice ? <p className="text-sm text-green-600">{notice}</p> : null

  if (isLoading) {
    return (
      <div className="flex w-full flex-col gap-4">
        <PageHeader title="History" description={HISTORY_DESCRIPTION} />
        {noticeBanner}
        <div
          role="status"
          aria-busy="true"
          className="flex flex-col gap-3 rounded-card border border-border-subtle bg-surface p-6 shadow-card"
        >
          <span className="sr-only">Loading receipts...</span>
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
        <PageHeader title="History" description={HISTORY_DESCRIPTION} />
        <div className="flex flex-col gap-4 rounded-card border border-border-subtle bg-surface p-6 shadow-card">
          {noticeBanner}
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

  const isUnfiltered = effectiveApartmentId === null && !anyFilterActive

  return (
    <div className="flex w-full flex-col gap-4">
      <PageHeader title="History" description={HISTORY_DESCRIPTION} />
      {noticeBanner}

      <ReceiptFilters
        tabs={tabs}
        selectedApartmentId={effectiveApartmentId}
        onSelectApartment={goToTab}
        focusSessionKey={FOCUS_TAB_INDEX_SESSION_KEY}
        years={years}
        hasUndated={hasUndated}
        yearValue={yearValue}
        onYearChange={handleYearChange}
        yearSelectId="history-year-select"
        statusValue={statusValue}
        onStatusChange={handleStatusChange}
        statusSelectId="history-status-select"
      />

      <div className="flex items-center justify-between gap-2">
        <p role="status" className="text-sm text-ink-muted">
          {listCount < listTotal
            ? `${listCount} of ${listTotal} receipts`
            : `${listTotal} ${listTotal === 1 ? 'receipt' : 'receipts'}`}
        </p>
        {anyFilterActive && (
          <Button variant="secondary" size="sm" onClick={handleClearFilters}>
            Clear filters
          </Button>
        )}
      </div>

      {items && items.length === 0 ? (
        isUnfiltered ? (
          <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-6">
            <p className="text-sm text-ink-muted">No receipts yet. Upload your first receipt.</p>
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
            <p className="text-sm text-ink-muted">No receipts match these filters.</p>
          </div>
        )
      ) : (
        <>
          <HistoryRowList
            header={
              isSmallScreen ? undefined : (
                <HistoryHeaderRow showApartment={effectiveApartmentId === null} showStatus={statusValue === null} />
              )
            }
          >
            {items?.map((item) => (
              <li key={item.receipt_id}>
                <HistoryRow
                  item={item}
                  href={receiptHref(item.receipt_id)}
                  onOpen={openReceipt}
                  showApartmentBadge={effectiveApartmentId === null}
                  showStatusBadge={statusValue === null}
                  isSmallScreen={isSmallScreen}
                />
              </li>
            ))}
          </HistoryRowList>

          <div className="flex flex-col gap-2">
            {loadMoreError && (
              <>
                <Alert variant="error">{loadMoreError}</Alert>
                <Button variant="secondary" size="sm" className="self-start" onClick={handleShowMore}>
                  Retry
                </Button>
              </>
            )}
            {!loadMoreError && listCount < listTotal && (
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

export default ReceiptHistory
