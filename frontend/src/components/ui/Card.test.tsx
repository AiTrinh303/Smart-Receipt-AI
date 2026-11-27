import { render, screen } from '@testing-library/react'
import Card from './Card'

test('renders its children', () => {
  render(<Card>Card content</Card>)
  expect(screen.getByText('Card content')).toBeInTheDocument()
})

test('default is white with the decorative border; emphasis stays white with a 2px brand border; surface replaces both', () => {
  // Given a default, an emphasis and a custom-surface card
  render(
    <>
      <Card>Plain</Card>
      <Card variant="emphasis">Emphasised</Card>
      <Card surface="border border-apartment-sky/30 bg-apartment-sky-soft">Toned</Card>
    </>,
  )

  // Then each carries exactly one border and one background set
  expect(screen.getByText('Plain')).toHaveClass('border', 'border-border-subtle', 'bg-surface')
  const emphasised = screen.getByText('Emphasised')
  expect(emphasised).toHaveClass('border-2', 'border-brand', 'bg-surface')
  expect(emphasised).not.toHaveClass('bg-brand-soft')
  const toned = screen.getByText('Toned')
  expect(toned).toHaveClass('bg-apartment-sky-soft', 'border-apartment-sky/30')
  expect(toned).not.toHaveClass('bg-surface')
  expect(toned).not.toHaveClass('border-border-subtle')
})
