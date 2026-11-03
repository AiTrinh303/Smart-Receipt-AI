import { render, screen } from '@testing-library/react'
import ClampedText from './ClampedText'

test('non-empty text gets a title attribute with the full text', () => {
  render(<ClampedText text="A very long product title" lines={2} />)

  expect(screen.getByText('A very long product title')).toHaveAttribute(
    'title',
    'A very long product title',
  )
})

test('empty text has no title attribute', () => {
  render(<ClampedText text="" lines={1} />)

  const span = document.querySelector('span')
  expect(span).not.toHaveAttribute('title')
})

test('lines=1 applies line-clamp-1, lines=2 applies line-clamp-2', () => {
  const { rerender } = render(<ClampedText text="Store" lines={1} />)
  expect(screen.getByText('Store')).toHaveClass('line-clamp-1')

  rerender(<ClampedText text="Item name" lines={2} />)
  expect(screen.getByText('Item name')).toHaveClass('line-clamp-2')
})
