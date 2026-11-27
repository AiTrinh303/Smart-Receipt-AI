import type { HTMLAttributes, ReactNode } from 'react'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  /** `default`: white surface, decorative 1px `border-subtle` border.
   * `emphasis`: still white, but a 2px `brand` border -- for the one card
   * in a group that matters most (the Report's "Both apartments" total). */
  variant?: 'default' | 'emphasis'
  /** A complete border-and-background class string that replaces the
   * variant's own (e.g. an apartment's tone from
   * `apartmentToneClasses(id).card`). Never combined with the variant's,
   * so a card never carries two competing background/border classes. */
  surface?: string
}

const VARIANT_SURFACE_CLASSES = {
  default: 'border border-border-subtle bg-surface',
  emphasis: 'border-2 border-brand bg-surface',
} as const

function Card({ children, className = '', variant = 'default', surface, ...rest }: CardProps) {
  return (
    <div
      className={`rounded-card p-5 shadow-card sm:p-6 ${surface ?? VARIANT_SURFACE_CLASSES[variant]} ${className}`}
      {...rest}
    >
      {children}
    </div>
  )
}

export default Card
