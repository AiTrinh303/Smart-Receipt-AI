import { render } from '@testing-library/react'
import Container, { CONTAINER_SIZE_CLASSES } from './Container'

test('renders its children', () => {
  const { getByText } = render(<Container>Container content</Container>)
  expect(getByText('Container content')).toBeInTheDocument()
})

test.each(['md', 'lg', 'xl'] as const)('size "%s" applies exactly the exported max-width class', (size) => {
  const { container } = render(<Container size={size}>x</Container>)
  const el = container.firstElementChild as HTMLElement
  expect(el.className).toContain(CONTAINER_SIZE_CLASSES[size])
})

test('every exported size resolves to a non-empty max-width class', () => {
  for (const size of ['md', 'lg', 'xl'] as const) {
    expect(CONTAINER_SIZE_CLASSES[size]).toMatch(/^max-w-/)
  }
})
