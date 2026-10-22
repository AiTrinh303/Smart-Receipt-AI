import type { ReactNode } from 'react'

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

function Alert({ variant, children, className = '' }: AlertProps) {
  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      className={`rounded-md border px-4 py-3 text-sm ${VARIANT_CLASSES[variant]} ${className}`}
    >
      {children}
    </div>
  )
}

export default Alert
