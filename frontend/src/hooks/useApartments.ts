import { useEffect, useState } from 'react'
import { getApartments } from '../api/getApartments'
import type { Apartment } from '../api/types'

let cachedApartments: Apartment[] | null = null

/** Test-only: clears the module-level cache so each test starts fresh. */
export function clearApartmentsCache() {
  cachedApartments = null
}

interface UseApartmentsResult {
  apartments: Apartment[] | null
  isLoading: boolean
  error: string | null
  retry: () => void
}

const LOAD_FAILED_MESSAGE = 'Could not load apartments. Please try again.'

/**
 * Fetches the active apartment list once per session -- a SUCCESSFUL result
 * is cached at module scope so leaving and returning to the upload form
 * (e.g. via "Upload another receipt") never re-fetches it. A failed attempt
 * is never cached, so `retry` (or a later mount) tries again. `enabled`
 * lets the caller skip the request entirely when the list isn't needed yet
 * (e.g. while reopening a saved receipt by id).
 */
export function useApartments(enabled: boolean): UseApartmentsResult {
  const [apartments, setApartments] = useState<Apartment[] | null>(cachedApartments)
  const [isLoading, setIsLoading] = useState(enabled && cachedApartments === null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!enabled) {
      return
    }
    if (cachedApartments !== null) {
      setApartments(cachedApartments)
      setIsLoading(false)
      return
    }

    let cancelled = false
    setIsLoading(true)
    setError(null)

    getApartments()
      .then((response) => {
        if (cancelled) return
        cachedApartments = response.items
        setApartments(response.items)
        setIsLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setError(LOAD_FAILED_MESSAGE)
        setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, attempt])

  const retry = () => setAttempt((n) => n + 1)

  return { apartments, isLoading, error, retry }
}
