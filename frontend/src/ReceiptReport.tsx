import { useEffect, useState, type ReactNode } from 'react'
import { ApiError } from './api/ApiError'
import { getReportYears } from './api/getReportYears'
import { getYearlyReport } from './api/getYearlyReport'
import type { ExportStyle } from './api/reportExportUrl'
import { reportExportCsvUrl, reportExportZipUrl } from './api/reportExportUrl'
import type {
  Apartment,
  ReportApartmentSummary,
  ReportCurrencyTotal,
  ReportDuplicateGroup,
  ReportMonth,
  YearlyReport,
} from './api/types'
import { apartmentShortName } from './format/apartmentShortName'
import { apartmentToneClasses } from './format/apartmentTone'
import { formatDisplayDate } from './format/formatDisplayDate'
import { ApartmentDot } from './components/ui/ApartmentTone'
import Card from './components/ui/Card'
import PageHeader from './components/ui/PageHeader'
import Select from './components/ui/Select'
import Skeleton from './components/ui/Skeleton'
import { formatMoneyFromString, currencySymbol } from './components/ui/formatMoney'
import { useApartments } from './hooks/useApartments'
import { useMediaQuery } from './hooks/useMediaQuery'
import { navigateTo, isPlainLeftClick } from './navigation'
import { DownloadIcon } from './ReceiptFileViewer'
import { ChevronIcon } from './ReceiptUpload'
import { exportOpenItems, type ExportOpenItems } from './reportOpenItems'

/** Every saved receipt counts (the backend's default basis, "all"); the
 * former "Only count receipts I approved" toggle was removed -- see
 * docs/design.md "Report: year in the header, no basis toggle". */
const REPORT_DESCRIPTION = 'Spending per apartment, from every saved receipt.'
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
}

function readUrlParams(): ReportUrlParams {
  const params = new URLSearchParams(window.location.search)
  return {
    year: params.get('year'),
  }
}

/** A leftover `basis` param (from a bookmark made while the toggle
 * existed) is ignored and dropped from the address bar -- `replaceState`,
 * so no extra history entry and no remount. */
function dropBasisParam() {
  const params = new URLSearchParams(window.location.search)
  if (!params.has('basis')) return
  params.delete('basis')
  window.history.replaceState(window.history.state, '', `${window.location.pathname}?${params.toString()}`)
}

function buildReportSearch(year: number): string {
  const params = new URLSearchParams()
  params.set('view', 'report')
  params.set('year', String(year))
  return `?${params.toString()}`
}

/** Renders one currency row ("€1,234.56 Β· 7 receipts" -- the amount
 * large/tabular/right-aligned, as the summary cards call for). */
/** The two text colours of a summary card: `strong` for the name and
 * amount, `muted` for the receipt count -- complete static class strings. */
interface SummaryCardText {
  strong: string
  muted: string
}

/** Text on the solid slate-700 "Both apartments" card. */
const BOTH_CARD_TEXT: SummaryCardText = { strong: 'text-white', muted: 'text-white/90' }

function CurrencyRow({ entry, text }: { entry: ReportCurrencyTotal; text: SummaryCardText }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className={`text-sm ${text.muted}`}>
        {entry.receipt_count} {entry.receipt_count === 1 ? 'receipt' : 'receipts'}
      </span>
      <span className={`text-right text-xl font-semibold tabular-nums ${text.strong}`}>
        {formatMoneyFromString(entry.total, entry.currency)}
      </span>
    </div>
  )
}

function emptyApartmentText(year: number): string {
  return `No receipts in ${year}.`
}

