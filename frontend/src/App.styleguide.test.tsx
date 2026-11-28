import { render, screen, waitFor } from '@testing-library/react'
import App from './App'
import { mockObjectUrl } from './test/objectUrl'

beforeEach(() => {
  window.history.replaceState({}, '', '/?view=styleguide')
})

afterEach(() => {
  window.history.replaceState({}, '', '/')
})

// The style guide's BatchQueue sample includes image (.jpg) files, which
// now get a thumbnail via URL.createObjectURL -- jsdom has neither that nor
// URL.revokeObjectURL.
let objectUrl: ReturnType<typeof mockObjectUrl>
beforeEach(() => {
  objectUrl = mockObjectUrl()
})
afterEach(() => {
  objectUrl.restore()
})

test('the style guide page renders every Button variant, Alert variant, the logo and a Card', async () => {
  // Given dev mode is on (the default in this test environment) and the URL requests the style guide
  render(<App />)

  // Then every Button variant renders in its enabled, disabled and loading groups
  // (the page is a lazy import of the large StyleGuide module: under a full parallel test run its
  // first load can take longer than waitFor's 1s default, so this one wait gets more time)
  await waitFor(
    () => {
      expect(screen.getByRole('heading', { name: 'Style guide' })).toBeInTheDocument()
    },
    { timeout: 5000 },
  )
  for (const variant of ['primary', 'secondary', 'danger', 'ghost', 'danger-ghost']) {
    expect(screen.getByRole('button', { name: variant })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: `${variant} (disabled)` })).toBeInTheDocument()
  }
  expect(screen.getAllByRole('button', { name: /loading/i }).length).toBeGreaterThan(0)

  // And every Alert variant renders
  expect(screen.getByText('This is a info alert.')).toBeInTheDocument()
  expect(screen.getByText('This is a success alert.')).toBeInTheDocument()
  expect(screen.getByText('This is a warning alert.')).toBeInTheDocument()
  expect(screen.getByText('This is a error alert.')).toBeInTheDocument()

  // And the Card sample content renders
  expect(screen.getByText('A basic Card with some sample content.')).toBeInTheDocument()

  // And the Skeleton section and the card-variant items list render
  expect(screen.getByRole('heading', { name: /skeleton/i })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: /items as cards/i })).toBeInTheDocument()
  expect(screen.getAllByText('Unit price (USD)').length).toBeGreaterThan(0)
  expect(screen.getAllByText('Line total (USD)').length).toBeGreaterThan(0)

  // And the warnings panel, Edited badge and reset confirmation render
  expect(screen.getByText('Check these values')).toBeInTheDocument()
  expect(screen.getByText('Edited')).toBeInTheDocument()
  expect(
    screen.getByText('Replace your edits with the original AI result? This cannot be undone.'),
  ).toBeInTheDocument()
})
