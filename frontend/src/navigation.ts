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