function ApartmentSummaryCard({ apartment, year }: { apartment: ReportApartmentSummary; year: number }) {
  // The apartment's tone as the whole card's surface (solid, the same
  // colour as its dot) with white text; an unknown apartment gets the plain
  // card with ink text.
  const tone = apartmentToneClasses(apartment.apartment_id)
  const text: SummaryCardText = { strong: tone.cardText, muted: tone.cardMutedText }
  return (
    <Card surface={tone.card} className="flex flex-col gap-3" title={apartment.apartment_name}>
      <h2 className={`text-base font-semibold ${text.strong}`} title={apartment.apartment_name}>
        {apartmentShortName(apartment.apartment_name) ?? apartment.apartment_name}
      </h2>
      {apartment.by_currency.length === 0 ? (
        <p className={`text-sm ${text.muted}`}>{emptyApartmentText(year)}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {apartment.by_currency.map((entry) => (
            <CurrencyRow key={entry.currency} entry={entry} text={text} />
          ))}
        </div>
      )}
    </Card>
  )
}

function OverallSummaryCard({ overall, year }: { overall: ReportCurrencyTotal[]; year: number }) {
  return (
    <Card variant="emphasis" className="flex flex-col gap-3">
      <h2 className={`text-base font-semibold ${BOTH_CARD_TEXT.strong}`}>Both apartments</h2>
      {overall.length === 0 ? (
        <p className={`text-sm ${BOTH_CARD_TEXT.muted}`}>{emptyApartmentText(year)}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {overall.map((entry) => (
            <CurrencyRow key={entry.currency} entry={entry} text={BOTH_CARD_TEXT} />
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
 * apartment shows a dash. The "Both apartments" column comes straight
 * from the backend: `overall_months` (per month) and `overall` (the
 * Total) -- never summed from the two apartments here. */
function buildMonthlyCurrencyTables(
  apartments: ReportApartmentSummary[],
  overallMonths: ReportMonth[],
  overall: ReportCurrencyTotal[],
) {
  const currencies = new Set<string>()
  const cells: Record<string, Record<number, Record<string, ReportCurrencyTotal>>> = {}
  const bothCells: Record<string, Record<number, ReportCurrencyTotal>> = {}

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
  for (const monthEntry of overallMonths) {
    for (const currencyTotal of monthEntry.by_currency) {
      currencies.add(currencyTotal.currency)
      bothCells[currencyTotal.currency] ??= {}
      bothCells[currencyTotal.currency][monthEntry.month] = currencyTotal
    }
  }

  return Array.from(currencies)
    .sort()
    .map((currency) => ({
      currency,
      months: ALL_MONTHS,
      cells: cells[currency] ?? {},
      both: {
        months: bothCells[currency] ?? {},
        total: overall.find((entry) => entry.currency === currency),
      },
    }))
}

/** The "Both apartments" column's data for one currency, as the backend
 * sent it: per month from `overall_months`, the Total from `overall`. */
export interface BothApartmentsColumn {
  months: Record<number, ReportCurrencyTotal>
  total: ReportCurrencyTotal | undefined
}

const BOTH_APARTMENTS_LABEL = 'Both apartments'

/** An empty month/total cell: a muted dash, read as "No receipts". */
function EmptyAmount() {
  return (
    <span className="text-ink-muted">
      <span aria-hidden="true">—</span>
      <span className="sr-only">No receipts</span>
    </span>
  )
}

function AmountOrDash({ entry }: { entry: ReportCurrencyTotal | undefined }) {
  return entry ? <>{formatMoneyFromString(entry.total, entry.currency)}</> : <EmptyAmount />
}

/** The monthly table's column widths, computed from the column count so
 * they always add up to 100%: with a "Both apartments" column every column
 * (Month, each apartment, Both) gets an equal share -- 25% each for two
 * apartments; without it, Month takes 40% and the apartments share the
 * other 60% equally. Used as `<col style={{ width }}>`, since a Tailwind
 * width class can't be built from a number. Layout only, never money. */
const MONTH_COLUMN_PERCENT = 40

function monthlyColumnWidths(apartmentCount: number, hasBoth: boolean): { month: string; value: string } {
  if (hasBoth) {
    const equal = `${100 / (apartmentCount + 2)}%`
    return { month: equal, value: equal }
  }
  const valuePercent = apartmentCount > 0 ? (100 - MONTH_COLUMN_PERCENT) / apartmentCount : 0
  return { month: `${MONTH_COLUMN_PERCENT}%`, value: `${valuePercent}%` }
}

/** One currency's monthly breakdown: Month, then one column per
 * apartment (its tone dot in the header), then -- when `both` is given --
 * a "Both apartments" column (no dot), then a "Total" row. Each
 * apartment's total comes straight from its summary (`by_currency`) and
 * Both's from `overall` (the same numbers as the summary cards); Both's
 * months come from `overall_months` -- nothing is summed here. A month
 * with no data in any column is muted. A full-width, `table-fixed` table
 * in a Card from `sm` up (widths from `monthlyColumnWidths`; values
 * right-aligned); month cards plus a Total card below `sm`, each with a
 * "Both apartments" line too. Exported for the style guide. */
export function MonthlyCurrencyTable({
  currency,
  months,
  cells,
  apartments,
  isSmallScreen,
  showCurrencyHeading,
  both,
}: {
  currency: string
  months: number[]
  cells: Record<number, Record<string, ReportCurrencyTotal>>
  apartments: ReportApartmentSummary[]
  isSmallScreen: boolean
  /** Only when the year has more than one currency. */
  showCurrencyHeading: boolean
  /** The "Both apartments" column (the page always passes it). */
  both?: BothApartmentsColumn
}) {
  const entryFor = (month: number, apartmentId: string) => cells[month]?.[apartmentId]
  const totalFor = (apartment: ReportApartmentSummary) =>
    apartment.by_currency.find((entry) => entry.currency === currency)
  const isEmptyMonth = (month: number) =>
    apartments.every((apartment) => !entryFor(month, apartment.apartment_id)) && !both?.months[month]
  const shortName = (apartment: ReportApartmentSummary) =>
    apartmentShortName(apartment.apartment_name) ?? apartment.apartment_name
  const columnWidths = monthlyColumnWidths(apartments.length, both !== undefined)
  const heading = showCurrencyHeading && (
    <h3 className="text-sm font-semibold text-ink">{currencySymbol(currency)}</h3>
  )

  if (isSmallScreen) {
    return (
      <div className="flex flex-col gap-2">
        {heading}
        <ul className="flex flex-col gap-2">
          {months.map((month) => (
            <li
              key={month}
              className={`rounded-md border border-border p-3 text-sm ${isEmptyMonth(month) ? 'text-ink-muted' : 'text-ink'}`}
            >
              <p className="font-medium">{MONTH_NAMES[month - 1]}</p>
              <dl className="mt-1 flex flex-col gap-1">
                {apartments.map((apartment) => (
                  <div key={apartment.apartment_id} className="flex items-baseline justify-between gap-2">
                    <dt className="flex items-center gap-1.5 text-ink-muted" title={apartment.apartment_name}>
                      <ApartmentDot apartmentId={apartment.apartment_id} />
                      {shortName(apartment)}
                    </dt>
                    <dd className="tabular-nums">
                      <AmountOrDash entry={entryFor(month, apartment.apartment_id)} />
                    </dd>
                  </div>
                ))}
                {both && (
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="text-ink-muted">{BOTH_APARTMENTS_LABEL}</dt>
                    <dd className="tabular-nums">
                      <AmountOrDash entry={both.months[month]} />
                    </dd>
                  </div>
                )}
              </dl>
            </li>
          ))}
          <li className="rounded-md border border-border p-3 text-sm font-semibold text-ink">
            <p>Total</p>
            <dl className="mt-1 flex flex-col gap-1">
              {apartments.map((apartment) => (
                <div key={apartment.apartment_id} className="flex items-baseline justify-between gap-2">
                  <dt className="flex items-center gap-1.5" title={apartment.apartment_name}>
                    <ApartmentDot apartmentId={apartment.apartment_id} />
                    {shortName(apartment)}
                  </dt>
                  <dd className="tabular-nums">
                    <AmountOrDash entry={totalFor(apartment)} />
                  </dd>
                </div>
              ))}
              {both && (
                <div className="flex items-baseline justify-between gap-2">
                  <dt>{BOTH_APARTMENTS_LABEL}</dt>
                  <dd className="tabular-nums">
                    <AmountOrDash entry={both.total} />
                  </dd>
                </div>
              )}
            </dl>
          </li>
        </ul>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {heading}
      <Card className="overflow-hidden">
        <div className="-m-5 overflow-x-auto sm:-m-6">
          <table className="w-full table-fixed text-left text-sm">
            <caption className="sr-only">Monthly totals in {currencySymbol(currency)}</caption>
            <colgroup>
              <col style={{ width: columnWidths.month }} />
              {apartments.map((apartment) => (
                <col key={apartment.apartment_id} style={{ width: columnWidths.value }} />
              ))}
              {both && <col style={{ width: columnWidths.value }} />}
            </colgroup>
            <thead>
              <tr className="border-b border-border-subtle text-xs text-ink-muted">
                <th scope="col" className="py-2 pl-4 pr-2 font-medium">
                  Month
                </th>
                {apartments.map((apartment) => (
                  <th
                    key={apartment.apartment_id}
                    scope="col"
                    className="whitespace-nowrap py-2 pl-2 pr-4 text-right font-medium"
                    title={apartment.apartment_name}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <ApartmentDot apartmentId={apartment.apartment_id} />
                      {shortName(apartment)}
                    </span>
                  </th>
                ))}
                {both && (
                  <th scope="col" className="whitespace-nowrap py-2 pl-2 pr-4 text-right font-medium">
                    {BOTH_APARTMENTS_LABEL}
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {months.map((month) => (
                <tr
                  key={month}
                  className={`border-t border-border-subtle ${isEmptyMonth(month) ? 'text-ink-muted' : 'text-ink'}`}
                >
                  <td className="py-2 pl-4 pr-2">{MONTH_NAMES[month - 1]}</td>
                  {apartments.map((apartment) => (
                    <td
                      key={apartment.apartment_id}
                      className="whitespace-nowrap py-2 pl-2 pr-4 text-right tabular-nums"
                    >
                      <AmountOrDash entry={entryFor(month, apartment.apartment_id)} />
                    </td>
                  ))}
                  {both && (
                    <td className="whitespace-nowrap py-2 pl-2 pr-4 text-right tabular-nums">
                      <AmountOrDash entry={both.months[month]} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border font-semibold text-ink">
                <td className="py-2 pl-4 pr-2">Total</td>
                {apartments.map((apartment) => (
                  <td
                    key={apartment.apartment_id}
                    className="whitespace-nowrap py-2 pl-2 pr-4 text-right tabular-nums"
                  >
                    <AmountOrDash entry={totalFor(apartment)} />
                  </td>
                ))}
                {both && (
                  <td className="whitespace-nowrap py-2 pl-2 pr-4 text-right tabular-nums">
                    <AmountOrDash entry={both.total} />
                  </td>
                )}
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </div>
  )
}

/** "Show by month": the same text-style disclosure as Upload's "How it
 * works and tips" -- a <summary> with a chevron that rotates open. */
const DISCLOSURE_SUMMARY_CLASSES =
  'flex min-h-[44px] w-fit cursor-pointer select-none list-none items-center gap-1.5 rounded-sm text-sm ' +
  'font-medium text-ink [&::-webkit-details-marker]:hidden focus-visible:outline focus-visible:outline-2 ' +
  'focus-visible:outline-offset-2 focus-visible:outline-brand sm:min-h-0'

const DISCLOSURE_CHEVRON_CLASSES =
  'h-4 w-4 flex-shrink-0 text-ink-muted transition-transform duration-150 motion-reduce:transition-none ' +
  'group-open:rotate-90'

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

function exportPeriodText(year: number): string {
  return `${year}, all receipts`
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
  apartments: Apartment[] | null
  /** What is still open for this year; the short note above the
   * buttons is built from it. Omitted (or all zero) -> no note at all. */
  openItems?: ExportOpenItems
}

/** The backend only ever sends an already-normalized purchase_date for a
 * possible-duplicate group (every receipt in it is counted, which
 * requires a valid date), so `formatDisplayDate`'s "missing" case never
 * actually happens -- this just satisfies the return type safely. */
function displayDateText(value: string): string {
  const display = formatDisplayDate(value)
  return display.kind === 'missing' ? 'Not detected' : display.text
}

function receiptHref(receiptId: string): string {
  return `/?receipt=${receiptId}`
}

const REPORT_LINK_CLASSES =
  'font-medium text-ink underline hover:text-brand focus-visible:text-brand focus-visible:outline ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand'

/** A link to a saved receipt; a plain click opens it in place, any
 * modified click is left to the browser (new tab). */
function ReceiptLink({ receiptId, children }: { receiptId: string; children: ReactNode }) {
  return (
    <a
      href={receiptHref(receiptId)}
      onClick={(e) => {
        if (!isPlainLeftClick(e)) {
          return
        }
        e.preventDefault()
        navigateTo(receiptHref(receiptId).slice(1))
      }}
      className={REPORT_LINK_CLASSES}
    >
      {children}
    </a>
  )
}

/** One line per possible-duplicate group (store, date, total) with an
 * "Open N" link per receipt -- restored from the former Report list. */
function DuplicatesList({ groups }: { groups: ReportDuplicateGroup[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {groups.map((group, index) => (
        <li key={index} className="rounded-md border border-border-subtle p-3 text-sm">
          <p className="font-medium text-ink">
            {group.store_name}, {displayDateText(group.purchase_date)},{' '}
            {formatMoneyFromString(group.total, group.currency)}
          </p>
          <p className="mt-1 flex flex-wrap gap-2">
            {group.receipt_ids.map((receiptId, receiptIndex) => (
              <ReceiptLink key={receiptId} receiptId={receiptId}>
                Open {receiptIndex + 1}
              </ReceiptLink>
            ))}
          </p>
          <p className="mt-1 text-ink-muted">Both are counted in the totals until you delete one.</p>
        </li>
      ))}
    </ul>
  )
}

/** The short "check before you send" note above the export buttons: one
 * line "N not reviewed · M with warnings · K possible duplicates" (parts
 * that are 0 left out) with a right-aligned "Review them"
 * link while anything is unreviewed, then one line per non-zero "not in
 * these totals" bucket, then (when there are any) a closed "Show possible
 * duplicates" list. Every line starts with the warning icon and says what
 * it means in words. Nothing at all when everything is zero. */
function ExportNote({ year, items }: { year: number; items: ExportOpenItems }) {
  const parts: string[] = []
  if (items.notReviewed > 0) {
    parts.push(`${items.notReviewed} not reviewed`)
  }
  if (items.withWarnings > 0) {
    parts.push(`${items.withWarnings} with warnings`)
  }
  if (items.possibleDuplicates > 0) {
    parts.push(`${items.possibleDuplicates} possible ${items.possibleDuplicates === 1 ? 'duplicate' : 'duplicates'}`)
  }
  const anything =
    parts.length > 0 || items.undated > 0 || items.noTotal > 0 || items.noCurrency > 0 || items.noApartment > 0
  if (!anything) {
    return null
  }

  return (
    <div className="flex flex-col gap-2">
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
      {items.possibleDuplicates > 0 && (
        <details>
          <summary className={DETAILS_SUMMARY_CLASSES}>Show possible duplicates</summary>
          <div className="mt-2">
            <DuplicatesList groups={items.duplicateGroups} />
          </div>
        </details>
      )}
    </div>
  )
}

export function ExportCard({ year, apartments, openItems }: ExportCardProps) {
  const [apartmentId, setApartmentId] = useState('')
  const [style, setStyle] = useState<ExportStyle>('excel_de')

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-base font-semibold text-ink">For your tax advisor</h2>

      {year !== null && openItems && <ExportNote year={year} items={openItems} />}

      {exportLinks(year, style, apartmentId)}

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
function exportLinks(year: number | null, style: ExportStyle, apartmentId: string) {
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
              href={reportExportZipUrl({ year, style, apartmentId: apartmentId || undefined })}
              className={EXPORT_PRIMARY_LINK_CLASSES}
            >
              <DownloadIcon />
              Download ZIP (CSV and PDFs)
            </a>
            <a
              href={reportExportCsvUrl({ year, style, apartmentId: apartmentId || undefined })}
              className={EXPORT_SECONDARY_LINK_CLASSES}
            >
              <DownloadIcon />
              Download CSV only
            </a>
            <span className="text-sm text-ink-muted">{exportPeriodText(year)}</span>
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

  const [years, setYears] = useState<number[] | null>(null)
  const [year, setYear] = useState<number | null>(null)
  const [report, setReport] = useState<YearlyReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [reloadToken, setReloadToken] = useState(0)

  const isSmallScreen = useMediaQuery('(max-width: 639px)')
  const { apartments: exportApartments } = useApartments(true)

  useEffect(() => {
    dropBasisParam()
  }, [])

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

        const reportResponse = await getYearlyReport({ year: effectiveYearValue })
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
    // urlParams are captured once per mount (the whole page remounts
    // on any navigation).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadToken])

  const retry = () => setReloadToken((n) => n + 1)

  const handleYearChange = (value: string) => {
    navigateTo(buildReportSearch(Number(value)))
  }

  if (isLoading) {
    return (
      <div className="flex w-full flex-col gap-4">
        <PageHeader title="Yearly report" description={REPORT_DESCRIPTION} />
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
        <PageHeader title="Yearly report" description={REPORT_DESCRIPTION} />
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
        <PageHeader title="Yearly report" description={REPORT_DESCRIPTION} />
        <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-6">
          <p className="text-sm text-ink-muted">
            No dated receipts yet. Upload and approve receipts to see the report.
          </p>
        </div>
        <ExportCard year={null} apartments={exportApartments} />
      </div>
    )
  }

  if (year === null || !report) {
    return null
  }

  const monthlyTables = buildMonthlyCurrencyTables(report.apartments, report.overall_months ?? [], report.overall)

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader
        title="Yearly report"
        description={REPORT_DESCRIPTION}
        actions={
          // The shared Select (native below sm), a fixed width so the
          // header doesn't shift between years.
          <div className="w-40">
            <Select
              id="report-year-select"
              label="Year"
              value={String(year)}
              onChange={handleYearChange}
              options={years.map((y) => ({ value: String(y), label: String(y) }))}
            />
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {report.apartments.map((apartment) => (
          <ApartmentSummaryCard key={apartment.apartment_id} apartment={apartment} year={year} />
        ))}
        <OverallSummaryCard overall={report.overall} year={year} />
      </div>

      {monthlyTables.length > 0 && (
        // A closed <details> right under the summary cards it breaks
        // down; once open, each currency's table sits in its own Card.
        <details className="group">
          <summary className={DISCLOSURE_SUMMARY_CLASSES}>
            <ChevronIcon className={DISCLOSURE_CHEVRON_CLASSES} />
            Show by month
          </summary>
          <div className="mt-4 flex flex-col gap-4">
            {monthlyTables.map(({ currency, months, cells, both }) => (
              <MonthlyCurrencyTable
                key={currency}
                currency={currency}
                months={months}
                cells={cells}
                apartments={report.apartments}
                isSmallScreen={isSmallScreen}
                showCurrencyHeading={monthlyTables.length > 1}
                both={both}
              />
            ))}
          </div>
        </details>
      )}

      <ExportCard year={year} apartments={exportApartments} openItems={exportOpenItems(report)} />

      <p className="text-sm text-ink-muted">{VAT_FOOTNOTE}</p>
    </div>
  )
}

export default ReceiptReport
