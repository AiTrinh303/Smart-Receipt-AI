const SEPARATOR = ' - '

/**
 * Shortens an apartment's full display name (e.g. "Fewo JoJo - Sankt
 * Englmar - Waldglück") down to just its last " - "-separated segment
 * (e.g. "Waldglück"), for use where the full name would be too wide
 * (table cells, badges). Falls back to the whole trimmed name when there's
 * no such separator, or the segment after the last one is empty.
 *
 * This is a display-only convenience -- a dedicated `short_name` column on
 * the apartment itself would be a cleaner, more explicit way to do this
 * long-term, rather than parsing it back out of the full name.
 */
export function apartmentShortName(name: string | null): string | null {
  if (name === null) {
    return null
  }
  if (name.trim() === '') {
    return null
  }

  const separatorIndex = name.lastIndexOf(SEPARATOR)
  if (separatorIndex !== -1) {
    const lastSegment = name.slice(separatorIndex + SEPARATOR.length).trim()
    if (lastSegment !== '') {
      return lastSegment
    }
  }

  return name.trim()
}
