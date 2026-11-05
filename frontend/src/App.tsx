import { Suspense, lazy, useEffect, useState } from 'react'
import Container from './components/ui/Container'
import { isDev } from './env'
import { navigateTo } from './navigation'
import ReceiptHistory from './ReceiptHistory'
import ReceiptItems from './ReceiptItems'
import ReceiptUpload from './ReceiptUpload'

const RECEIPT_QUERY_PARAM = 'receipt'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Dev-only style guide page (?view=styleguide). This dynamic import() must
// use the literal `import.meta.env.DEV` (not the mockable `isDev` below) --
// Vite statically replaces that exact expression with `false` in a
// production build, which lets Rollup's dead-code elimination drop both
// this reference and the entire StyleGuide chunk from the build (verified
// by grepping the built output, not assumed); an indirection through
// another module's export defeats that static analysis and leaves the
// chunk in dist/. `isDev` (from ./env, mockable in tests) separately gates
// whether the route/render logic below ever reaches it at runtime.
const StyleGuide = import.meta.env.DEV ? lazy(() => import('./StyleGuide')) : null

type View = 'upload' | 'history' | 'items' | 'styleguide'

function getView(): View {
  const params = new URLSearchParams(window.location.search)
  if (isDev && params.get('view') === 'styleguide') {
    return 'styleguide'
  }
  const view = params.get('view')
  if (view === 'history') return 'history'
  if (view === 'items') return 'items'
  return 'upload'
}

function isReceiptDetailView(): boolean {
  const receiptId = new URLSearchParams(window.location.search).get(RECEIPT_QUERY_PARAM)
  return receiptId !== null && UUID_PATTERN.test(receiptId)
}

// Which nav tab is "active" is a distinct question from which view renders:
// `?receipt=<id>` renders the upload component (it owns the saved-receipt
// view), but it is not the plain upload screen, so neither tab should claim
// it -- otherwise "Upload" stays marked current while looking at a receipt.
function getActiveNav(view: View): 'upload' | 'history' | 'items' | null {
  if (view === 'history') {
    return 'history'
  }
  if (view === 'items') {
    return 'items'
  }
  if (view === 'styleguide') {
    return null
  }
  return isReceiptDetailView() ? null : 'upload'
}

function getPageName(view: View): string {
  if (view === 'history') {
    return 'History'
  }
  if (view === 'items') {
    return 'Items'
  }
  if (view === 'styleguide') {
    return 'Style Guide'
  }

  return isReceiptDetailView() ? 'Receipt' : 'Upload'
}

function AppMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-8 w-8 flex-shrink-0">
      <rect x="1" y="1" width="22" height="22" rx="6" className="fill-brand" />
      <path
        d="M7 7h10M7 11.5h10M7 16h6"
        stroke="white"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  )
}

interface NavLinkProps {
  href: string
  search: string
  active: boolean
  children: string
}

const NAV_LINK_BASE =
  'border-b-2 px-1 py-2 text-sm transition-colors duration-150 motion-reduce:transition-none ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand'

function NavLink({ href, search, active, children }: NavLinkProps) {
  return (
    <a
      href={href}
      aria-current={active ? 'page' : undefined}
      onClick={(e) => {
        e.preventDefault()
        navigateTo(search)
      }}
      className={`${NAV_LINK_BASE} ${
        active
          ? 'border-brand font-semibold text-brand'
          : 'border-transparent font-medium text-ink-muted hover:border-slate-300 hover:text-ink'
      }`}
    >
      {children}
    </a>
  )
}

function App() {
  const [locationKey, setLocationKey] = useState(() => window.location.search)

  useEffect(() => {
    const handlePopState = () => setLocationKey(window.location.search)
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const view = getView()
  const activeNav = getActiveNav(view)
  const mainSize = (view === 'upload' && isReceiptDetailView()) || view === 'items' ? 'xl' : 'lg'

  useEffect(() => {
    document.title = `${getPageName(view)} · Smart Receipt AI`
  }, [view, locationKey])

  return (
    <div className="flex min-h-screen flex-col bg-surface-page">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-brand focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        Skip to content
      </a>

      <header className="border-b border-border bg-surface">
        <Container size="lg" className="flex items-center justify-between gap-4 py-3">
          <div className="flex items-center gap-2">
            <AppMark />
            <h1 className="text-lg font-bold text-ink sm:text-xl">Smart Receipt AI</h1>
          </div>

          <nav className="flex gap-4 text-sm">
            <NavLink href="/" search="" active={activeNav === 'upload'}>
              Upload
            </NavLink>
            <NavLink href="/?view=history" search="?view=history" active={activeNav === 'history'}>
              History
            </NavLink>
            <NavLink href="/?view=items" search="?view=items" active={activeNav === 'items'}>
              Items
            </NavLink>
          </nav>
        </Container>
      </header>

      <main id="main-content" className="flex-1 py-8">
        <Container size={mainSize}>
          {view === 'styleguide' && StyleGuide ? (
            <Suspense fallback={null}>
              <StyleGuide />
            </Suspense>
          ) : view === 'history' ? (
            <ReceiptHistory key={locationKey} />
          ) : view === 'items' ? (
            <ReceiptItems key={locationKey} />
          ) : (
            <ReceiptUpload key={locationKey} />
          )}
        </Container>
      </main>
    </div>
  )
}

export default App
