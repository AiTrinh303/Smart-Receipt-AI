import { render, screen } from '@testing-library/react'
import App from './App'

test('renders the Smart Receipt AI heading', () => {
  render(<App />)
  expect(screen.getByRole('heading', { name: 'Smart Receipt AI' })).toBeInTheDocument()
})
