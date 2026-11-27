/** A colour per apartment, so the two apartments are easy to tell apart at
 * a glance in lists, tabs and cards. Purely a visual aid: the apartment's
 * name is always shown as text too, and its full name stays in `title` and
 * the accessible name -- colour never carries the meaning on its own.
 *
 * Every class string below is complete and static (Tailwind only generates
 * CSS for class names it finds literally in the source), so callers use
 * them as they are and never build class names from the tone. */

export type ApartmentTone = 'sky' | 'fuchsia' | 'neutral'

/** Apartment id -> tone. To give an apartment a different colour, change
 * its entry here (and add tokens in tailwind.config.js for a new tone). An
 * id not listed here gets the neutral (muted) style. */
export const TONE_BY_APARTMENT_ID: Readonly<Record<string, ApartmentTone>> = {
  'oberaudorf-bergblick': 'sky',
  'sankt-englmar-waldglueck': 'fuchsia',
}

export interface ApartmentToneClasses {
  /** Soft pill: tone background + tone text (labels in lists). */
  pill: string
  /** A small dot before a name (tabs, choice cards, side panel). */
  dot: string
  /** A whole card in the apartment's tone (the Report's summary cards):
   * solid in the tone's main colour (the same as its dot), no border, as
   * one complete surface string for `Card`'s `surface` prop. Neutral is the
   * plain card (white, decorative `border-subtle`). */
  card: string
  /** Text on that card: `cardText` for the name and amount, `cardMutedText`
   * for the receipt count. White / white at 90% on a solid tone (>= 5.13:1,
   * measured in Button.contrast.test.ts); ink / ink-muted on the plain card. */
  cardText: string
  cardMutedText: string
}

export const APARTMENT_TONE_CLASSES: Readonly<Record<ApartmentTone, ApartmentToneClasses>> = {
  sky: {
    pill: 'bg-apartment-sky-soft text-apartment-sky',
    dot: 'bg-apartment-sky',
    card: 'bg-apartment-sky',
    cardText: 'text-white',
    cardMutedText: 'text-white/90',
  },
  fuchsia: {
    pill: 'bg-apartment-fuchsia-soft text-apartment-fuchsia',
    dot: 'bg-apartment-fuchsia',
    card: 'bg-apartment-fuchsia',
    cardText: 'text-white',
    cardMutedText: 'text-white/90',
  },
  neutral: {
    pill: 'bg-slate-100 text-ink-muted',
    dot: 'bg-ink-muted',
    card: 'border border-border-subtle bg-surface',
    cardText: 'text-ink',
    cardMutedText: 'text-ink-muted',
  },
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
