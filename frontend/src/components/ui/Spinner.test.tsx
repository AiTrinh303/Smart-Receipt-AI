import { render, screen } from '@testing-library/react'
import Spinner from './Spinner'

test('renders with an accessible label', () => {
  render(<Spinner label="Loading receipt" />)
  expect(screen.getByRole('status', { name: 'Loading receipt' })).toBeInTheDocument()
})
