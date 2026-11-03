import { useEffect, useRef } from 'react'
import type { KeyboardEvent } from 'react'
import type { ReceiptStatus } from './api/types'

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
}: ReceiptFiltersProps) {
  const tabListRef = useRef<HTMLDivElement>(null)
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
              tabIndex={selected ? 0 : -1}
              onClick={() => onSelectApartment(tab.id)}
              onKeyDown={(e) => handleTabKeyDown(e, index)}
              className={`min-h-[44px] flex-1 rounded-md px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                selected ? 'bg-white font-semibold text-brand shadow-sm' : 'font-medium text-ink-muted'
              }`}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor={yearSelectId} className="text-sm font-medium text-ink">
            Year
          </label>
          <select
            id={yearSelectId}
            value={yearValue ?? ''}
            onChange={(e) => onYearChange(e.target.value)}
            className="h-11 min-h-[44px] rounded-md border border-border bg-surface px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <option value="">All years</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
            {hasUndated && <option value={NONE_FILTER_VALUE}>No valid date</option>}
          </select>
        </div>

        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor={statusSelectId} className="text-sm font-medium text-ink">
            Status
          </label>
          <select
            id={statusSelectId}
            value={statusValue ?? ''}
            onChange={(e) => onStatusChange(e.target.value)}
            className="h-11 min-h-[44px] rounded-md border border-border bg-surface px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <option value="">All</option>
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </>
  )
}

export default ReceiptFilters
