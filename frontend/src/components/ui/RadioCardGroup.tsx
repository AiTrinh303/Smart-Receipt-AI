export interface RadioCardOption {
  value: string
  /** Primary, bold line shown on the card. */
  label: string
  /** Optional second line, shown muted below the label. */
  secondaryLabel?: string | null
  /** Overrides the card's accessible name (and its title tooltip), for when
   * the visible label/secondaryLabel don't spell out the full name on their
   * own (e.g. a shortened apartment name). Falls back to `label`. */
  accessibleName?: string
}

interface RadioCardGroupProps {
  legend: string
  name: string
  options: RadioCardOption[]
  value: string | null
  onChange: (value: string) => void
  disabled?: boolean
  describedBy?: string
  /** Visually hides the `<legend>` (still in the DOM, still the
   * fieldset's `aria-label`) when a caller already shows its own visible
   * heading above this group -- e.g. the upload form's "Apartment"
   * section heading, which would otherwise repeat `legend`'s text.
   * Defaults to visible, since most callers (e.g. `ReceiptApartment.tsx`)
   * have no heading of their own and rely on this legend being the one
   * visible label. */
  hideLegend?: boolean
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 flex-shrink-0 text-brand" fill="none">
      <path
        d="M4 10.5l3.5 3.5L16 5.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** A fieldset of real radio inputs (so arrow keys move between them) styled
 * as selectable cards. The input itself is visually hidden (`sr-only`, not
 * `display:none`, so it stays focusable and keeps native radio-group
 * keyboard behavior); the wrapping label carries the card styling and shows
 * a visible focus ring via `focus-within` since the input's own ring would
 * be clipped. Selection is never conveyed by color alone -- a check icon
 * and bolder weight go along with the stronger border. */
function RadioCardGroup({
  legend,
  name,
  options,
  value,
  onChange,
  disabled = false,
  describedBy,
  hideLegend = false,
}: RadioCardGroupProps) {
  return (
    <fieldset
      disabled={disabled}
      aria-describedby={describedBy}
      role="radiogroup"
      aria-label={legend}
      className="flex flex-col gap-2"
    >
      <legend className={hideLegend ? 'sr-only' : 'text-sm font-medium text-ink'}>{legend}</legend>
      <div className="flex flex-col gap-2 sm:flex-row">
        {options.map((option) => {
          const checked = value === option.value
          const accessibleName = option.accessibleName ?? option.label
          return (
            <label
              key={option.value}
              title={accessibleName}
              className={`flex min-h-[44px] flex-1 items-center justify-between gap-2 rounded-control border px-3 py-2 text-sm transition-colors duration-150 motion-reduce:transition-none focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand ${
                checked
                  ? 'border-brand bg-brand-subtle font-semibold text-ink ring-2 ring-brand/15'
                  : 'border-border font-normal text-ink'
              } ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-brand'}`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate">{option.label}</span>
                {option.secondaryLabel && (
                  <span className="block truncate text-xs font-normal text-ink-muted">
                    {option.secondaryLabel}
                  </span>
                )}
              </span>
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={checked}
                disabled={disabled}
                onChange={() => onChange(option.value)}
                aria-label={accessibleName}
                className="sr-only"
              />
              {checked && <CheckIcon />}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

export default RadioCardGroup
