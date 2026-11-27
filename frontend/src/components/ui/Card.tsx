import type { HTMLAttributes, ReactNode } from 'react'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  /** `default`: white surface, decorative 1px `border-subtle` border.
   * `emphasis`: a solid `slate-700` fill, no border -- for the card that
   * sums up a set of solid-coloured cards (the Report's "Both apartments"
   * total next to the two apartment cards). Its content must use white
   * text (white 10.35:1, white/90 8.76:1). */
  variant?: 'default' | 'emphasis'
  /** A complete border-and-background class string that replaces the
   * variant's own (e.g. an apartment's tone from
   * `apartmentToneClasses(id).card`). Never combined with the variant's,
   * so a card never carries two competing background/border classes. */
  surface?: string
}

const VARIANT_SURFACE_CLASSES = {
  default: 'border border-border-subtle bg-surface',
  emphasis: 'bg-slate-700',
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
