export interface RadioCardOption {
  value: string
  label: string
}

interface RadioCardGroupProps {
  legend: string
  name: string
  options: RadioCardOption[]
  value: string | null
  onChange: (value: string) => void
  disabled?: boolean
  describedBy?: string
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
}: RadioCardGroupProps) {
  return (
    <fieldset
      disabled={disabled}
      aria-describedby={describedBy}
      role="radiogroup"
      aria-label={legend}
      className="flex flex-col gap-2"
    >
      <legend className="text-sm font-medium text-ink">{legend}</legend>
      <div className="flex flex-col gap-2 sm:flex-row">
        {options.map((option) => {
          const checked = value === option.value
          return (
            <label
              key={option.value}
              className={`flex min-h-[44px] flex-1 items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand ${
                checked
                  ? 'border-brand bg-brand-soft font-semibold text-ink'
                  : 'border-border font-normal text-ink'
              } ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-brand'}`}
            >
              <span>{option.label}</span>
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={checked}
                disabled={disabled}
                onChange={() => onChange(option.value)}
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
