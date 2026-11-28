import { render, screen, within } from '@testing-library/react'
import RadioCardGroup from './RadioCardGroup'

test('inline layout without a secondary line: a fixed-height one-line pill, exactly as before', () => {
  // Given an inline group whose options have no secondaryLabel (the receipt detail's apartment choice)
  render(
    <RadioCardGroup
      layout="inline"
      legend="Apartment"
      name="apartment"
      options={[
        { value: 'a', label: 'Bergblick' },
        { value: 'b', label: 'Waldglück' },
      ]}
      value="a"
      onChange={() => {}}
    />,
  )

  // Then each pill keeps the fixed h-11 / sm:h-10 height and shows only its label
  const pill = screen.getByRole('radio', { name: 'Bergblick' }).closest('label') as HTMLElement
  expect(pill).toHaveClass('h-11', 'sm:h-10')
  expect(pill).not.toHaveClass('min-h-[44px]')
  expect(pill.textContent).toBe('Bergblick')
})

test('inline layout with a secondary line: the label plus a muted second line, with a 44px minimum below sm', () => {
  // Given an inline group whose options have a secondaryLabel
  render(
    <RadioCardGroup
      layout="inline"
      legend="CSV format"
      name="style"
      options={[
        { value: 'excel_de', label: 'German Excel', secondaryLabel: 'semicolon, decimal comma' },
        { value: 'plain', label: 'Plain CSV', secondaryLabel: 'comma, decimal point' },
      ]}
      value="excel_de"
      onChange={() => {}}
    />,
  )

  // Then each pill shows both lines, the second muted and smaller
  const group = screen.getByRole('radiogroup', { name: 'CSV format' })
  const pill = within(group).getByRole('radio', { name: 'German Excel' }).closest('label') as HTMLElement
  expect(within(pill).getByText('German Excel')).toBeInTheDocument()
  expect(within(pill).getByText('semicolon, decimal comma')).toHaveClass('text-xs', 'text-ink-muted')
  // And it grows from a minimum height instead of the fixed one
  expect(pill).toHaveClass('min-h-[44px]', 'sm:min-h-10')
  expect(pill).not.toHaveClass('h-11')
  // And the accessible name is still just the label
  expect(within(group).getByRole('radio', { name: 'German Excel' })).toHaveAttribute('aria-label', 'German Excel')
})
