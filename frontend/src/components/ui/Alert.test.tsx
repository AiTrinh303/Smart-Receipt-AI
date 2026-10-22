import { render, screen } from '@testing-library/react'
import Alert from './Alert'

test('error variant uses role="alert"', () => {
  render(<Alert variant="error">Something went wrong</Alert>)
  expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong')
})

test('info, success and warning variants use role="status"', () => {
  const variants = ['info', 'success', 'warning'] as const

  render(
    <>
      {variants.map((variant) => (
        <Alert key={variant} variant={variant}>
          {variant} message
        </Alert>
      ))}
    </>,
  )

  const statuses = screen.getAllByRole('status')
  expect(statuses).toHaveLength(3)
  for (const variant of variants) {
    expect(screen.getByText(`${variant} message`)).toBeInTheDocument()
  }
})
