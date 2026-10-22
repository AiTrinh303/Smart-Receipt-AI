/** jsdom implements neither URL.createObjectURL nor URL.revokeObjectURL.
 * Call this explicitly (in beforeEach) from any test that selects an image
 * file through ReceiptUpload, since that now creates an object URL for the
 * preview thumbnail. Never installed globally, so a test suite that forgets
 * to mock it still fails loudly instead of silently passing. */
export function mockObjectUrl() {
  let counter = 0
  const createObjectURL = jest.fn(() => `blob:mock-url-${counter++}`)
  const revokeObjectURL = jest.fn()

  const original = {
    createObjectURL: URL.createObjectURL,
    revokeObjectURL: URL.revokeObjectURL,
  }

  URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL
  URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL

  return {
    createObjectURL,
    revokeObjectURL,
    restore: () => {
      URL.createObjectURL = original.createObjectURL
      URL.revokeObjectURL = original.revokeObjectURL
    },
  }
}
