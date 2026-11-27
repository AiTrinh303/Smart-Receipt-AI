import { useEffect, useState, type ReactNode } from 'react'
import { ApiError } from './api/ApiError'
import { getReportYears } from './api/getReportYears'
import { getYearlyReport } from './api/getYearlyReport'
import type { ExportStyle } from './api/reportExportUrl'
import { reportExportCsvUrl, reportExportZipUrl } from './api/reportExportUrl'
import type {
  Apartment,
  ReportApartmentSummary,
  ReportBasis,
  ReportCurrencyTotal,
  YearlyReport,
} from './api/types'
import { apartmentShortName } from './format/apartmentShortName'
import { apartmentToneClasses } from './format/apartmentTone'
import Card from './components/ui/Card'
import PageHeader from './components/ui/PageHeader'
import Skeleton from './components/ui/Skeleton'
import { formatMoneyFromString, currencySymbol } from './components/ui/formatMoney'
import { useApartments } from './hooks/useApartments'
import { useMediaQuery } from './hooks/useMediaQuery'
import { navigateTo, isPlainLeftClick } from './navigation'
import { DownloadIcon } from './ReceiptFileViewer'
import { exportOpenItems, type ExportOpenItems } from './reportOpenItems'

/** The page description follows the "Only count receipts I approved"
 * choice, so it never claims approved-only totals while every receipt is
 * counted. */
function reportDescription(basis: ReportBasis): string {
  return basis === 'approved'
    ? 'Spending per apartment, from the receipts you approved.'
    : 'Spending per apartment, from every saved receipt.'
}
const LOADING_ROW_COUNT = 4

const NETWORK_ERROR_MESSAGE = 'Could not reach the server. Please try again.'
const LOAD_FAILED_MESSAGE = 'Could not load the yearly report. Please try again.'

const ALL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

interface ReportUrlParams {
  year: string | null
  basis: string | null
}

function readUrlParams(): ReportUrlParams {
  const params = new URLSearchParams(window.location.search)
  return {
    year: params.get('year'),
    basis: params.get('basis'),
  }
}

/** The default basis is "all" (the owner has no time to review every
 * receipt before a tax declaration is due), so it is the one value
 * omitted from the URL entirely -- only "approved" (an explicit opt-in)
 * is ever written. Any other value is ignored, same "ignored, never
 * sent" spirit as every other filter in this app. */
function effectiveBasis(rawBasis: string | null): ReportBasis {
  return rawBasis === 'approved' ? 'approved' : 'all'
}

function buildReportSearch(year: number, basis: ReportBasis): string {
  const params = new URLSearchParams()
  params.set('view', 'report')
  params.set('year', String(year))
  if (basis === 'approved') params.set('basis', 'approved')
  return `?${params.toString()}`
}

/** Renders one currency row ("€1,234.56 Β· 7 receipts" -- the amount
 * large/tabular/right-aligned, as the summary cards call for). */
function CurrencyRow({ entry }: { entry: ReportCurrencyTotal }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-sm text-ink-muted">
        {entry.receipt_count} {entry.receipt_count === 1 ? 'receipt' : 'receipts'}
      </span>
      <span className="text-right text-xl font-semibold tabular-nums text-ink">
        {formatMoneyFromString(entry.total, entry.currency)}
      </span>
    </div>
  )
}

function emptyApartmentText(year: number, basis: ReportBasis): string {
  return basis === 'approved' ? `No approved receipts in ${year}.` : `No receipts in ${year}.`
}

