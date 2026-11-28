import { useEffect, useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import { listReceipts } from './api/listReceipts'
import type { ReceiptSummary } from './api/types'
import { apartmentShortName } from './format/apartmentShortName'
import { navigateTo, isPlainLeftClick } from './navigation'
import { DateCell } from './ReceiptItems'
import { ApartmentPill } from './components/ui/ApartmentTone'
import Card from './components/ui/Card'
import ClampedText from './components/ui/ClampedText'
import MissingValue from './components/ui/MissingValue'
import Skeleton from './components/ui/Skeleton'
import { formatMoney } from './components/ui/formatMoney'

export const LATEST_UPLOADS_LIMIT = 5

export const TIPS_ITEMS = [
  'Lay the receipt flat.',
  'Use good light.',
  'Keep the whole receipt in frame, including the total.',
  'One receipt per photo.',
]

export const HOW_IT_WORKS_STEPS = [
  'Choose the apartment.',
  'Add photos or PDFs.',
  'Check the result in History or Items. The Report counts every receipt, reviewed or not.',
]

// Every variant of the side panel (loading, help, overview) shares the
// same outer Card classes, so swapping one for another never changes the
// column's layout. From lg up the card fills its (stretched) grid column,
// so it ends on the same line as the upload form; its content stays at
// the top. Not sticky: the two cards are meant to read as one row.
const PANEL_CLASSES = 'flex flex-col gap-4 lg:flex-1'

const LINK_CLASSES =
  'rounded-sm font-medium text-brand underline hover:text-brand-hover focus-visible:outline focus-visible:outline-2 ' +
  'focus-visible:outline-offset-2 focus-visible:outline-brand'

/** An in-app link: a real `href` (so a new tab works) whose plain click
 * goes through navigateTo, the same pattern History's rows use. */
function AppLink({ search, className, title, children }: {
  search: string
  className: string
  title?: string
  children: ReactNode
}) {
  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!isPlainLeftClick(e)) {
      return
    }
    e.preventDefault()
    navigateTo(search)
  }
  return (
    <a href={`/${search}`} onClick={handleClick} className={className} title={title}>
      {children}
    </a>
  )
}

/** The three "How it works" steps plus the reading tips -- the same
 * content wherever it's shown (the standalone help card, or collapsed
 * inside the overview card). */
export function HowItWorksContent() {
  return (
    <>
      <ol className="flex flex-col gap-3">
        {HOW_IT_WORKS_STEPS.map((step, index) => (
          <li key={step} className="flex gap-3">
            <span
              aria-hidden="true"
              className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-brand-subtle text-xs font-semibold text-brand"
            >
              {index + 1}
            </span>
            <p className="text-sm text-ink-muted">{step}</p>
          </li>
        ))}
      </ol>

      <div className="flex flex-col gap-2 border-t border-border-subtle pt-4">
        <h3 className="text-sm font-semibold text-ink">Tips for better reading</h3>
        <ul className="flex flex-col gap-1 pl-5 list-disc text-sm text-ink-muted">
          {TIPS_ITEMS.map((tip) => (
            <li key={tip}>{tip}</li>
          ))}
        </ul>
      </div>
    </>
  )
}

/** The first-visit help: shown expanded when nothing is saved yet, and as
 * the silent fallback whenever loading the overview fails. */
export function HelpPanel() {
  return (
    <Card className={PANEL_CLASSES}>
      <h2 className="text-base font-semibold text-ink">How it works</h2>
      <HowItWorksContent />
    </Card>
  )
}

