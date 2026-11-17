import type { HTMLAttributes, ReactNode } from 'react'

type Size = 'md' | 'lg' | 'xl'

interface ContainerProps extends HTMLAttributes<HTMLDivElement> {
  size?: Size
  children: ReactNode
}

/** The single source of truth for how wide a `size` is and how much
 * horizontal padding it gets, at every breakpoint. Exported so any other
 * element that must line up with a `Container` of a given `size` --
 * today, only the app shell's `<header>`, which renders its own
 * `Container` alongside `<main>`'s -- uses this exact mapping rather than
 * a second, hand-copied value that can drift out of sync. A page's own
 * content must never add a second `mx-auto`/`max-w-*` of its own inside
 * an existing `Container`: that re-centers within an already-centered
 * box, shifting its edges away from anything else (like the header) that
 * only goes through `Container` once. */
export const CONTAINER_SIZE_CLASSES: Record<Size, string> = {
  md: 'max-w-md',
  lg: 'max-w-3xl',
  xl: 'max-w-6xl',
}

function Container({ size = 'md', className = '', children, ...rest }: ContainerProps) {
  return (
    <div className={`mx-auto w-full px-4 ${CONTAINER_SIZE_CLASSES[size]} ${className}`} {...rest}>
      {children}
    </div>
  )
}

export default Container
