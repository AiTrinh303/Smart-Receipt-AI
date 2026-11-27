/** Dispatches a real `click` on a link and returns the event, so a test can
 * check whether the app's handler cancelled the browser's own handling. */
export function clickLink(link: Element, modifiers: { ctrlKey?: boolean; metaKey?: boolean } = {}): MouseEvent {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...modifiers })
  link.dispatchEvent(event)
  return event
}

/** Asserts the pattern every internal link follows: a ctrl-click and a
 * cmd-click are left to the browser (not prevented, URL unchanged), and a
 * plain click is handled in place (prevented, URL now the link's target). */
export function expectBrowserHandlesModifiedClicks(link: Element, expectedSearch: string) {
  const before = window.location.search
  for (const modifier of [{ ctrlKey: true }, { metaKey: true }]) {
    const event = clickLink(link, modifier)
    expect(event.defaultPrevented).toBe(false)
    expect(window.location.search).toBe(before)
  }
  const plain = clickLink(link)
  expect(plain.defaultPrevented).toBe(true)
  expect(window.location.search).toBe(expectedSearch)
}
