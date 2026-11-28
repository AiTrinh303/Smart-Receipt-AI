import { screen, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'

/** Picks an option in a `ui/Select`, whichever form is mounted: the native
 * <select> (below sm) or the custom combobox (open it, click the option).
 * `optionLabel` is the option's visible text. */
export async function chooseOption(user: UserEvent, label: string, optionLabel: string) {
  const control = selectControl(label)
  if (control.tagName === 'SELECT') {
    await user.selectOptions(control, optionLabel)
    return
  }
  await user.click(control)
  const listbox = document.getElementById(control.getAttribute('aria-controls') as string) as HTMLElement
  await user.click(within(listbox).getByRole('option', { name: optionLabel }))
}

/** A `ui/Select`'s control by its label. Both forms have the combobox role
 * (a native single <select> does too); the custom one's listbox shares
 * the label, so getByLabelText would find two elements. */
export function selectControl(label: string): HTMLElement {
  return screen.getByRole('combobox', { name: label })
}

/** The current value of a `ui/Select`'s control, in either form. */
export function selectValue(control: HTMLElement): string {
  return control.tagName === 'SELECT' ? (control as HTMLSelectElement).value : (control.getAttribute('data-value') ?? '')
}

/** The option labels of a `ui/Select`, in order, in either form (the
 * combobox's listbox is in the DOM even while closed). */
export function optionLabels(control: HTMLElement): string[] {
  if (control.tagName === 'SELECT') {
    return Array.from((control as HTMLSelectElement).options).map((option) => option.textContent ?? '')
  }
  const listbox = document.getElementById(control.getAttribute('aria-controls') as string) as HTMLElement
  return Array.from(listbox.querySelectorAll('[role="option"]')).map((option) => option.textContent ?? '')
}
