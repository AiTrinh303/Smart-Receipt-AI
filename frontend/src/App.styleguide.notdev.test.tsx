import { render, screen } from '@testing-library/react'

afterEach(() => {
  window.history.replaceState({}, '', '/')
  jest.dontMock('./env')
})

test('the style guide page is not rendered when isDev is false, even with ?view=styleguide', () => {
  // Given isDev (import.meta.env.DEV) is false, as in a production build
  // (jest.doMock + a fresh require, not a static top-level import: esbuild
  // hoists transformed `import` statements above jest.mock calls in this
  // project's non-Babel transform, so a static import of App would load
  // the real ./env before the mock is ever registered; no jest.resetModules()
  // either, since that would also reset react/react-dom and break hooks).
  window.history.replaceState({}, '', '/?view=styleguide')
  jest.doMock('./env', () => ({ isDev: false }))
  const App = require('./App').default

  render(<App />)

  // Then the style guide page never renders -- the upload view does instead
  expect(screen.queryByRole('heading', { name: 'Style guide' })).not.toBeInTheDocument()
  expect(screen.getByLabelText(/upload receipt/i)).toBeInTheDocument()
})
