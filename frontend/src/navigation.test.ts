import { isPlainLeftClick } from './navigation'

const PLAIN = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false }

test('only an unmodified primary-button click counts as a plain click', () => {
  // Given a plain left click
  // Then it is handled in place
  expect(isPlainLeftClick(PLAIN)).toBe(true)

  // Given any modifier, or another button
  // Then the browser should handle it
  expect(isPlainLeftClick({ ...PLAIN, ctrlKey: true })).toBe(false)
  expect(isPlainLeftClick({ ...PLAIN, metaKey: true })).toBe(false)
  expect(isPlainLeftClick({ ...PLAIN, shiftKey: true })).toBe(false)
  expect(isPlainLeftClick({ ...PLAIN, altKey: true })).toBe(false)
  expect(isPlainLeftClick({ ...PLAIN, button: 1 })).toBe(false)
})
