import { render, screen } from '@testing-library/react'
import Card from './Card'

test('renders its children', () => {
  render(<Card>Card content</Card>)
  expect(screen.getByText('Card content')).toBeInTheDocument()
})

test('default is white with the decorative border; emphasis is a solid slate-700 fill with no border; surface replaces both', () => {
  // Given a default, an emphasis and a custom-surface card
  render(
    <>
      <Card>Plain</Card>
      <Card variant="emphasis">Emphasised</Card>
      <Card surface="bg-apartment-sky">Toned</Card>
    </>,
  )

  // Then each carries exactly one border and one background set
  expect(screen.getByText('Plain')).toHaveClass('border', 'border-border-subtle', 'bg-surface')
  const emphasised = screen.getByText('Emphasised')
  expect(emphasised).toHaveClass('bg-slate-700')
  expect(emphasised).not.toHaveClass('border')
  expect(emphasised).not.toHaveClass('bg-surface')
  const toned = screen.getByText('Toned')
  expect(toned).toHaveClass('bg-apartment-sky')
  expect(toned).not.toHaveClass('border')
  expect(toned).not.toHaveClass('bg-surface')
  expect(toned).not.toHaveClass('border-border-subtle')
})
