import { useEffect, useState } from 'react'
import Container from './components/ui/Container'
import { navigateTo } from './navigation'
import ReceiptHistory from './ReceiptHistory'
import ReceiptUpload from './ReceiptUpload'

const RECEIPT_QUERY_PARAM = 'receipt'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function getView(): 'upload' | 'history' {
  const params = new URLSearchParams(window.location.search)
  return params.get('view') === 'history' ? 'history' : 'upload'
}

function getPageName(view: 'upload' | 'history'): string {
  if (view === 'history') {
    return 'History'
  }

  const receiptId = new URLSearchParams(window.location.search).get(RECEIPT_QUERY_PARAM)
  return receiptId && UUID_PATTERN.test(receiptId) ? 'Receipt' : 'Upload'
}

function AppMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-7 w-7 flex-shrink-0 text-brand"
      fill="none"
    >
      <rect x="4" y="2" width="16" height="20" rx="2" fill="currentColor" opacity="0.15" />
      <path
        d="M7 7h10M7 11h10M7 15h6"
        stroke="currentColor"
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

function NavLink({ href, search, active, children }: NavLinkProps) {
  return (
    <a
      href={href}
      aria-current={active ? 'page' : undefined}
      onClick={(e) => {
        e.preventDefault()
        navigateTo(search)
      }}
      className={`rounded-md px-3 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
        active ? 'bg-brand-soft text-brand' : 'text-ink-muted hover:bg-slate-100 hover:text-ink'
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

          <nav className="flex gap-1 text-sm font-medium">
            <NavLink href="/" search="" active={view === 'upload'}>
              Upload
            </NavLink>
            <NavLink href="/?view=history" search="?view=history" active={view === 'history'}>
              History
            </NavLink>
          </nav>
        </Container>
      </header>

      <main id="main-content" className="flex-1 py-8">
        <Container size="lg">
          {view === 'history' ? (
            <ReceiptHistory key={locationKey} />
          ) : (
            <ReceiptUpload key={locationKey} />
          )}
        </Container>
      </main>
    </div>
  )
}

export default App
