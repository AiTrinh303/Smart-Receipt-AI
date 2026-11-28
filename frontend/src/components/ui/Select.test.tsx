import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Select from './Select'

const OPTIONS = [
  { value: 'date_desc', label: 'Date (newest first)' },
  { value: 'date_asc', label: 'Date (oldest first)' },
  { value: 'amount_desc', label: 'Total (high to low)' },
  { value: 'amount_asc', label: 'Total (low to high)' },
  { value: 'uploaded_desc', label: 'Recently uploaded' },
]

afterEach(() => {
  // @ts-expect-error removing a per-test matchMedia stub
  delete window.matchMedia
})

function setup(value = 'date_desc') {
  const onChange = jest.fn()
  const user = userEvent.setup()
  render(
    <>
      <Select id="sort" label="Sort by" value={value} options={OPTIONS} onChange={onChange} />
      <button type="button">Next control</button>
      <p>Outside</p>
    </>,
  )
  const combobox = screen.getByRole('combobox', { name: 'Sort by' })
  const listbox = document.getElementById('sort-listbox') as HTMLElement
  return { onChange, user, combobox, listbox }
}

function activeOption(combobox: HTMLElement): HTMLElement | null {
  const id = combobox.getAttribute('aria-activedescendant')
  return id ? document.getElementById(id) : null
}

test('closed: a labelled button with the current value, aria-haspopup/expanded/controls, and a hidden listbox', () => {
  const { combobox, listbox } = setup('amount_desc')

  // Then the button is the labelled combobox showing the current value
  expect(combobox.tagName).toBe('BUTTON')
  expect(combobox).toHaveTextContent('Total (high to low)')
  expect(combobox).toHaveAttribute('aria-haspopup', 'listbox')
  expect(combobox).toHaveAttribute('aria-expanded', 'false')
  expect(combobox).toHaveAttribute('aria-controls', 'sort-listbox')
  expect(combobox).not.toHaveAttribute('aria-activedescendant')
  // And the listbox exists, labelled by the same label, but is hidden
  expect(listbox).toHaveAttribute('role', 'listbox')
  expect(listbox).toHaveAttribute('aria-labelledby', 'sort-label')
  expect(listbox).not.toBeVisible()
})

test('a click opens the listbox; the selected option has aria-selected, a check icon and medium weight', async () => {
  const { user, combobox } = setup('amount_desc')

  // When the button is clicked
  await user.click(combobox)

  // Then it's expanded, with the five options and the current one selected (not by colour alone)
  expect(combobox).toHaveAttribute('aria-expanded', 'true')
  const options = screen.getAllByRole('option')
  expect(options.map((o) => o.textContent)).toEqual(OPTIONS.map((o) => o.label))
  const selected = screen.getByRole('option', { name: 'Total (high to low)' })
  expect(selected).toHaveAttribute('aria-selected', 'true')
  expect(selected).toHaveClass('font-medium')
  expect(selected.querySelector('svg')).not.toBeNull()
  expect(screen.getByRole('option', { name: 'Date (newest first)' })).toHaveAttribute('aria-selected', 'false')
  // And the selected option starts as the highlighted (active) one
  expect(activeOption(combobox)).toBe(selected)
  expect(selected).toHaveClass('bg-brand-soft')
})

test('keyboard: Enter opens, Arrow/Home/End move the highlight, Enter selects -- onChange fires once and focus stays on the button', async () => {
  const { user, combobox, onChange } = setup()
  combobox.focus()

  // When Enter opens it
  await user.keyboard('{Enter}')
  expect(combobox).toHaveAttribute('aria-expanded', 'true')
  expect(activeOption(combobox)).toHaveTextContent('Date (newest first)')

  // And the arrows, End and Home move the highlight
  await user.keyboard('{ArrowDown}{ArrowDown}')
  expect(activeOption(combobox)).toHaveTextContent('Total (high to low)')
  await user.keyboard('{End}')
  expect(activeOption(combobox)).toHaveTextContent('Recently uploaded')
  await user.keyboard('{Home}')
  expect(activeOption(combobox)).toHaveTextContent('Date (newest first)')
  await user.keyboard('{ArrowUp}')
  expect(activeOption(combobox)).toHaveTextContent('Date (newest first)') // no wrap at the top
  await user.keyboard('{ArrowDown}')

  // And Enter selects the highlighted option
  await user.keyboard('{Enter}')

  // Then onChange fired exactly once with its value, the listbox closed, focus is on the button
  expect(onChange).toHaveBeenCalledTimes(1)
  expect(onChange).toHaveBeenCalledWith('date_asc')
  expect(combobox).toHaveAttribute('aria-expanded', 'false')
  expect(combobox).toHaveFocus()
})

test('Space and Alt+ArrowDown also open it', async () => {
  const { user, combobox } = setup()
  combobox.focus()

  await user.keyboard(' ')
  expect(combobox).toHaveAttribute('aria-expanded', 'true')
  await user.keyboard('{Escape}')

  await user.keyboard('{Alt>}{ArrowDown}{/Alt}')
  expect(combobox).toHaveAttribute('aria-expanded', 'true')
})

