/** A quieter stand-in for a missing value than the plain words "Not
 * detected" -- a visible dash (decorative, so it never gets announced
 * twice) plus visually hidden text that keeps "Not detected" findable by
 * assistive tech and by any test still querying for that exact text. */
function MissingValue() {
  return (
    <span>
      <span aria-hidden="true">—</span>
      <span className="sr-only">Not detected</span>
    </span>
  )
}

export default MissingValue
