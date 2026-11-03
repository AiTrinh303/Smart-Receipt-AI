import { apartmentShortName } from './apartmentShortName'

test('a real apartment name returns its last " - "-separated segment', () => {
  expect(apartmentShortName('Fewo JoJo - Sankt Englmar - Waldglück')).toBe('Waldglück')
})

test('a second real apartment name also returns its last segment', () => {
  expect(apartmentShortName('Fewo JoJo - Oberaudorf - Bergblick')).toBe('Bergblick')
})

test('a name with no " - " returns the whole trimmed name', () => {
  expect(apartmentShortName('Waldglück Alone')).toBe('Waldglück Alone')
})

test('a name with a trailing " - " and nothing after it returns the whole trimmed name', () => {
  expect(apartmentShortName('Alpha - ')).toBe('Alpha -')
})

test('null returns null', () => {
  expect(apartmentShortName(null)).toBeNull()
})

test('a blank name returns null', () => {
  expect(apartmentShortName('   ')).toBeNull()
})
