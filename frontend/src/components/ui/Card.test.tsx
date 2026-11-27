import { render, screen } from '@testing-library/react'
import Card from './Card'

test('renders its children', () => {
  render(<Card>Card content</Card>)
  expect(screen.getByText('Card content')).toBeInTheDocument()
})

test('default is white with the decorative border; emphasis is a neutral slate-100 fill with the same border; surface replaces both', () => {
  // Given a default, an emphasis and a custom-surface card
  render(
    <>
      <Card>Plain</Card>
      <Card variant="emphasis">Emphasised</Card>
      <Card surface="border border-apartment-sky-border bg-apartment-sky-tint">Toned</Card>
    </>,
  )

  // Then each carries exactly one border and one background set
  expect(screen.getByText('Plain')).toHaveClass('border', 'border-border-subtle', 'bg-surface')
  const emphasised = screen.getByText('Emphasised')
  expect(emphasised).toHaveClass('border', 'border-border-subtle', 'bg-slate-100')
  expect(emphasised).not.toHaveClass('border-brand')
  expect(emphasised).not.toHaveClass('bg-surface')
  const toned = screen.getByText('Toned')
  expect(toned).toHaveClass('bg-apartment-sky-tint', 'border-apartment-sky-border')
  expect(toned).not.toHaveClass('bg-surface')
  expect(toned).not.toHaveClass('border-border-subtle')
})
