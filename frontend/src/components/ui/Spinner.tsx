interface SpinnerProps {
  size?: 'sm' | 'md'
  label?: string
  className?: string
}

const SIZE_CLASSES: Record<NonNullable<SpinnerProps['size']>, string> = {
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
}

function Spinner({ size = 'md', label = 'Loading', className = '' }: SpinnerProps) {
  return (
    <svg
      role="status"
      aria-label={label}
      className={`animate-spin text-current ${SIZE_CLASSES[size]} ${className}`}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
  )
}

export default Spinner
