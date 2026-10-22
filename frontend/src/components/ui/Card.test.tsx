import { render, screen } from '@testing-library/react'
import Card from './Card'

test('renders its children', () => {
  render(<Card>Card content</Card>)
  expect(screen.getByText('Card content')).toBeInTheDocument()
})
