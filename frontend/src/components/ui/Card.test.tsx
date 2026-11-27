import { render, screen } from '@testing-library/react'
import Card from './Card'

test('renders its children', () => {
  render(<Card>Card content</Card>)
  expect(screen.getByText('Card content')).toBeInTheDocument()
})

test('the default card is white with the decorative border; the emphasis variant swaps both for the brand-soft fill', () => {
  // Given a default and an emphasis card
  render(
    <>
      <Card>Plain</Card>
      <Card variant="emphasis">Emphasised</Card>
    </>,
  )

  // Then each has exactly one background and one border colour class
  const plain = screen.getByText('Plain')
  expect(plain).toHaveClass('bg-surface', 'border-border-subtle')
  expect(plain).not.toHaveClass('bg-brand-soft')
  const emphasised = screen.getByText('Emphasised')
  expect(emphasised).toHaveClass('bg-brand-soft', 'border-brand/30')
  expect(emphasised).not.toHaveClass('bg-surface')
})
