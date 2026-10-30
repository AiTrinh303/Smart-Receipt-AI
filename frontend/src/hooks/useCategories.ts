import { useEffect, useState } from 'react'
import { getCategories } from '../api/getCategories'
import type { Category } from '../api/types'

let cachedCategories: Category[] | null = null

/** Test-only: clears the module-level cache so each test starts fresh. */
export function clearCategoriesCache() {
  cachedCategories = null
}

interface UseCategoriesResult {
  categories: Category[] | null
  isLoading: boolean
  error: string | null
  retry: () => void
}

const LOAD_FAILED_MESSAGE = 'Could not load categories. Please try again.'

/**
 * Fetches the active category list once per session -- a SUCCESSFUL result
 * is cached at module scope (same pattern as useApartments) so switching
 * between saved receipts never re-fetches it; a failed attempt is never
 * cached, so `retry` (or a later mount) tries again. `enabled` lets the
 * caller skip the request entirely when the list isn't needed yet.
 */
export function useCategories(enabled: boolean): UseCategoriesResult {
  const [categories, setCategories] = useState<Category[] | null>(cachedCategories)
  const [isLoading, setIsLoading] = useState(enabled && cachedCategories === null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!enabled) {
      return
    }
    if (cachedCategories !== null) {
      setCategories(cachedCategories)
      setIsLoading(false)
      return
    }

    let cancelled = false
    setIsLoading(true)
    setError(null)

    getCategories()
      .then((response) => {
        if (cancelled) return
        cachedCategories = response.items
        setCategories(response.items)
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

  return { categories, isLoading, error, retry }
}
