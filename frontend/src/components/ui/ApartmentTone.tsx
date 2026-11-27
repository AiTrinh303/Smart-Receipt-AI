import type { ReactNode } from 'react'
import { apartmentToneClasses } from '../../format/apartmentTone'

function ApartmentIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5 flex-shrink-0" fill="none">
      <path
        d="M4 17.5V5.5a1 1 0 011-1h4.5v13M11.5 17.5V9h3.5a1 1 0 011 1v7.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M6 7.5h1M6 10.5h1M6 13.5h1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

/** An apartment label in a list (History rows, Items, the upload side
 * panel): a soft pill in the apartment's tone, with the building icon. The
 * caller decides the text inside (short name, plus any hidden full name)
 * and passes the full name as `title`. */
export function ApartmentPill({
  apartmentId,
  title,
  children,
}: {
  apartmentId: string | null | undefined
  title?: string
  children: ReactNode
}) {
  return (
    <span
      title={title}
      className={`inline-flex min-w-0 max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
        apartmentToneClasses(apartmentId).pill
      }`}
    >
      <ApartmentIcon />
      {children}
    </span>
  )
}

/** A small dot in the apartment's tone, placed before its name in tabs,
 * choice cards and report cards. Decorative (`aria-hidden`): the name next
 * to it says which apartment it is. */
export function ApartmentDot({ apartmentId }: { apartmentId: string | null | undefined }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-2 w-2 flex-shrink-0 rounded-full ${apartmentToneClasses(apartmentId).dot}`}
    />
  )
}
