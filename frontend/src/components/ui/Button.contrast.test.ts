import resolveConfig from 'tailwindcss/resolveConfig'
import tailwindConfig from '../../../tailwind.config.js'
import { PRIMARY_DISABLED_COLOR_TOKENS, VARIANT_COLOR_TOKENS } from './Button'
import { apartmentToneClasses } from '../../format/apartmentTone'

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
  'apartment-sky',
  'apartment-sky-soft',
  'apartment-fuchsia',
  'apartment-fuchsia-soft',
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

// --- StatusBadge ("Needs review" / "Approved"), moved into ReviewBar -------
//
// Reported as "small and pale" in the saved-receipt-view ticket; measuring
// the actual built CSS values (not just the config) confirmed the pair
// already clears 4.5:1 -- the badge's problem was size/placement (fixed by
// ReviewBar), not color, so no token change was needed here.

describe.each([
  ['needs review (warning)', 'warning', 'warning-soft'],
  ['approved (success)', 'success', 'success-soft'],
] as const)('StatusBadge "%s" text meets 4.5:1 against its own badge background', (_label, text, background) => {
  test('measured ratio shown below', () => {
    const textHex = resolveToken(text) as string
    const backgroundHex = resolveToken(background) as string
    const ratio = contrastRatio(textHex, backgroundHex)
    // eslint-disable-next-line no-console
    console.log(`StatusBadge ${text} (${textHex}) on ${background} (${backgroundHex}) = ${ratio.toFixed(2)}:1`)
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  })
})

// --- Apartment tones (src/format/apartmentTone.ts) --------------------------
//
// Each apartment's label is tone text on its soft fill (a pill), and the
// same tone may sit on plain white (a dot next to a name, or the text if a
// fill is ever dropped) -- both pairs must clear 4.5:1 for normal text.
// The measured ratios are printed so a run shows the real values.

describe.each(['sky', 'fuchsia'])('apartment tone "%s"', (tone) => {
  const textHex = resolveToken(`apartment-${tone}`) as string
  const softHex = resolveToken(`apartment-${tone}-soft`) as string
  const whiteHex = resolveToken('white') as string

  test('tone text meets 4.5:1 on its soft background and on white -- measured ratios shown below', () => {
    const onSoft = contrastRatio(textHex, softHex)
    const onWhite = contrastRatio(textHex, whiteHex)
    // eslint-disable-next-line no-console
    console.log(
      `apartment ${tone}: text ${textHex} on soft ${softHex} = ${onSoft.toFixed(2)}:1, ` +
        `on white ${whiteHex} = ${onWhite.toFixed(2)}:1`,
    )
    expect(onSoft).toBeGreaterThanOrEqual(4.5)
    expect(onWhite).toBeGreaterThanOrEqual(4.5)
  })
})

// --- Apartment ids exactly as the API returns them ---------------------------
//
// GET /reports/yearly, /receipts, /items and /apartments all send these two
// ids (checked against the running backend). Every colour class their pill
// and dot use must name a token that really exists in the Tailwind theme --
// otherwise the class is in the markup but generates no CSS, which is how
// Waldglück's dot ended up an invisible empty space.

describe.each(['oberaudorf-bergblick', 'sankt-englmar-waldglueck'])('apartment id "%s"', (apartmentId) => {
  test('gets a real (non-neutral) tone whose every class resolves to a theme colour', () => {
    const { pill, dot, card } = apartmentToneClasses(apartmentId)
    const colourClasses = `${pill} ${dot} ${card}`.split(' ').filter((cls) => cls !== 'border')
    expect(colourClasses.every((cls) => cls.includes('apartment-'))).toBe(true)
    for (const cls of colourClasses) {
      const token = cls.replace(/^(bg|text|border)-/, '')
      expect(resolveToken(token)).toMatch(HEX_PATTERN)
    }
  })
})

// --- Text on an apartment-toned card (the Report's summary cards) ----------
//
// The name and amount are `ink`, the receipt count `ink-muted`, both on the
// tone's `tint` (-100). Ratios printed so a run shows the measured values.
// The -200 shades are printed too (not used, no assertion), to compare if a
// darker card is wanted later; the "Both apartments" card (slate-100) is
// checked as well.

const SHADES_200: Record<string, string> = { sky: '#bae6fd', fuchsia: '#f5d0fe' }

describe.each(['sky', 'fuchsia'])('text on the "%s" summary card', (tone) => {
  test('ink and ink-muted meet 4.5:1 on the tint -- measured ratios (and the -200 shade for comparison) shown below', () => {
    const tintHex = resolveToken(`apartment-${tone}-tint`) as string
    const inkHex = resolveToken('ink') as string
    const inkMutedHex = resolveToken('ink-muted') as string
    const ink = contrastRatio(inkHex, tintHex)
    const inkMuted = contrastRatio(inkMutedHex, tintHex)
    const shade200 = SHADES_200[tone]
    // eslint-disable-next-line no-console
    console.log(
      `${tone} card tint ${tintHex}: ink ${ink.toFixed(2)}:1, ink-muted ${inkMuted.toFixed(2)}:1 | ` +
        `for comparison ${tone}-200 ${shade200}: ink ${contrastRatio(inkHex, shade200).toFixed(2)}:1, ` +
        `ink-muted ${contrastRatio(inkMutedHex, shade200).toFixed(2)}:1`,
    )
    expect(ink).toBeGreaterThanOrEqual(4.5)
    expect(inkMuted).toBeGreaterThanOrEqual(4.5)
  })
})

test('ink and ink-muted meet 4.5:1 on the "Both apartments" card (slate-100) -- measured ratios shown below', () => {
  const slate100 = '#f1f5f9'
  const ink = contrastRatio(resolveToken('ink') as string, slate100)
  const inkMuted = contrastRatio(resolveToken('ink-muted') as string, slate100)
  // eslint-disable-next-line no-console
  console.log(`Both apartments card slate-100 ${slate100}: ink ${ink.toFixed(2)}:1, ink-muted ${inkMuted.toFixed(2)}:1`)
  expect(ink).toBeGreaterThanOrEqual(4.5)
  expect(inkMuted).toBeGreaterThanOrEqual(4.5)
})
