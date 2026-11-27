/** A colour per apartment, so the two apartments are easy to tell apart at
 * a glance in lists, tabs and cards. Purely a visual aid: the apartment's
 * name is always shown as text too, and its full name stays in `title` and
 * the accessible name -- colour never carries the meaning on its own.
 *
 * Every class string below is complete and static (Tailwind only generates
 * CSS for class names it finds literally in the source), so callers use
 * them as they are and never build class names from the tone. */

export type ApartmentTone = 'sky' | 'teal' | 'neutral'

/** Apartment id -> tone. To give an apartment a different colour, change
 * its entry here (and add tokens in tailwind.config.js for a new tone). An
 * id not listed here gets the neutral (muted) style. */
export const TONE_BY_APARTMENT_ID: Readonly<Record<string, ApartmentTone>> = {
  'oberaudorf-bergblick': 'sky',
  'sankt-englmar-waldglueck': 'teal',
}

export interface ApartmentToneClasses {
  /** Soft pill: tone background + tone text (labels in lists). */
  pill: string
  /** A small dot before a name (tabs, choice cards, report cards). */
  dot: string
}

export const APARTMENT_TONE_CLASSES: Readonly<Record<ApartmentTone, ApartmentToneClasses>> = {
  sky: { pill: 'bg-apartment-sky-soft text-apartment-sky', dot: 'bg-apartment-sky' },
  teal: { pill: 'bg-apartment-teal-soft text-apartment-teal', dot: 'bg-apartment-teal' },
  neutral: { pill: 'bg-slate-100 text-ink-muted', dot: 'bg-ink-muted' },
}

export function apartmentTone(apartmentId: string | null | undefined): ApartmentTone {
  if (!apartmentId) {
    return 'neutral'
  }
  return TONE_BY_APARTMENT_ID[apartmentId] ?? 'neutral'
}

export function apartmentToneClasses(apartmentId: string | null | undefined): ApartmentToneClasses {
  return APARTMENT_TONE_CLASSES[apartmentTone(apartmentId)]
}
