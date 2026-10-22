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
  ghost:
    'bg-transparent text-brand border border-brand hover:bg-brand-soft disabled:border-slate-300 disabled:text-slate-400',
  'danger-ghost':
    'bg-transparent text-danger border border-danger hover:bg-danger-soft disabled:border-slate-300 disabled:text-slate-400',
}

/**
 * Single source of truth for each variant's enabled-state color tokens
 * (token names, matching the token names used in VARIANT_CLASSES above --
 * e.g. "brand" <-> "bg-brand"/"border-brand"). `Button.contrast.test.ts`
 * resolves these against the real Tailwind theme and checks every pair for
 * valid colors and WCAG contrast, so a future token/variant change that
 * breaks visibility (an invalid token, or a background/text pair that no
 * longer contrasts) fails a fast, colorless-jsdom-safe test instead of only
 * showing up as an invisible button in a real browser.
 */
export interface VariantColorTokens {
  /** null for a variant that relies on its border + text, not a fill. */
  background: string | null
  text: string
  border?: string
}

export const VARIANT_COLOR_TOKENS: Record<Variant, VariantColorTokens> = {
  primary: { background: 'brand', text: 'white' },
  secondary: { background: 'white', text: 'ink', border: 'border' },
  danger: { background: 'danger', text: 'white' },
  ghost: { background: null, text: 'brand', border: 'brand' },
  'danger-ghost': { background: null, text: 'danger', border: 'danger' },
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
