import { apartmentPlace } from './apartmentPlace'

test('a real apartment name with exactly 3 segments returns the middle one', () => {
  expect(apartmentPlace('Fewo JoJo - Sankt Englmar - Waldglück')).toBe('Sankt Englmar')
})

test('a second real apartment name also returns its middle segment', () => {
  expect(apartmentPlace('Fewo JoJo - Oberaudorf - Bergblick')).toBe('Oberaudorf')
})

test('a name with no " - " returns null', () => {
  expect(apartmentPlace('Waldglück Alone')).toBeNull()
})

test('a name with only 2 segments returns null', () => {
  expect(apartmentPlace('Oberaudorf - Bergblick')).toBeNull()
})

test('a name with 4 segments returns null', () => {
  expect(apartmentPlace('A - B - C - D')).toBeNull()
})

test('a name whose middle segment is blank returns null', () => {
  expect(apartmentPlace('A -  - C')).toBeNull()
})

test('null returns null', () => {
  expect(apartmentPlace(null)).toBeNull()
})
