import { renderHook, act } from '@testing-library/react'
import { useMediaQuery } from './useMediaQuery'

function mockMatchMedia(initialMatches: boolean) {
  let matches = initialMatches
  let changeHandler: (() => void) | null = null

  const mql = {
    get matches() {
      return matches
    },
    addEventListener: (_event: string, handler: () => void) => {
      changeHandler = handler
    },
    removeEventListener: () => {
      changeHandler = null
    },
  }

  window.matchMedia = jest.fn().mockReturnValue(mql)

  return {
    setMatches: (value: boolean) => {
      matches = value
      changeHandler?.()
    },
  }
}

afterEach(() => {
  // @ts-expect-error cleaning up the test-only global matchMedia stub
  delete window.matchMedia
})

test('returns false when matchMedia is unavailable', () => {
  // Given no window.matchMedia (the jsdom default in this project)
  const { result } = renderHook(() => useMediaQuery('(max-width: 639px)'))

  // Then it returns false rather than throwing
  expect(result.current).toBe(false)
})

test('returns the initial match state and updates on change', () => {
  // Given matchMedia initially does not match
  const { setMatches } = mockMatchMedia(false)
  const { result } = renderHook(() => useMediaQuery('(max-width: 639px)'))
  expect(result.current).toBe(false)

  // When the media query starts matching
  act(() => {
    setMatches(true)
  })

  // Then the hook's value updates
  expect(result.current).toBe(true)
})
