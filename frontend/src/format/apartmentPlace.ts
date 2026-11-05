const SEPARATOR = ' - '

/**
 * Pulls the middle, place-naming segment out of an apartment's full display
 * name (e.g. "Fewo JoJo - Sankt Englmar - Waldglück" -> "Sankt Englmar"), for
 * use as a muted second line next to apartmentShortName's bold first line.
 *
 * Deliberately narrow: only a name with EXACTLY 3 " - "-separated segments
 * has an unambiguous "place" segment (the middle one). Anything else (no
 * separator, 2 segments, 4+ segments) returns null rather than guessing --
 * the caller then simply shows no second line.
 */
export function apartmentPlace(name: string | null): string | null {
  if (name === null) {
    return null
  }

  const segments = name.split(SEPARATOR).map((segment) => segment.trim())
  if (segments.length !== 3) {
    return null
  }

  const place = segments[1]
  return place !== '' ? place : null
}
