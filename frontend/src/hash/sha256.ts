/** Reads a File/Blob's bytes via FileReader (not Blob.arrayBuffer(), which
 * this project's jsdom test environment does not implement -- FileReader
 * is supported everywhere, including real browsers). Rejects on any
 * FileReader failure; sha256Hex below always catches this. */
function readAsArrayBuffer(file: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result)
      } else {
        reject(new Error('Could not read file as an ArrayBuffer.'))
      }
    }
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'))
    reader.readAsArrayBuffer(file)
  })
}

function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * SHA-256 of a file's bytes, as a lowercase 64-char hex string -- or `null`
 * when `crypto.subtle` (only available in a secure context) isn't present,
 * or the bytes can't be read for any reason. Never throws: a caller can
 * always skip duplicate detection entirely rather than block an upload on
 * it, since the server checks every upload regardless.
 */
export async function sha256Hex(file: File | Blob): Promise<string | null> {
  try {
    if (typeof crypto === 'undefined' || !crypto.subtle) {
      return null
    }
    const buffer = await readAsArrayBuffer(file)
    const digest = await crypto.subtle.digest('SHA-256', buffer)
    return bufferToHex(digest)
  } catch {
    return null
  }
}
