import { render } from '@testing-library/react'
import Skeleton from './Skeleton'

test('renders a decorative, aria-hidden pulsing block', () => {
  const { container } = render(<Skeleton className="h-4 w-full" />)
  const block = container.firstChild as HTMLElement

  expect(block).toHaveAttribute('aria-hidden', 'true')
  expect(block.className).toMatch(/animate-pulse/)
  expect(block.className).toMatch(/motion-reduce:animate-none/)
})
