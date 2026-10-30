import { jsonResponse } from './apartmentsFetch'

export { clearCategoriesCache } from '../hooks/useCategories'

export const SAMPLE_CATEGORIES = [
  { id: 'cleaning', name: 'Cleaning and supplies' },
  { id: 'repairs', name: 'Repairs and maintenance' },
]

function defaultCategoriesResponse() {
  return Promise.resolve(jsonResponse(200, { items: SAMPLE_CATEGORIES, count: SAMPLE_CATEGORIES.length }))
}

/**
 * Every mount of the saved-receipt view fires a GET /categories (via
 * useCategories, from ReceiptClassification). This answers that one URL --
 * with a default two-item success response, or `categories` when a test
 * needs a different one -- and delegates everything else to `handleOther`,
 * same pattern as withApartments.
 */
export function withCategories(
  handleOther: (urlString: string, options?: RequestInit) => Promise<unknown>,
  categories: () => Promise<unknown> = defaultCategoriesResponse,
) {
  return (url: unknown, options?: RequestInit) => {
    const urlString = String(url)
    if (urlString.endsWith('/categories')) {
      return categories()
    }
    return handleOther(urlString, options)
  }
}
