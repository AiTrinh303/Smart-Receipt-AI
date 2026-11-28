import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useMediaQuery } from '../../hooks/useMediaQuery'

export interface SelectOption {
  value: string
  label: string
}

interface SelectProps {
  /** id of the control (the button, or the native <select> below `sm`);
   * the visible <label> points at it, so getByLabelText/clicking the label
   * both work. */
  id: string
  label: string
  value: string
  options: SelectOption[]
  /** Called once per change of value -- never when the current value is
   * chosen again (same as a native <select>'s change event). */
  onChange: (value: string) => void
  /** Only for `?view=styleguide`'s static "open" sample; the app never
   * passes it. */
  defaultOpen?: boolean
  /** True while this filter's value is not its default ("All years",
   * "All"): the closed control then gets `border-brand bg-brand-soft`.
   * Not colour alone -- the value text itself says which filter is set.
   * Never passed for "Sort by" (an ordering, not a filter). */
  active?: boolean
}

const CONTROL_BASE_CLASSES =
  'h-11 min-h-[44px] w-full rounded-md border px-3 text-sm text-ink ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand'
/** Complete static strings (never built from a variable): the default
 * look, and the active-filter look (brand border 5.62:1 on brand-soft, 6.01:1 on
 * the page; ink text 15.97:1 and the chevron 6.78:1 on brand-soft). */
const CONTROL_SURFACE_CLASSES = {
  inactive: 'border-border bg-surface',
  active: 'border-brand bg-brand-soft',
} as const

function controlClasses(active: boolean): string {
  return `${CONTROL_BASE_CLASSES} ${active ? CONTROL_SURFACE_CLASSES.active : CONTROL_SURFACE_CLASSES.inactive}`
}

/** How long typed characters keep adding up to one type-ahead search. */
const TYPEAHEAD_RESET_MS = 500

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className={`h-4 w-4 flex-shrink-0 text-ink-muted transition-transform duration-150 motion-reduce:transition-none ${
        open ? 'rotate-180' : ''
      }`}
      fill="none"
    >
      <path d="M5 7.5l5 5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 flex-shrink-0 text-brand" fill="none">
      <path d="M4 10.5l3.5 3.5L16 5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** A select-only combobox (WAI-ARIA APG "select-only combobox"): a button
 * showing the current value that opens a listbox popover. Focus stays on
 * the button the whole time; `aria-activedescendant` points at the
 * highlighted option. Keyboard: Enter/Space/Alt+Down (and Up/Down/Home/
 * End) open; while open, Up/Down/Home/End and type-ahead move the
 * highlight, Enter or Space selects, Escape closes without a change, Tab
 * closes and moves on. A click outside closes it. The selected option has
 * a check icon, medium weight and `aria-selected` (never colour alone);
 * the highlighted one has a stronger background.
 *
 * Below `sm` the native <select> is rendered instead (same options, same
 * onChange) -- only one of the two is ever mounted. */
function Select({ id, label, value, options, onChange, defaultOpen = false, active = false }: SelectProps) {
  const isSmallScreen = useMediaQuery('(max-width: 639px)')
  const labelId = `${id}-label`

  return (
    <div className="flex flex-col gap-1">
      <label id={labelId} htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      {isSmallScreen ? (
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={controlClasses(active)}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <ComboboxSelect
          id={id}
          labelId={labelId}
          value={value}
          options={options}
          onChange={onChange}
          defaultOpen={defaultOpen}
          active={active}
        />
      )}
    </div>
  )
}

