import type { ReactElement, ReactNode } from 'react'

type Variant = 'info' | 'success' | 'warning' | 'error'

interface AlertProps {
  variant: Variant
  children: ReactNode
  className?: string
}

const VARIANT_CLASSES: Record<Variant, string> = {
  info: 'bg-brand-soft text-ink border-brand/30',
  success: 'bg-success-soft text-success border-success/30',
  warning: 'bg-warning-soft text-warning border-warning/30',
  error: 'bg-danger-soft text-danger border-danger/30',
}

function InfoIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 flex-shrink-0" fill="none">
      <circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 9v4.5M10 6.75h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function SuccessIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 flex-shrink-0" fill="none">
      <circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M6.5 10.25l2.25 2.25L13.5 7.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function WarningIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 flex-shrink-0" fill="none">
      <path d="M10 3.5l8 13.5H2l8-13.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M10 8.5v3.5M10 11.75h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function ErrorIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 flex-shrink-0" fill="none">
      <circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7.5 7.5l5 5M12.5 7.5l-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

const VARIANT_ICONS: Record<Variant, () => ReactElement> = {
  info: InfoIcon,
  success: SuccessIcon,
  warning: WarningIcon,
  error: ErrorIcon,
}

function Alert({ variant, children, className = '' }: AlertProps) {
  const Icon = VARIANT_ICONS[variant]
  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      className={`flex items-start gap-2 rounded-control border px-4 py-3 text-sm ${VARIANT_CLASSES[variant]} ${className}`}
    >
      <Icon />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

export default Alert
