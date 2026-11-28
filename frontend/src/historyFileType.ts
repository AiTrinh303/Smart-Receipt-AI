import type { ReceiptFileType } from './api/types'

/** History's "File type" choices, in menu order: "All types" (value "",
 * never written to the URL) then exactly the three values GET /receipts'
 * `file_type` accepts. */
export const FILE_TYPE_OPTIONS: { value: '' | ReceiptFileType; label: string }[] = [
  { value: '', label: 'All types' },
  { value: 'pdf', label: 'PDF' },
  { value: 'jpg', label: 'JPG' },
  { value: 'png', label: 'PNG' },
]

/** A `type` URL value as a real file type, or null for "all": an unknown
 * or missing value is ignored, never sent as given -- the same spirit as
 * every other History filter. */
export function effectiveFileType(raw: string | null | undefined): ReceiptFileType | null {
  return raw === 'pdf' || raw === 'jpg' || raw === 'png' ? raw : null
}
