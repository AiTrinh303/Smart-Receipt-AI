import { render, screen } from '@testing-library/react'
import MissingValue from './MissingValue'

test('renders a visible dash and a visually hidden "Not detected"', () => {
  // Given the component is rendered
  render(<MissingValue />)

  // Then "Not detected" is still findable in the DOM (visually hidden)
  expect(screen.getByText('Not detected')).toBeInTheDocument()
  expect(screen.getByText('Not detected')).toHaveClass('sr-only')

  // And a decorative dash is present, hidden from assistive tech
  expect(screen.getByText('—')).toHaveAttribute('aria-hidden', 'true')
})
