/** Shared, user-facing error strings for upload/extract failures -- used by
 * both the single-file flow (ReceiptUpload.tsx) and the batch upload engine
 * (src/batch/), so the two never drift apart. Keep these exact strings:
 * existing tests assert on them. */

export const NETWORK_ERROR_MESSAGE = 'Could not reach the server. Please try again.'

export const EXTRACTION_FAILED_MESSAGE =
  'We could not read this receipt. Please try again or upload a clearer image.'

export const EXTRACTION_NOT_CONFIGURED_MESSAGE =
  'The AI service is not available (not configured or out of credit). Please check the server settings.'
