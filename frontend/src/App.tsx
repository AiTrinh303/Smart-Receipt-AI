import { useEffect, useState } from 'react'
import { navigateTo } from './navigation'
import ReceiptHistory from './ReceiptHistory'
import ReceiptUpload from './ReceiptUpload'

function getView(): 'upload' | 'history' {
  const params = new URLSearchParams(window.location.search)
  return params.get('view') === 'history' ? 'history' : 'upload'
}

function App() {
  const [locationKey, setLocationKey] = useState(() => window.location.search)

  useEffect(() => {
    const handlePopState = () => setLocationKey(window.location.search)
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const view = getView()

  return (
    <div className="flex min-h-screen flex-col items-center gap-8 py-8">
      <h1 className="text-2xl font-bold">Smart Receipt AI</h1>

      <nav className="flex gap-4 text-sm font-medium">
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault()
            navigateTo('')
          }}
          className={view === 'upload' ? 'text-blue-600 underline' : 'text-blue-600'}
        >
          Upload
        </a>
        <a
          href="/?view=history"
          onClick={(e) => {
            e.preventDefault()
            navigateTo('?view=history')
          }}
          className={view === 'history' ? 'text-blue-600 underline' : 'text-blue-600'}
        >
          History
        </a>
      </nav>

      {view === 'history' ? (
        <ReceiptHistory key={locationKey} />
      ) : (
        <ReceiptUpload key={locationKey} />
      )}
    </div>
  )
}

export default App