function ApartmentSummaryCard({
  apartment,
  year,
  basis,
}: {
  apartment: ReportApartmentSummary
  year: number
  basis: ReportBasis
}) {
  return (
    // The apartment's tone as the whole card's surface (soft fill + faint
    // tone border); an unknown apartment gets the plain card.
    <Card
      surface={apartmentToneClasses(apartment.apartment_id).card}
      className="flex flex-col gap-3"
      title={apartment.apartment_name}
    >
      <h2 className="text-base font-semibold text-ink" title={apartment.apartment_name}>
        {apartmentShortName(apartment.apartment_name) ?? apartment.apartment_name}
      </h2>
      {apartment.by_currency.length === 0 ? (
        <p className="text-sm text-ink-muted">{emptyApartmentText(year, basis)}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {apartment.by_currency.map((entry) => (
            <CurrencyRow key={entry.currency} entry={entry} />
          ))}
        </div>
      )}
    </Card>
  )
}

function OverallSummaryCard({
  overall,
  year,
  basis,
}: {
  overall: ReportCurrencyTotal[]
  year: number
  basis: ReportBasis
}) {
  return (
    <Card variant="emphasis" className="flex flex-col gap-3">
      <h2 className="text-base font-semibold text-ink">Both apartments</h2>
      {overall.length === 0 ? (
        <p className="text-sm text-ink-muted">{emptyApartmentText(year, basis)}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {overall.map((entry) => (
            <CurrencyRow key={entry.currency} entry={entry} />
          ))}
        </div>
      )}
    </Card>
  )
}

/** Groups every apartment's monthly breakdown by currency, for the
 * monthly table/cards below -- pure data organization (grouping and
 * sorting), never arithmetic on the amounts themselves. Every currency
 * lists all 12 months, January to December; a month with no data for an
 * apartment shows a dash. There is no
 * combined "Both apartments" column here: the backend's `overall` field
 * has no monthly breakdown, and summing two apartments' decimal-string
 * totals in the frontend would be exactly the arithmetic this app's
 * money rule forbids, so this table only ever shows one column per
 * apartment. */
function buildMonthlyCurrencyTables(apartments: ReportApartmentSummary[]) {
  const currencies = new Set<string>()
  const cells: Record<string, Record<number, Record<string, ReportCurrencyTotal>>> = {}

  for (const apartment of apartments) {
    for (const monthEntry of apartment.months) {
      for (const currencyTotal of monthEntry.by_currency) {
        const currency = currencyTotal.currency
        currencies.add(currency)
        cells[currency] ??= {}
        cells[currency][monthEntry.month] ??= {}
        cells[currency][monthEntry.month][apartment.apartment_id] = currencyTotal
      }
    }
  }

  return Array.from(currencies)
    .sort()
    .map((currency) => ({
      currency,
      months: ALL_MONTHS,
      cells: cells[currency],
    }))
}

