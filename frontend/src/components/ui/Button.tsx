import type { ButtonHTMLAttributes, ReactNode } from 'react'
import Spinner from './Spinner'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'danger-ghost'
type Size = 'sm' | 'md'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  loadingText?: string
  children: ReactNode
}

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-md font-semibold ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ' +
  'disabled:cursor-not-allowed transition-colors'

const SIZE_CLASSES: Record<Size, string> = {
  sm: 'min-h-[44px] px-3 py-2 text-sm sm:min-h-0 sm:py-1.5',
  md: 'min-h-[44px] px-4 py-2.5 text-sm',
}

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-hover disabled:bg-slate-300 disabled:text-slate-600',
  secondary:
    'bg-white text-ink border border-border hover:bg-slate-50 disabled:text-slate-400 disabled:bg-slate-100',
  danger: 'bg-danger text-white hover:bg-red-800 disabled:bg-slate-300 disabled:text-slate-600',
  ghost: 'bg-transparent text-brand hover:bg-brand-soft disabled:text-slate-400',
  'danger-ghost': 'bg-transparent text-danger hover:bg-danger-soft disabled:text-slate-400',
}

function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  loadingText,
  disabled,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading

  return (
    <button
      type="button"
      disabled={isDisabled}
      className={`${BASE} ${SIZE_CLASSES[size]} ${VARIANT_CLASSES[variant]} ${className}`}
      {...rest}
    >
      {loading && <Spinner size="sm" label="" />}
      {loading && loadingText ? loadingText : children}
    </button>
  )
}

export default Button