function ComboboxSelect({
  id,
  labelId,
  value,
  options,
  onChange,
  defaultOpen,
  active,
}: {
  id: string
  labelId: string
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  defaultOpen: boolean
  active: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  )
  const [activeIndex, setActiveIndex] = useState(selectedIndex)
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listboxRef = useRef<HTMLUListElement>(null)
  const typeahead = useRef({ text: '', timer: 0 })

  const listboxId = `${id}-listbox`
  const optionId = (index: number) => `${id}-option-${index}`
  const selected = options.find((option) => option.value === value)

  const openAt = (index: number) => {
    setActiveIndex(Math.min(Math.max(index, 0), options.length - 1))
    setOpen(true)
  }

  const close = () => setOpen(false)

  const choose = (index: number) => {
    const option = options[index]
    setOpen(false)
    buttonRef.current?.focus()
    if (option && option.value !== value) {
      onChange(option.value)
    }
  }

  // A click anywhere outside closes the listbox (no change).
  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [open])

  // Keep the highlighted option in view inside the scrollable listbox.
  useEffect(() => {
    if (!open) return
    const element = document.getElementById(optionId(activeIndex))
    element?.scrollIntoView?.({ block: 'nearest' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeIndex])

  useEffect(() => () => window.clearTimeout(typeahead.current.timer), [])

  /** Type-ahead: the typed characters (within TYPEAHEAD_RESET_MS) match the
   * start of an option label, searching onward from the highlighted one. */
  const findByTypeahead = (char: string): number | null => {
    const state = typeahead.current
    window.clearTimeout(state.timer)
    state.text += char.toLowerCase()
    state.timer = window.setTimeout(() => {
      state.text = ''
    }, TYPEAHEAD_RESET_MS)
    const start = open ? activeIndex : selectedIndex
    // The same letter typed again ("t", "t", ...) cycles through the
    // options starting with it; anything else matches the whole prefix.
    const sameLetter = state.text.split('').every((letter) => letter === state.text[0])
    const query = sameLetter ? state.text[0] : state.text
    const searchFrom = query.length === 1 ? start + 1 : start
    for (let offset = 0; offset < options.length; offset += 1) {
      const index = (searchFrom + offset) % options.length
      if (options[index].label.toLowerCase().startsWith(query)) {
        return index
      }
    }
    return null
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const { key, altKey } = event
    const isPrintable = key.length === 1 && key !== ' ' && !event.ctrlKey && !event.metaKey && !altKey

    if (!open) {
      if (key === 'Enter' || key === ' ' || key === 'ArrowDown' || key === 'ArrowUp') {
        event.preventDefault()
        openAt(selectedIndex)
      } else if (key === 'Home') {
        event.preventDefault()
        openAt(0)
      } else if (key === 'End') {
        event.preventDefault()
        openAt(options.length - 1)
      } else if (isPrintable) {
        const match = findByTypeahead(key)
        if (match !== null) openAt(match)
      }
      return
    }

    if (key === 'ArrowDown' && !altKey) {
      event.preventDefault()
      setActiveIndex((index) => Math.min(index + 1, options.length - 1))
    } else if (key === 'ArrowUp' && altKey) {
      event.preventDefault()
      choose(activeIndex)
    } else if (key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => Math.max(index - 1, 0))
    } else if (key === 'Home') {
      event.preventDefault()
      setActiveIndex(0)
    } else if (key === 'End') {
      event.preventDefault()
      setActiveIndex(options.length - 1)
    } else if (key === 'Enter' || key === ' ') {
      event.preventDefault()
      choose(activeIndex)
    } else if (key === 'Escape') {
      event.preventDefault()
      close()
    } else if (key === 'Tab') {
      // Close and let the browser move focus on as usual (no change).
      close()
    } else if (isPrintable) {
      const match = findByTypeahead(key)
      if (match !== null) setActiveIndex(match)
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-labelledby={labelId}
        aria-activedescendant={open ? optionId(activeIndex) : undefined}
        data-value={value}
        onClick={() => (open ? close() : openAt(selectedIndex))}
        onKeyDown={handleKeyDown}
        className={`${controlClasses(active)} flex items-center justify-between gap-2 text-left`}
      >
        <span className="truncate">{selected?.label ?? ''}</span>
        <ChevronIcon open={open} />
      </button>
      <ul
        ref={listboxRef}
        id={listboxId}
        role="listbox"
        aria-labelledby={labelId}
        tabIndex={-1}
        hidden={!open}
        className="absolute left-0 right-0 z-30 mt-1 max-h-64 overflow-auto rounded-card border border-border-subtle bg-surface py-1 shadow-popover"
      >
        {options.map((option, index) => {
          const isSelected = option.value === value
          const isActive = index === activeIndex
          return (
            <li
              key={option.value}
              id={optionId(index)}
              role="option"
              aria-selected={isSelected}
              // Keep focus on the button: a mousedown on an option must not blur it.
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(index)}
              className={`flex min-h-[44px] cursor-pointer items-center gap-2 px-3 text-sm text-ink sm:min-h-0 sm:py-2 ${
                isActive ? 'bg-brand-soft' : 'hover:bg-slate-50'
              } ${isSelected ? 'font-medium' : 'font-normal'}`}
            >
              {isSelected ? <CheckIcon /> : <span aria-hidden="true" className="h-4 w-4 flex-shrink-0" />}
              <span className="truncate">{option.label}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default Select
