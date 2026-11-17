import resolveConfig from 'tailwindcss/resolveConfig'
import tailwindConfig from '../../../tailwind.config.js'
import { PRIMARY_DISABLED_COLOR_TOKENS, VARIANT_COLOR_TOKENS } from './Button'

const HEX_PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

const fullConfig = resolveConfig(tailwindConfig as never)
const themeColors = fullConfig.theme.colors as Record<string, unknown>

/** Resolves a dash-separated token name ("brand-hover") against the merged
 * Tailwind theme colors, the same way the matching `bg-<token>`/
 * `text-<token>`/`border-<token>` utility class would. */
function resolveToken(token: string): string | undefined {
  let node: unknown = themeColors
  for (const part of token.split('-')) {
    if (node === null || typeof node !== 'object') {
      return undefined
    }
    node = (node as Record<string, unknown>)[part]
  }
  if (typeof node === 'string') {
    return node
  }
  if (node && typeof node === 'object' && typeof (node as { DEFAULT?: unknown }).DEFAULT === 'string') {
    return (node as { DEFAULT: string }).DEFAULT
  }
  return undefined
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace('#', '')
  const full =
    normalized.length === 3
      ? normalized
          .split('')
          .map((c) => c + c)
          .join('')
      : normalized
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ]
}

function channelLuminance(channel: number): number {
  const s = channel / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex)
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b)
}

function contrastRatio(hexA: string, hexB: string): number {
  const a = relativeLuminance(hexA)
  const b = relativeLuminance(hexB)
  const lighter = Math.max(a, b)
  const darker = Math.min(a, b)
  return (lighter + 0.05) / (darker + 0.05)
}

// Every custom color token this design system defines (tailwind.config.js
// theme.extend.colors). A token resolving to undefined/empty would mean the
// matching utility class (e.g. bg-brand) generates no declaration at all --
// exactly the silent-failure mode a real browser would show as an invisible
// element, which jsdom's tests can't see.
const ALL_CUSTOM_TOKENS = [
  'brand',
  'brand-hover',
  'brand-soft',
  'brand-subtle',
  'ink',
  'ink-muted',
  'border',
  'border-subtle',
  'surface',
  'surface-page',
  'success',
  'success-soft',
  'warning',
  'warning-soft',
  'danger',
  'danger-soft',
  'white',
]

test('every color token used by the design system resolves to a valid hex color', () => {
  for (const token of ALL_CUSTOM_TOKENS) {
    const resolved = resolveToken(token)
    expect(resolved).toEqual(expect.any(String))
    expect(resolved).not.toBe('')
    expect(resolved).toMatch(HEX_PATTERN)
  }
})

const PAGE_BACKGROUND = resolveToken('white') as string

describe.each(Object.entries(VARIANT_COLOR_TOKENS))('Button variant "%s"', (_variant, tokens) => {
  test('every token it references resolves to a valid color', () => {
    for (const token of [tokens.background, tokens.text, tokens.border].filter(
      (t): t is string => t !== null && t !== undefined,
    )) {
      expect(resolveToken(token)).toMatch(HEX_PATTERN)
    }
  })

  test('text meets 4.5:1 contrast against its background (or the page, for a borderless fill)', () => {
    const textHex = resolveToken(tokens.text) as string
    const backgroundHex = resolveToken(tokens.background ?? 'white') as string
    expect(contrastRatio(textHex, backgroundHex)).toBeGreaterThanOrEqual(4.5)
  })

  test('a border-only (no-fill) variant has a border meeting 3:1 against the page', () => {
    if (tokens.background !== null) {
      return
    }
    expect(tokens.border).toBeTruthy()
    const borderHex = resolveToken(tokens.border as string) as string
    expect(contrastRatio(borderHex, PAGE_BACKGROUND)).toBeGreaterThanOrEqual(3)
  })
})

test("the enabled primary button's background token differs from its text token", () => {
  const { background, text } = VARIANT_COLOR_TOKENS.primary
  expect(background).not.toBe(text)
  expect(resolveToken(background as string)).not.toBe(resolveToken(text))
})

// --- New tokens from the visual design refresh (border-subtle, brand-subtle) ---

describe('ink-muted (the app-wide "secondary text" color)', () => {
  test('meets 4.5:1 against white', () => {
    const inkMuted = resolveToken('ink-muted') as string
    expect(contrastRatio(inkMuted, resolveToken('white') as string)).toBeGreaterThanOrEqual(4.5)
  })

  test('meets 4.5:1 against the page background (surface-page)', () => {
    const inkMuted = resolveToken('ink-muted') as string
    expect(contrastRatio(inkMuted, resolveToken('surface-page') as string)).toBeGreaterThanOrEqual(4.5)
  })

  test('meets 4.5:1 against brand-subtle (a selected RadioCardGroup card\'s second line)', () => {
    const inkMuted = resolveToken('ink-muted') as string
    expect(contrastRatio(inkMuted, resolveToken('brand-subtle') as string)).toBeGreaterThanOrEqual(4.5)
  })
})

test('ink (primary text) meets 4.5:1 against brand-subtle (a selected RadioCardGroup card\'s label)', () => {
  const ink = resolveToken('ink') as string
  expect(contrastRatio(ink, resolveToken('brand-subtle') as string)).toBeGreaterThanOrEqual(4.5)
})

test('the brand border on a selected RadioCardGroup card meets 3:1 against its own brand-subtle background', () => {
  const brand = resolveToken('brand') as string
  expect(contrastRatio(brand, resolveToken('brand-subtle') as string)).toBeGreaterThanOrEqual(3)
})

test('border-subtle is a valid color but is NOT required to meet any contrast minimum -- decorative containers only, never an interactive control, a selectable card, or a dropzone', () => {
  expect(resolveToken('border-subtle')).toMatch(HEX_PATTERN)
})

// --- Disabled primary button (e.g. the Upload form's "Read receipt") ------
//
// A disabled button's text is still read by the user while they work out
// what's missing (an apartment, a file, or both) -- it needs the same
// 4.5:1 floor as any other normal text, not a pass given "it's disabled
// anyway."

describe('the disabled primary button', () => {
  const backgroundHex = resolveToken(PRIMARY_DISABLED_COLOR_TOKENS.background as string) as string
  const textHex = resolveToken(PRIMARY_DISABLED_COLOR_TOKENS.text) as string

  test('both tokens resolve to valid colors', () => {
    expect(backgroundHex).toMatch(HEX_PATTERN)
    expect(textHex).toMatch(HEX_PATTERN)
  })

  test('text meets 4.5:1 against its background -- measured ratio shown below', () => {
    const ratio = contrastRatio(textHex, backgroundHex)
    // Printed so a real run's output shows the actual measured value, not
    // just a pass/fail -- e.g. "disabled primary: slate-700 (#334155) on
    // slate-300 (#cbd5e1) = 6.97:1".
    // eslint-disable-next-line no-console
    console.log(
      `disabled primary: ${PRIMARY_DISABLED_COLOR_TOKENS.text} (${textHex}) on ` +
        `${PRIMARY_DISABLED_COLOR_TOKENS.background} (${backgroundHex}) = ${ratio.toFixed(2)}:1`,
    )
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  })
})
