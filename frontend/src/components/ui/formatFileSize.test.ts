import { formatFileSize } from './formatFileSize'

test('formats bytes, kilobytes and megabytes', () => {
  expect(formatFileSize(500)).toBe('500 B')
  expect(formatFileSize(2048)).toBe('2 KB')
  expect(formatFileSize(1572864)).toBe('1.5 MB')
})