function MonthlyCurrencyTable({
  currency,
  months,
  cells,
  apartments,
  isSmallScreen,
  showCurrencyHeading,
}: {
  currency: string
  months: number[]
  cells: Record<number, Record<string, ReportCurrencyTotal>>
  apartments: ReportApartmentSummary[]
  isSmallScreen: boolean
  /** Only when the year has more than one currency. */
  showCurrencyHeading: boolean
}) {
  const cellText = (month: number, apartmentId: string): string => {
    const entry = cells[month]?.[apartmentId]
    return entry ? formatMoneyFromString(entry.total, currency, { includeCurrency: false }) : '—'
  }

  if (isSmallScreen) {
    return (
      <div className="flex flex-col gap-2">
        {showCurrencyHeading && <h3 className="text-sm font-semibold text-ink">{currencySymbol(currency)}</h3>}
        <ul className="flex flex-col gap-2">
          {months.map((month) => (
            <li key={month} className="rounded-md border border-border p-3 text-sm">
              <p className="font-medium text-ink">{MONTH_NAMES[month - 1]}</p>
              <dl className="mt-1 flex flex-col gap-1">
                {apartments.map((apartment) => (
                  <div key={apartment.apartment_id} className="flex items-baseline justify-between gap-2">
                    <dt className="text-ink-muted" title={apartment.apartment_name}>
                      {apartmentShortName(apartment.apartment_name) ?? apartment.apartment_name}
                    </dt>
                    <dd className="tabular-nums text-ink">{cellText(month, apartment.apartment_id)}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {showCurrencyHeading && <h3 className="text-sm font-semibold text-ink">{currencySymbol(currency)}</h3>}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Monthly totals in {currencySymbol(currency)}</caption>
          <thead>
            <tr className="border-b border-border text-ink-muted">
              <th scope="col" className="py-1 pr-2 font-medium">
                Month
              </th>
              {apartments.map((apartment) => (
                <th
                  key={apartment.apartment_id}
                  scope="col"
                  className="whitespace-nowrap py-1 pr-2 text-right font-medium"
                  title={apartment.apartment_name}
                >
                  {apartmentShortName(apartment.apartment_name) ?? apartment.apartment_name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {months.map((month) => (
              <tr key={month} className="border-b border-border/40">
                <td className="py-1 pr-2">{MONTH_NAMES[month - 1]}</td>
                {apartments.map((apartment) => (
                  <td
                    key={apartment.apartment_id}
                    className="whitespace-nowrap py-1 pr-2 text-right tabular-nums"
                  >
                    {cellText(month, apartment.apartment_id)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const DETAILS_SUMMARY_CLASSES =
  'cursor-pointer select-none text-sm font-semibold text-ink focus-visible:outline ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand'

const EXPORT_SELECT_CLASSES =
  'h-11 min-h-[44px] rounded-md border border-border bg-surface px-3 text-sm text-ink ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand'

const EXPORT_LINK_BASE =
  'inline-flex min-h-[44px] flex-shrink-0 items-center justify-center gap-1.5 rounded-control px-4 ' +
  'text-sm font-semibold transition-colors duration-150 motion-reduce:transition-none sm:min-h-0 sm:h-10'

const EXPORT_PRIMARY_LINK_CLASSES =
  `${EXPORT_LINK_BASE} bg-brand text-white hover:bg-brand-hover focus-visible:outline ` +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand'

const EXPORT_PRIMARY_DISABLED_CLASSES = `${EXPORT_LINK_BASE} cursor-not-allowed bg-slate-300 text-slate-700`

const EXPORT_SECONDARY_LINK_CLASSES =
  `${EXPORT_LINK_BASE} border border-border bg-white text-ink hover:bg-slate-50 focus-visible:outline ` +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand'

const EXPORT_SECONDARY_DISABLED_CLASSES =
  `${EXPORT_LINK_BASE} cursor-not-allowed border border-border bg-slate-100 text-slate-400`

const EXPORT_NOTHING_TO_EXPORT_TEXT = 'Nothing to export yet.'
const EXPORT_PRIVACY_TEXT = 'The ZIP contains personal data and is not encrypted; send it only to your tax advisor.'

function exportPeriodText(year: number, basis: ReportBasis): string {
  return `${year}, ${basis === 'approved' ? 'approved receipts only' : 'all receipts'}`
}

/** "For your tax advisor": the CSV/ZIP download controls below the yearly
 * summary. Presentational and self-contained (apartment list and style
 * choice are its own component state, never the URL) so it can be reached
 * both from ReceiptReport's live data and directly from StyleGuide/tests
 * with static props -- the same pattern ApartmentCell/HistoryRow/etc.
 * already use elsewhere in this app. A plain <a href> for each link: no
 * fetch, no onClick -- the browser downloads via the server's own
 * Content-Disposition header, exactly like "Download PDF" in
 * ReceiptFileViewer.tsx. */
export interface ExportCardProps {
  /** null when there is no year to export at all (no dated receipts) --
   * renders both links as disabled, non-interactive spans instead. */
  year: number | null
  basis: ReportBasis
  apartments: Apartment[] | null
  /** What is still open for this year/basis; the short note above the
   * buttons is built from it. Omitted (or all zero) -> no note at all. */
  openItems?: ExportOpenItems
}

/** The short "check before you send" note above the export buttons: one
 * line "N not reviewed · M with warnings" (parts that are 0 left out;
 * "not approved" under basis=approved) with a right-aligned "Review them"
 * link while anything is unreviewed, then one line per non-zero "not in
 * these totals" bucket. Every line starts with the warning icon and says
 * what it means in words. Nothing at all when everything is zero. */
function ExportNote({ year, basis, items }: { year: number; basis: ReportBasis; items: ExportOpenItems }) {
  const parts: string[] = []
  if (items.notReviewed > 0) {
    parts.push(`${items.notReviewed} ${basis === 'approved' ? 'not approved' : 'not reviewed'}`)
  }
  if (items.withWarnings > 0) {
    parts.push(`${items.withWarnings} with warnings`)
  }
  const anything =
    parts.length > 0 || items.undated > 0 || items.noTotal > 0 || items.noCurrency > 0 || items.noApartment > 0
  if (!anything) {
    return null
  }

  return (
    <ul className="flex flex-col gap-2 text-sm text-ink">
      {parts.length > 0 && (
        <li className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <span className="flex items-start gap-2">
            <NoteIcon />
            {parts.join(' · ')}
          </span>
          {items.notReviewed > 0 && (
            <HistoryLink search={`?view=history&year=${year}&status=needs_review`}>Review them</HistoryLink>
          )}
        </li>
      )}
      {items.undated > 0 && (
        <li className="flex items-start gap-2">
          <NoteIcon />
          <HistoryLink search="?view=history&year=none">{items.undated} receipts have no valid date</HistoryLink>
        </li>
      )}
      {items.noTotal > 0 && (
        <li className="flex items-start gap-2">
          <NoteIcon />
          <span>
            {items.noTotal} {items.noTotal === 1 ? 'receipt has' : 'receipts have'} no total. Open the receipt
            and fix it with Edit.
          </span>
        </li>
      )}
      {items.noCurrency > 0 && (
        <li className="flex items-start gap-2">
          <NoteIcon />
          <span>
            {items.noCurrency} {items.noCurrency === 1 ? 'receipt has' : 'receipts have'} no currency. Open the
            receipt and fix it with Edit.
          </span>
        </li>
      )}
      {items.noApartment > 0 && (
        <li className="flex items-start gap-2">
          <NoteIcon />
          <span>
            {items.noApartment} {items.noApartment === 1 ? 'receipt has' : 'receipts have'} no apartment. Open
            the receipt and fix it with Edit.
          </span>
        </li>
      )}
    </ul>
  )
}

export function ExportCard({ year, basis, apartments, openItems }: ExportCardProps) {
  const [apartmentId, setApartmentId] = useState('')
  const [style, setStyle] = useState<ExportStyle>('excel_de')

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-base font-semibold text-ink">For your tax advisor</h2>

      {year !== null && openItems && <ExportNote year={year} basis={basis} items={openItems} />}

      {exportLinks(year, basis, style, apartmentId)}

      {year === null && <p className="text-sm text-ink-muted">{EXPORT_NOTHING_TO_EXPORT_TEXT}</p>}

      {/* The defaults (all apartments, German Excel CSV) fit almost every
          export, so the two choices start folded away. Closing the panel
          keeps the chosen values. */}
      <details className="flex flex-col gap-3">
        <summary className={DETAILS_SUMMARY_CLASSES}>Export options</summary>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <div className="flex flex-col gap-1">
          <label htmlFor="report-export-apartment-select" className="text-sm font-medium text-ink">
            Apartment
          </label>
          <select
            id="report-export-apartment-select"
            value={apartmentId}
            onChange={(e) => setApartmentId(e.target.value)}
            className={EXPORT_SELECT_CLASSES}
          >
            <option value="">All apartments</option>
            {(apartments ?? []).map((apartment) => (
              <option key={apartment.id} value={apartment.id} title={apartment.name}>
                {apartmentShortName(apartment.name) ?? apartment.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="report-export-style-select" className="text-sm font-medium text-ink">
            CSV format
          </label>
          <select
            id="report-export-style-select"
            value={style}
            onChange={(e) => setStyle(e.target.value as ExportStyle)}
            className={EXPORT_SELECT_CLASSES}
          >
            <option value="excel_de">German Excel (semicolon, decimal comma)</option>
            <option value="plain">Plain (comma, decimal point)</option>
          </select>
        </div>
      </div>
      </details>

      <p className="text-sm text-ink-muted">{EXPORT_PRIVACY_TEXT}</p>
    </Card>
  )
}

/** The ZIP (primary) and CSV (secondary) download links -- plain `<a
 * href>`s, or disabled spans when there is no year to export. */
function exportLinks(year: number | null, basis: ReportBasis, style: ExportStyle, apartmentId: string) {
  return (
      <div className="flex flex-wrap items-center gap-3">
        {year === null ? (
          <>
            <span aria-disabled="true" className={EXPORT_PRIMARY_DISABLED_CLASSES}>
              <DownloadIcon />
              Download ZIP (CSV and PDFs)
            </span>
            <span aria-disabled="true" className={EXPORT_SECONDARY_DISABLED_CLASSES}>
              <DownloadIcon />
              Download CSV only
            </span>
          </>
        ) : (
          <>
            <a
              href={reportExportZipUrl({ year, basis, style, apartmentId: apartmentId || undefined })}
              className={EXPORT_PRIMARY_LINK_CLASSES}
            >
              <DownloadIcon />
              Download ZIP (CSV and PDFs)
            </a>
            <a
              href={reportExportCsvUrl({ year, basis, style, apartmentId: apartmentId || undefined })}
              className={EXPORT_SECONDARY_LINK_CLASSES}
            >
              <DownloadIcon />
              Download CSV only
            </a>
            <span className="text-sm text-ink-muted">{exportPeriodText(year, basis)}</span>
          </>
        )}
      </div>
  )
}

const CHECK_LINK_CLASSES =
  'font-medium text-brand underline focus-visible:outline focus-visible:outline-2 ' +
  'focus-visible:outline-offset-2 focus-visible:outline-brand'

/** A link to a filtered History view (e.g. `?view=history&year=none`). */
function HistoryLink({ search, children }: { search: string; children: ReactNode }) {
  return (
    <a
      href={`/${search}`}
      onClick={(e) => {
        if (!isPlainLeftClick(e)) {
          return
        }
        e.preventDefault()
        navigateTo(search)
      }}
      className={CHECK_LINK_CLASSES}
    >
      {children}
    </a>
  )
}

function NoteIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 flex-shrink-0 text-warning" fill="none">
      <path d="M10 3.5l8 13.5H2l8-13.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M10 8.5v3.5M10 14.75h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

/** The fixed VAT note -- once, at the very bottom of the page. */
export const VAT_FOOTNOTE =
  'Totals are the amounts printed on the receipts, including VAT. Ask your tax advisor how to use them.'

function ReceiptReport() {
  const [urlParams] = useState(readUrlParams)
  const basis = effectiveBasis(urlParams.basis)

  const [years, setYears] = useState<number[] | null>(null)
  const [year, setYear] = useState<number | null>(null)
  const [report, setReport] = useState<YearlyReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [reloadToken, setReloadToken] = useState(0)

  const isSmallScreen = useMediaQuery('(max-width: 639px)')
  const { apartments: exportApartments } = useApartments(true)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(null)

    async function load() {
      try {
        const yearsResponse = await getReportYears()
        if (cancelled) return

        setYears(yearsResponse.items)

        if (yearsResponse.items.length === 0) {
          setYear(null)
          setReport(null)
          return
        }

        const requestedYear = urlParams.year ? Number(urlParams.year) : null
        const effectiveYearValue =
          requestedYear !== null && yearsResponse.items.includes(requestedYear)
            ? requestedYear
            : yearsResponse.items[0]
        setYear(effectiveYearValue)

        const reportResponse = await getYearlyReport({ year: effectiveYearValue, basis })
        if (cancelled) return
        setReport(reportResponse)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof ApiError ? LOAD_FAILED_MESSAGE : NETWORK_ERROR_MESSAGE)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
    // urlParams/basis are captured once per mount (the whole page remounts
    // on any navigation).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadToken])

  const retry = () => setReloadToken((n) => n + 1)

  const handleYearChange = (value: string) => {
    navigateTo(buildReportSearch(Number(value), basis))
  }

  const handleBasisChange = (checked: boolean) => {
    if (year === null) return
    navigateTo(buildReportSearch(year, checked ? 'approved' : 'all'))
  }

  if (isLoading) {
    return (
      <div className="flex w-full flex-col gap-4">
        <PageHeader title="Yearly report" description={reportDescription(basis)} />
        <div
          role="status"
          aria-busy="true"
          className="flex flex-col gap-3 rounded-card border border-border-subtle bg-surface p-6 shadow-card"
        >
          <span className="sr-only">Loading report...</span>
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
        <PageHeader title="Yearly report" description={reportDescription(basis)} />
        <div className="flex flex-col gap-4 rounded-card border border-border-subtle bg-surface p-6 shadow-card">
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
          <button
            type="button"
            onClick={retry}
            className="inline-flex h-11 w-fit min-h-[44px] items-center justify-center rounded-control border border-border bg-white px-3.5 text-sm font-semibold text-ink hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:h-10"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (!years || years.length === 0) {
    return (
      <div className="flex w-full flex-col gap-4">
        <PageHeader title="Yearly report" description={reportDescription(basis)} />
        <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-6">
          <p className="text-sm text-ink-muted">
            No dated receipts yet. Upload and approve receipts to see the report.
          </p>
        </div>
        <ExportCard year={null} basis="all" apartments={exportApartments} />
      </div>
    )
  }

  if (year === null || !report) {
    return null
  }

  const monthlyTables = buildMonthlyCurrencyTables(report.apartments)

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader title="Yearly report" description={reportDescription(basis)} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex flex-col gap-1">
          <label htmlFor="report-year-select" className="text-sm font-medium text-ink">
            Year
          </label>
          <select
            id="report-year-select"
            value={year}
            onChange={(e) => handleYearChange(e.target.value)}
            className="h-11 min-h-[44px] rounded-md border border-border bg-surface px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>

        <label className="flex min-h-[44px] items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={basis === 'approved'}
            onChange={(e) => handleBasisChange(e.target.checked)}
            className="h-5 w-5 rounded border-border text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          />
          Only count receipts I approved
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {report.apartments.map((apartment) => (
          <ApartmentSummaryCard
            key={apartment.apartment_id}
            apartment={apartment}
            year={year}
            basis={basis}
          />
        ))}
        <OverallSummaryCard overall={report.overall} year={year} basis={basis} />
      </div>

      {monthlyTables.length > 0 && (
        // Not a card of its own: a closed <details> right under the
        // summary cards it breaks down.
        <details>
          <summary className={DETAILS_SUMMARY_CLASSES}>Show by month</summary>
          <div className="mt-4 flex flex-col gap-4">
            {monthlyTables.map(({ currency, months, cells }) => (
              <MonthlyCurrencyTable
                key={currency}
                currency={currency}
                months={months}
                cells={cells}
                apartments={report.apartments}
                isSmallScreen={isSmallScreen}
                showCurrencyHeading={monthlyTables.length > 1}
              />
            ))}
          </div>
        </details>
      )}

      <ExportCard
        year={year}
        basis={basis}
        apartments={exportApartments}
        openItems={exportOpenItems(report, basis)}
      />

      <p className="text-sm text-ink-muted">{VAT_FOOTNOTE}</p>
    </div>
  )
}

export default ReceiptReport
