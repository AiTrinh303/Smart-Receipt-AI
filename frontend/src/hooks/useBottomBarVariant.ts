import { useMediaQuery } from './useMediaQuery'

/** Decides between ReviewBar's two variants: a bar fixed to the bottom of
 * the viewport (below `lg`) or one sticky under the header (`lg` and up).
 * Unlike most of this app's `useMediaQuery` calls, the no-`matchMedia`
 * fallback (jsdom's default) here must render the `lg` variant, not the
 * narrow-screen one -- `useMediaQuery` itself always returns `false` in
 * that case, which would otherwise read as "narrow screen" by accident.
 * Both ReviewBar (to pick its own layout) and the page around it (to add
 * bottom padding so the fixed bar never hides content) call this, so the
 * two can never disagree about which variant is showing. */
export function useBottomBarVariant(): boolean {
  const hasMatchMedia = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  const isNarrowScreen = useMediaQuery('(max-width: 1023px)')
  return hasMatchMedia && isNarrowScreen
}
