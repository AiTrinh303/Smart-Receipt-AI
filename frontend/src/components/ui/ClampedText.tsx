interface ClampedTextProps {
  text: string
  lines: 1 | 2
  className?: string
}

const LINE_CLASSES: Record<1 | 2, string> = {
  1: 'line-clamp-1',
  2: 'line-clamp-2',
}

/** Truncates long text (a product title, a long store name) to a fixed
 * number of lines instead of letting it wrap indefinitely and blow up row
 * height. The full text is always still available via `title` (shown on
 * hover) and in the DOM for text queries/screen readers -- only the visual
 * rendering is clamped. */
function ClampedText({ text, lines, className = '' }: ClampedTextProps) {
  return (
    <span title={text || undefined} className={`break-words ${LINE_CLASSES[lines]} ${className}`}>
      {text}
    </span>
  )
}

export default ClampedText