test('type-ahead moves the highlight to the next option starting with the typed letters', async () => {
  const { user, combobox, onChange } = setup()
  combobox.focus()
  await user.keyboard('{Enter}')

  // "t" jumps to the first "Total…", typing "t" again moves to the next "Total…"
  await user.keyboard('t')
  expect(activeOption(combobox)).toHaveTextContent('Total (high to low)')
  await user.keyboard('t')
  expect(activeOption(combobox)).toHaveTextContent('Total (low to high)')
  // and nothing was selected by typing alone
  expect(onChange).not.toHaveBeenCalled()
})

test('choosing the current value again does not fire onChange', async () => {
  const { user, combobox, onChange } = setup('date_desc')
  await user.click(combobox)
  await user.click(screen.getByRole('option', { name: 'Date (newest first)' }))
  expect(onChange).not.toHaveBeenCalled()
  expect(combobox).toHaveAttribute('aria-expanded', 'false')
})

test('a click on an option selects it once and returns focus to the button', async () => {
  const { user, combobox, onChange } = setup()
  await user.click(combobox)
  await user.click(screen.getByRole('option', { name: 'Recently uploaded' }))
  expect(onChange).toHaveBeenCalledTimes(1)
  expect(onChange).toHaveBeenCalledWith('uploaded_desc')
  expect(combobox).toHaveFocus()
})

test('Escape closes without a change, focus stays on the button', async () => {
  const { user, combobox, onChange } = setup()
  combobox.focus()
  await user.keyboard('{Enter}{ArrowDown}{Escape}')
  expect(combobox).toHaveAttribute('aria-expanded', 'false')
  expect(onChange).not.toHaveBeenCalled()
  expect(combobox).toHaveFocus()
})

test('Tab closes without a change and moves focus on', async () => {
  const { user, combobox, onChange } = setup()
  combobox.focus()
  await user.keyboard('{Enter}{ArrowDown}')
  await user.tab()
  expect(combobox).toHaveAttribute('aria-expanded', 'false')
  expect(onChange).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Next control' })).toHaveFocus()
})

test('a click outside closes without a change', async () => {
  const { user, combobox, onChange } = setup()
  await user.click(combobox)
  await user.click(screen.getByText('Outside'))
  expect(combobox).toHaveAttribute('aria-expanded', 'false')
  expect(onChange).not.toHaveBeenCalled()
})

test('the button and every option keep a 44px target below sm and a visible focus ring', async () => {
  const { user, combobox } = setup()
  expect(combobox).toHaveClass('min-h-[44px]', 'focus-visible:outline-brand')
  await user.click(combobox)
  for (const option of screen.getAllByRole('option')) {
    expect(option).toHaveClass('min-h-[44px]')
  }
})

test('below sm the native <select> is rendered instead (only one of the two), with the same options and onChange', async () => {
  // Given a small screen
  window.matchMedia = jest.fn().mockImplementation((query: string) => ({
    matches: query === '(max-width: 639px)',
    media: query,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  })) as unknown as typeof window.matchMedia
  const { user, combobox, onChange } = setup()

  // Then the control is a native select with the same options, and no listbox exists
  expect(combobox.tagName).toBe('SELECT')
  expect(within(combobox).getAllByRole('option').map((o) => o.textContent)).toEqual(OPTIONS.map((o) => o.label))
  expect(document.getElementById('sort-listbox')).toBeNull()

  // And choosing an option calls onChange once with its value
  await user.selectOptions(combobox, 'Total (low to high)')
  expect(onChange).toHaveBeenCalledTimes(1)
  expect(onChange).toHaveBeenCalledWith('amount_asc')
})

test('active: the closed control gets border-brand and bg-brand-soft; inactive keeps border-border and bg-surface', () => {
  // Given an active and an inactive Select
  render(
    <>
      <Select id="a" label="Active" value="amount_desc" options={OPTIONS} onChange={() => {}} active />
      <Select id="b" label="Inactive" value="date_desc" options={OPTIONS} onChange={() => {}} />
    </>,
  )

  // Then only the active one has the brand border/fill, each as complete static classes
  const active = screen.getByRole('combobox', { name: 'Active' })
  const inactive = screen.getByRole('combobox', { name: 'Inactive' })
  expect(active).toHaveClass('border-brand', 'bg-brand-soft')
  expect(active).not.toHaveClass('border-border', 'bg-surface')
  expect(inactive).toHaveClass('border-border', 'bg-surface')
  expect(inactive).not.toHaveClass('border-brand', 'bg-brand-soft')
  // And the value text is still shown (not colour alone)
  expect(active).toHaveTextContent('Total (high to low)')
})

test('active also applies to the native <select> below sm', () => {
  window.matchMedia = jest.fn().mockImplementation((query: string) => ({
    matches: query === '(max-width: 639px)',
    media: query,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  })) as unknown as typeof window.matchMedia
  render(<Select id="a" label="Active" value="amount_desc" options={OPTIONS} onChange={() => {}} active />)
  const control = screen.getByRole('combobox', { name: 'Active' })
  expect(control.tagName).toBe('SELECT')
  expect(control).toHaveClass('border-brand', 'bg-brand-soft')
})
