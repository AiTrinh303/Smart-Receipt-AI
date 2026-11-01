/** File validation shared by the single-file upload flow (ReceiptUpload.tsx)
 * and the batch upload engine (src/batch/) -- moved out verbatim, with no
 * behavior change, so both reuse the exact same rules. */

export const ACCEPTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.pdf']
export const ACCEPTED_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf']
export const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png']
export const PDF_SIGNATURE = '%PDF-'

export function getExtension(filename: string): string {
  const index = filename.lastIndexOf('.')
  return index === -1 ? '' : filename.slice(index).toLowerCase()
}

export function isValidFile(file: File): boolean {
  const extension = getExtension(file.name)
  if (!ACCEPTED_EXTENSIONS.includes(extension)) {
    return false
  }

  // Some browsers/environments don't always set `file.type`; only check it
  // when it's present, since the extension check already narrowed the type.
  if (file.type && !ACCEPTED_MIME_TYPES.includes(file.type)) {
    return false
  }

  return true
}

function readAsText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.readAsText(blob)
  })
}

export async function isLikelyValidPdf(file: File): Promise<boolean> {
  const header = await readAsText(file.slice(0, PDF_SIGNATURE.length))
  return header === PDF_SIGNATURE
}
