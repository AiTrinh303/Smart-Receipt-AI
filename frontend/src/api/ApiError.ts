export class ApiError extends Error {
  status?: number
  /** Only set for a 422 from PUT /receipts/{id}/status that names which
   * fields are missing -- e.g. ["apartment", "category"]. */
  missing?: string[]

  constructor(message: string, status?: number, missing?: string[]) {
    super(message)
    this.status = status
    this.missing = missing
  }
}
