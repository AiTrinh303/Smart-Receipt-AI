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

test('grid layout: the legend above as a label, every option w-48 x h-14 (full width below sm), second line muted', () => {
  // Given a grid group with and without a second line
  render(
    <RadioCardGroup
      layout="grid"
      legend="Apartment"
      name="apartment"
      options={[
        { value: '', label: 'All apartments', secondaryLabel: 'Both' },
        { value: 'a', label: 'Bergblick', secondaryLabel: 'Oberaudorf', accessibleName: 'Fewo JoJo - Oberaudorf - Bergblick' },
        { value: 'b', label: 'No place' },
      ]}
      value=""
      onChange={() => {}}
    />,
  )

  // Then the legend is a regular label, not floated beside the options
  const group = screen.getByRole('radiogroup', { name: 'Apartment' })
  const legend = within(group).getByText('Apartment')
  expect(legend).toHaveClass('text-sm', 'font-medium', 'text-ink')
  expect(legend.className).not.toMatch(/float-left/)
  // And every option has the same fixed size, with or without a second line
  for (const radio of within(group).getAllByRole('radio')) {
    expect(radio.closest('label')).toHaveClass('h-14', 'w-full', 'sm:w-48')
  }
  // And the second line is muted; the accessible name is unchanged
  expect(within(group).getByText('Oberaudorf')).toHaveClass('text-xs', 'text-ink-muted')
  expect(within(group).getByRole('radio', { name: 'Fewo JoJo - Oberaudorf - Bergblick' })).toBeInTheDocument()
  // And the selected option keeps the check icon and selected style
  const selected = within(group).getByRole('radio', { name: 'All apartments' }).closest('label') as HTMLElement
  expect(selected).toHaveClass('border-brand', 'bg-brand-subtle', 'font-semibold')
  expect(selected.querySelector('svg')).not.toBeNull()
})
