import { useEffect, useRef } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import type { ReceiptStatus } from './api/types'
import { ApartmentDot } from './components/ui/ApartmentTone'
import Select from './components/ui/Select'

/** Shared by ReceiptHistory and the Items view: the apartment tab bar plus
 * the Year/Status selects. Pure presentation + URL-agnostic callbacks --
 * each page still owns its own URL-building and data-loading. */

export const YEAR_PATTERN = /^\d{4}$/
export const NONE_FILTER_VALUE = 'none'
export const STATUS_OPTIONS: { value: ReceiptStatus; label: string }[] = [
  { value: 'needs_review', label: 'Needs review' },
  { value: 'approved', label: 'Approved' },
]
const ALLOWED_STATUS_VALUES = STATUS_OPTIONS.map((option) => option.value)

/** A valid year is exactly 4 digits, or the "none" sentinel -- anything
 * else is treated as if it weren't in the URL at all. */
export function effectiveYear(rawYear: string | null): string | null {
  if (rawYear === null) return null
  if (rawYear === NONE_FILTER_VALUE) return NONE_FILTER_VALUE
  return YEAR_PATTERN.test(rawYear) ? rawYear : null
}

export function effectiveStatus(rawStatus: string | null): ReceiptStatus | null {
  if (rawStatus === null) return null
  return (ALLOWED_STATUS_VALUES as string[]).includes(rawStatus) ? (rawStatus as ReceiptStatus) : null
}

export interface FilterTab {
  id: string | null
  label: string
  /** Overrides the tab's accessible name and `title` tooltip, for when the
   * visible `label` doesn't spell out the full name on its own (e.g.
   * History's apartment tabs show a short name + count, but the
   * accessible name and tooltip stay the full apartment name). Falls back
   * to `label` when omitted -- the Items view's tabs (no counts) pass no
   * `accessibleName`, so their behavior is completely unchanged. */
  accessibleName?: string
}

interface ReceiptFiltersProps {
  tabs: FilterTab[]
  selectedApartmentId: string | null
  onSelectApartment: (apartmentId: string | null) => void
  /** sessionStorage key used to restore tab focus across the full remount
   * a navigation causes -- each page passes its own, since they remount
   * independently. */
  focusSessionKey: string
  years: number[]
  hasUndated: boolean
  yearValue: string | null
  onYearChange: (value: string) => void
  yearSelectId: string
  statusValue: ReceiptStatus | null
  onStatusChange: (value: string) => void
  statusSelectId: string
  /** The third control of the filter row (both pages: "Sort by"). Year,
   * Status and this one are three equal columns from md up, stacked below. */
  extraFilter?: ReactNode
  /** A full-width row between the tabs and the filter row (Items: the
   * search form). */
  topRow?: ReactNode
}

function ReceiptFilters({
  tabs,
  selectedApartmentId,
  onSelectApartment,
  focusSessionKey,
  years,
  hasUndated,
  yearValue,
  onYearChange,
  yearSelectId,
  statusValue,
  onStatusChange,
  statusSelectId,
  extraFilter,
  topRow,
}: ReceiptFiltersProps) {
  const tabListRef = useRef<HTMLDivElement>(null)

  const yearSelect = (
    <Select
      id={yearSelectId}
      label="Year"
      value={yearValue ?? ''}
      active={yearValue !== null}
      onChange={onYearChange}
      options={[
        { value: '', label: 'All years' },
        ...years.map((y) => ({ value: String(y), label: String(y) })),
        ...(hasUndated ? [{ value: NONE_FILTER_VALUE, label: 'No valid date' }] : []),
      ]}
    />
  )
  const statusSelect = (
    <Select
      id={statusSelectId}
      label="Status"
      value={statusValue ?? ''}
      active={statusValue !== null}
      onChange={onStatusChange}
      options={[{ value: '', label: 'All' }, ...STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))]}
    />
  )
  const selectedTabIndex = tabs.findIndex((tab) => tab.id === selectedApartmentId)

  // Restores focus to the tab the user just moved to with the arrow keys,
  // across the full remount a navigation causes -- this component only
  // mounts once its page has finished loading and the tab bar actually
  // exists in the DOM, so a plain mount-only effect is enough.
  useEffect(() => {
    const stored = window.sessionStorage.getItem(focusSessionKey)
    if (stored === null) return
    window.sessionStorage.removeItem(focusSessionKey)
    const index = Number(stored)
    const buttons = tabListRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    buttons?.[index]?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = tabs.length - 1

    if (nextIndex !== null) {
      event.preventDefault()
      window.sessionStorage.setItem(focusSessionKey, String(nextIndex))
      onSelectApartment(tabs[nextIndex].id)
    }
  }

  return (
    <>
      <div
        ref={tabListRef}
        role="tablist"
        aria-label="Apartment"
        className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1"
      >
        {tabs.map((tab, index) => {
          const selected = index === selectedTabIndex
          return (
            <button
              key={tab.id ?? 'all'}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-label={tab.accessibleName ?? undefined}
              title={tab.accessibleName ?? undefined}
              tabIndex={selected ? 0 : -1}
              onClick={() => onSelectApartment(tab.id)}
              onKeyDown={(e) => handleTabKeyDown(e, index)}
              className={`inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                selected ? 'bg-white font-semibold text-brand shadow-sm' : 'font-medium text-ink-muted'
              }`}
            >
              {/* An apartment tab (any tab but "All apartments") gets its
                  apartment's colour dot; decorative, the label names it. */}
              {tab.id !== null && <ApartmentDot apartmentId={tab.id} />}
              {tab.label}
            </button>
          )
        })}
      </div>

      {topRow}

      {/* Year, Status and the extra control (Sort by) as three equal
          columns from md up, filling the row to the list's right edge;
          stacked below md. The same row on History and Items. */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {yearSelect}
        {statusSelect}
        {extraFilter}
      </div>
    </>
  )
}

export default ReceiptFilters
