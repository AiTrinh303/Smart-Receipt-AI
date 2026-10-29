export { clearApartmentsCache } from '../hooks/useApartments'

export const SAMPLE_APARTMENTS = [
  { id: 'oberaudorf-bergblick', name: 'Oberaudorf Bergblick' },
  { id: 'sankt-englmar-waldglueck', name: 'Sankt Englmar Waldglück' },
]

export function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  }
}

function defaultApartmentsResponse() {
  return Promise.resolve(jsonResponse(200, { items: SAMPLE_APARTMENTS, count: SAMPLE_APARTMENTS.length }))
}

/**
 * Every mount of the plain upload form fires a GET /apartments (via
 * useApartments). This answers that one URL -- with a default two-item
 * success response, or `apartments` when a test needs a different one --
 * and delegates everything else to `handleOther`, so each test file's own
 * fetch router only has to describe the routes it actually cares about.
 */
export function withApartments(
  handleOther: (urlString: string, options?: RequestInit) => Promise<unknown>,
  apartments: () => Promise<unknown> = defaultApartmentsResponse,
) {
  return (url: unknown, options?: RequestInit) => {
    const urlString = String(url)
    if (urlString.endsWith('/apartments')) {
      return apartments()
    }
    return handleOther(urlString, options)
  }
}
