/**
 * Minimal router-less navigation: updates the URL via `pushState` (so the
 * browser back/forward buttons work) and dispatches a synthetic `popstate`
 * event so any listener (e.g. App's view switch) picks up the change, since
 * `pushState`/`replaceState` never fire `popstate` on their own.
 */
export function navigateTo(search: string) {
  const newUrl = `${window.location.pathname}${search}${window.location.hash}`
  window.history.pushState({}, '', newUrl)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

/** True for a plain primary-button click: no ctrl/cmd/shift/alt. Every
 * internal link's click handler navigates in place (and calls
 * `preventDefault`) only in that case; any other click -- ctrl/cmd-click
 * (new tab), shift-click (new window), alt-click (download), or a
 * non-primary button -- is left entirely to the browser, which then uses
 * the link's real `href`. So every such link's `href` must hold the full
 * target, `from=` included. (Middle-click fires `auxclick`, not `click`,
 * so it never reaches these handlers and always works.) */
export function isPlainLeftClick(event: {
  button: number
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}