export function UploadSidePanelSkeleton() {
  return (
    <Card className={PANEL_CLASSES}>
      <div role="status" aria-busy="true" className="flex flex-col gap-4">
        <span className="sr-only">Loading your receipts...</span>
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-4 w-2/3" />
        <div className="flex flex-col gap-2 border-t border-border-subtle pt-4">
          <Skeleton className="h-4 w-1/3" />
          {Array.from({ length: LATEST_UPLOADS_LIMIT }, (_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
        <Skeleton className="h-4 w-1/2" />
      </div>
    </Card>
  )
}

function LatestUploadRow({ receipt }: { receipt: ReceiptSummary }) {
  const apartmentLabel = receipt.apartment_name
    ? (apartmentShortName(receipt.apartment_name) ?? receipt.apartment_name)
    : null

  return (
    <li>
      <AppLink
        search={`?receipt=${receipt.receipt_id}`}
        className="flex flex-col gap-0.5 rounded-control px-2 py-1.5 text-sm hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <span className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 font-medium text-ink">
            {receipt.store_name ? <ClampedText text={receipt.store_name} lines={1} /> : <MissingValue />}
          </span>
          <span className="flex-shrink-0 whitespace-nowrap tabular-nums text-ink">
            {receipt.total !== null ? formatMoney(receipt.total, receipt.currency) : <MissingValue />}
          </span>
        </span>
        <span className="flex items-center justify-between gap-3 text-xs text-ink-muted">
          <span className="whitespace-nowrap">
            <DateCell value={receipt.purchase_date} />
          </span>
          {apartmentLabel ? (
            <ApartmentPill apartmentId={receipt.apartment_id} title={receipt.apartment_name ?? undefined}>
              <span className="truncate">{apartmentLabel}</span>
            </ApartmentPill>
          ) : (
            <MissingValue />
          )}
        </span>
      </AppLink>
    </li>
  )
}

/** The panel for a returning user: "How it works and tips" (open) at
 * the top, then "Latest uploads" (the panel's heading) with the 5 newest
 * uploads, then links on to History and the yearly Report. Presentational
 * (exported for the style guide and tests). */
export function ReceiptsOverview({ latest }: { latest: ReceiptSummary[] }) {
  return (
    <Card className={PANEL_CLASSES}>
      {/* Open by default (the owner can close it; nothing is remembered
          across reloads). The below-lg TipsDetails in the form stays closed. */}
      <details className="group border-b border-border-subtle pb-4 text-sm" open>
        <summary className="flex cursor-pointer select-none list-none items-center gap-1.5 rounded-sm font-medium text-ink [&::-webkit-details-marker]:hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            className="h-4 w-4 flex-shrink-0 text-ink-muted transition-transform duration-150 motion-reduce:transition-none group-open:rotate-90"
            fill="none"
          >
            <path d="M7.5 4.5l5 5.5-5 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          How it works and tips
        </summary>
        <div className="mt-3 flex flex-col gap-4">
          <HowItWorksContent />
        </div>
      </details>

      <div className="flex flex-col gap-2">
        <h2 className="text-base font-semibold text-ink">Latest uploads</h2>
        <ul className="-mx-2 flex flex-col">
          {latest.map((receipt) => (
            <LatestUploadRow key={receipt.receipt_id} receipt={receipt} />
          ))}
        </ul>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        <AppLink search="?view=history" className={LINK_CLASSES}>
          See all in History
        </AppLink>
        <AppLink search="?view=report" className={LINK_CLASSES}>
          Open the yearly report
        </AppLink>
      </div>
    </Card>
  )
}

type PanelState =
  | { kind: 'loading' }
  | { kind: 'help' }
  | { kind: 'overview'; latest: ReceiptSummary[] }

/** The Upload page's right-hand column (from `lg` up only -- the caller
 * decides that via useMediaQuery, never CSS). Fetches the latest receipts
 * once on mount (one request; its `total` says whether there are any
 * receipts at all), and once more each time `refreshKey`
 * changes (after a single upload's extraction or a finished batch). A
 * refresh keeps the current content on screen until the new data arrives
 * -- the skeleton only ever shows on the first load. Any failure silently
 * shows the plain help instead: the panel is a convenience, never a
 * reason to show an error next to the upload form. */
function UploadSidePanel({ refreshKey = 0 }: { refreshKey?: number }) {
  const [state, setState] = useState<PanelState>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        // "Latest uploads" means upload order, not the list's default
        // (purchase date) -- so this asks for it explicitly.
        const latest = await listReceipts({ limit: LATEST_UPLOADS_LIMIT, sort: 'uploaded_desc' })
        if (cancelled) {
          return
        }
        setState(latest.total === 0 ? { kind: 'help' } : { kind: 'overview', latest: latest.items })
      } catch {
        if (!cancelled) {
          setState({ kind: 'help' })
        }
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  if (state.kind === 'loading') {
    return <UploadSidePanelSkeleton />
  }
  if (state.kind === 'help') {
    return <HelpPanel />
  }
  return <ReceiptsOverview latest={state.latest} />
}

export default UploadSidePanel
