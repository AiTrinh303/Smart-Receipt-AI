import { webcrypto } from 'node:crypto'
import { sha256Hex } from './sha256'

const KNOWN_VECTOR_HASH = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'

describe('sha256Hex', () => {
  describe('with crypto.subtle available', () => {
    // jsdom's `crypto` global exists but has no `.subtle` (SubtleCrypto)
    // implementation in this project's test environment -- confirmed by
    // inspecting it directly (Object.getOwnPropertyDescriptor(globalThis.
    // crypto, 'subtle') is undefined). Node's own built-in WebCrypto does
    // provide a real `.subtle`, so it is polyfilled here via
    // Object.defineProperty, scoped to this describe block only (restored
    // in afterEach), to exercise the real hashing path other tests fake.
    let hadSubtle: boolean

    beforeEach(() => {
      hadSubtle = 'subtle' in globalThis.crypto
      if (!hadSubtle) {
        Object.defineProperty(globalThis.crypto, 'subtle', {
          value: webcrypto.subtle,
          configurable: true,
        })
      }
    })

    afterEach(() => {
      if (!hadSubtle) {
        // @ts-expect-error removing the test-only polyfill
        delete globalThis.crypto.subtle
      }
    })

    test('known vector: "abc" hashes to the expected SHA-256 hex digest', async () => {
      const file = new File(['abc'], 'test.txt')
      await expect(sha256Hex(file)).resolves.toBe(KNOWN_VECTOR_HASH)
    })

    test('different bytes hash differently', async () => {
      const a = await sha256Hex(new File(['one'], 'a.txt'))
      const b = await sha256Hex(new File(['two'], 'b.txt'))
      expect(a).not.toBeNull()
      expect(a).not.toBe(b)
    })

    test('the same bytes always hash the same way', async () => {
      const a = await sha256Hex(new File(['identical'], 'a.txt'))
      const b = await sha256Hex(new File(['identical'], 'b.txt'))
      expect(a).toBe(b)
    })
  })

  describe("without crypto.subtle (this project's jsdom default)", () => {
    test('returns null rather than throwing', async () => {
      expect(globalThis.crypto.subtle).toBeUndefined()
      const file = new File(['abc'], 'test.txt')
      await expect(sha256Hex(file)).resolves.toBeNull()
    })
  })

  test('returns null when crypto is entirely undefined', async () => {
    const original = globalThis.crypto
    // @ts-expect-error test-only removal of the whole global
    delete globalThis.crypto
    try {
      const file = new File(['abc'], 'test.txt')
      await expect(sha256Hex(file)).resolves.toBeNull()
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: original, configurable: true })
    }
  })
})
