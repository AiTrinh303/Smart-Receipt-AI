import type { HTMLAttributes, ReactNode } from 'react'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  /** `default`: white surface, decorative `border-subtle` border.
   * `emphasis`: a `brand-soft` fill with a faint brand border, for the one
   * card in a group that matters most (e.g. the Report's "Both apartments"
   * total). Complete static class strings for each, never combined with a
   * second background class. */
  variant?: 'default' | 'emphasis'
}

const VARIANT_CLASSES = {
  default: 'border-border-subtle bg-surface',
  emphasis: 'border-brand/30 bg-brand-soft',
} as const

function Card({ children, className = '', variant = 'default', ...rest }: CardProps) {
  return (
    <div
      className={`rounded-card border p-5 shadow-card sm:p-6 ${VARIANT_CLASSES[variant]} ${className}`}
      {...rest}
    >
      {children}
    </div>
  )
}

export default Card
