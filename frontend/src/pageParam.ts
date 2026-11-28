/** A `page` URL value as a page number: anything that isn't a whole number
 * of 1 or more means page 1. (Too large is handled by the page once the
 * total is known: it becomes the last page.) Shared by History and Items. */
export function parsePage(raw: string | null): number {
  if (raw === null || !/^\d+$/.test(raw)) return 1
  const page = Number(raw)
  return page >= 1 ? page : 1
}
