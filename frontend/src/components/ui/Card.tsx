import type { HTMLAttributes, ReactNode } from 'react'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  /** `default`: white surface, decorative 1px `border-subtle` border.
   * `emphasis`: a neutral `slate-100` fill with the same decorative border
   * -- for the one card in a group that sums up the others (the Report's
   * "Both apartments" total). Not a brand border: that reads as a focused
   * control. */
  variant?: 'default' | 'emphasis'
  /** A complete border-and-background class string that replaces the
   * variant's own (e.g. an apartment's tone from
   * `apartmentToneClasses(id).card`). Never combined with the variant's,
   * so a card never carries two competing background/border classes. */
  surface?: string
}

const VARIANT_SURFACE_CLASSES = {
  default: 'border border-border-subtle bg-surface',
  emphasis: 'border border-border-subtle bg-slate-100',
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
