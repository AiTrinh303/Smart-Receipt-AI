import { useEffect, useState } from 'react'

function getMatches(query: string): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }
  return window.matchMedia(query).matches
}

/** Guarded for environments without matchMedia (returns false, e.g. jsdom in
 * tests that don't mock it), and updates live when the query's match state
 * changes, with proper listener cleanup. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => getMatches(query))

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }

    const mediaQueryList = window.matchMedia(query)
    const handleChange = () => setMatches(mediaQueryList.matches)
    handleChange()

    mediaQueryList.addEventListener('change', handleChange)
    return () => mediaQueryList.removeEventListener('change', handleChange)
  }, [query])

  return matches
}
