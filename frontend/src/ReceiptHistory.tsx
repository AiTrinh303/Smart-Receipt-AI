import { useEffect, useState } from 'react'
import { ApiError } from './api/ApiError'
import { getReceiptFacets } from './api/getReceiptFacets'
import { listReceipts } from './api/listReceipts'
import type { ApartmentFacet, ReceiptSummary } from './api/types'
import ReceiptFilters, { effectiveStatus, effectiveYear } from './ReceiptFilters'
import Button from './components/ui/Button'
import PageHeader from './components/ui/PageHeader'
import Skeleton from './components/ui/Skeleton'
import StatusBadge from './components/ui/StatusBadge'
import { navigateTo } from './navigation'

const LOADING_ROW_COUNT = 4

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

function ApartmentBadge({ apartmentName }: { apartmentName: string | null | undefined }) {
  if (!apartmentName) {
    return <span className="text-ink-muted">{NOT_ASSIGNED}</span>
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand">
      <ApartmentIcon />
      {apartmentName}
    </span>
  )
}

function displayText(value: string | null | undefined): string {
  return value === null || value === undefined || value === '' ? NOT_DETECTED : value
}

function displayAmount(value: number | null | undefined, currency: string | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return NOT_DETECTED
  }

  const formatted = value.toFixed(2)
  return currency ? `${currency} ${formatted}` : formatted
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
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(null)

    async function load() {
      try {
        // Unscoped first: this is always needed for the tab bar's counts,
        // and also validates the URL's `apartment` value against real ids.
        const tabFacets = await getReceiptFacets()
        if (cancelled) return

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
        if (cancelled) return

        setApartments(tabFacets.apartments)
        setTotalCount(tabFacets.total)
        setYears(scopedYears)
        setHasUndated(scopedHasUndated)
        setEffectiveApartmentId(apartmentId)

        const year = effectiveYear(urlParams.year)
        const status = effectiveStatus(urlParams.status)

        const response = await listReceipts({
          apartmentId: apartmentId ?? undefined,
          year: year ?? undefined,
          status: status ?? undefined,
        })
        if (cancelled) return
        setItems(response.items)
        setListCount(response.count)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof ApiError ? LIST_FAILED_MESSAGE : NETWORK_ERROR_MESSAGE)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
    // urlParams is captured once per mount (the whole page remounts on any
    // navigation).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadToken])

  const retry = () => {
    setReloadToken((n) => n + 1)
  }

  const openReceipt = (receiptId: string) => {
    // Only carry a `from` param when a tab or filter is actually active --
    // the plain, unfiltered history view needs no round trip, and this
    // keeps `?receipt=<id>` exactly as it was for that common case.
    const hasActiveFilterOrTab = effectiveApartmentId !== null || anyFilterActive
    const from = hasActiveFilterOrTab ? `&from=${encodeURIComponent(window.location.search)}` : ''
    navigateTo(`?receipt=${receiptId}${from}`)
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

  const tabs: { id: string | null; label: string }[] = [
    { id: null, label: `All apartments (${totalCount})` },
    ...(apartments ?? []).map((a) => ({ id: a.id, label: `${a.name} (${a.count})` })),
  ]

  const yearValue = effectiveYear(urlParams.year)
  const statusValue = effectiveStatus(urlParams.status)

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
          {listCount} {listCount === 1 ? 'receipt' : 'receipts'}
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
        <ul className="flex flex-col gap-2">
          {items?.map((item) => (
            <li key={item.receipt_id}>
              <button
                type="button"
                onClick={() => openReceipt(item.receipt_id)}
                className="flex w-full items-center justify-between gap-4 rounded-md border border-border bg-surface px-3 py-2 text-left text-sm hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                <span>
                  <span className="block font-medium text-ink">{displayText(item.store_name)}</span>
                  <span className="block text-ink-muted">{displayText(item.purchase_date)}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-1.5">
                    {effectiveApartmentId === null && <ApartmentBadge apartmentName={item.apartment_name} />}
                    <StatusBadge status={item.status} />
                  </span>
                </span>
                <span className="font-semibold text-ink">{displayAmount(item.total, item.currency)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default ReceiptHistory
