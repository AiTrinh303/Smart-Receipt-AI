export class ApiError extends Error {
  status?: number
  /** Only set for a 422 from PUT /receipts/{id}/status that names which
   * fields are missing -- e.g. ["apartment", "date"]. */
  missing?: string[]
  /** A stable, machine-readable error kind (e.g. "DUPLICATE_FILE") -- set
   * only when the response body's `detail` was an object carrying a
   * `code`. A plain string detail never sets this. */
  code?: string
  /** The whole `detail` object, when it was one (e.g. a 409 DUPLICATE_FILE
   * carries `details.existing`, the already-saved receipt). Undefined when
   * `detail` was a plain string. */
  details?: Record<string, unknown>

  constructor(
    message: string,
    status?: number,
    missing?: string[],
    code?: string,
    details?: Record<string, unknown>,
  ) {
    super(message)
    this.status = status
    this.missing = missing
    this.code = code
    this.details = details
  }
}

/**
 * Builds an ApiError from a parsed response body's `detail` field. A plain
 * string works exactly as before (becomes the message, no code/details). An
 * object uses its own `message` field as the readable message and keeps
 * `code` (when it is a string) plus the whole object as `details`, so a
 * caller can read e.g. a 409 DUPLICATE_FILE's `details.existing` back
 * without re-deriving this shape itself. Anything else (a missing or
 * malformed detail) falls back to `fallbackMessage`.
 */
export function apiErrorFromDetail(detail: unknown, status: number, fallbackMessage: string): ApiError {
  if (typeof detail === 'string') {
    return new ApiError(detail, status)
  }
  if (detail && typeof detail === 'object') {
    const record = detail as Record<string, unknown>
    const message = typeof record.message === 'string' ? record.message : fallbackMessage
    const code = typeof record.code === 'string' ? record.code : undefined
    return new ApiError(message, status, undefined, code, record)
  }
  return new ApiError(fallbackMessage, status)
}
