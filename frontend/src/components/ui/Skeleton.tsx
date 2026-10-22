interface SkeletonProps {
  className?: string
}

/** A loading placeholder block. aria-hidden since the loading state's own
 * role="status" text (kept in the DOM, visible or visually hidden) is what
 * actually announces progress to assistive tech -- this is decorative. */
function Skeleton({ className = '' }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-md bg-slate-200 motion-reduce:animate-none ${className}`}
    />
  )
}

export default Skeleton
