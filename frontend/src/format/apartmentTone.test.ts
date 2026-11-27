import { APARTMENT_TONE_CLASSES, apartmentTone, apartmentToneClasses } from './apartmentTone'

test('each known apartment has its own tone; anything else is neutral', () => {
  // Given the two seeded apartment ids, an unknown id and no id
  // Then Bergblick is sky, Waldglück fuchsia, and the rest neutral
  expect(apartmentTone('oberaudorf-bergblick')).toBe('sky')
  expect(apartmentTone('sankt-englmar-waldglueck')).toBe('fuchsia')
  expect(apartmentTone('some-new-apartment')).toBe('neutral')
  expect(apartmentTone(null)).toBe('neutral')
  expect(apartmentTone(undefined)).toBe('neutral')
})

test('the class strings are complete, static Tailwind classes', () => {
  // Then every tone has a pill (bg + text) and a dot class, all literal
  expect(apartmentToneClasses('oberaudorf-bergblick')).toEqual({
    pill: 'bg-apartment-sky-soft text-apartment-sky',
    dot: 'bg-apartment-sky',
    card: 'border border-apartment-sky/30 bg-apartment-sky-soft',
  })
  expect(apartmentToneClasses('sankt-englmar-waldglueck')).toEqual({
    pill: 'bg-apartment-fuchsia-soft text-apartment-fuchsia',
    dot: 'bg-apartment-fuchsia',
    card: 'border border-apartment-fuchsia/30 bg-apartment-fuchsia-soft',
  })
  expect(APARTMENT_TONE_CLASSES.neutral).toEqual({
    pill: 'bg-slate-100 text-ink-muted',
    dot: 'bg-ink-muted',
    card: 'border border-border-subtle bg-surface',
  })
})
