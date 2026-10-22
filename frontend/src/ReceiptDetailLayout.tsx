import { useState } from 'react'
import type { ReactNode } from 'react'
import ReceiptFileViewer from './ReceiptFileViewer'

interface ReceiptDetailLayoutProps {
  receiptId: string
  fileName: string | null
  contentType: string | null
  children: ReactNode
}

type Tab = 'data' | 'original'

const SEGMENT_BASE =
  'flex-1 rounded-md px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 ' +
  'focus-visible:outline-offset-2 focus-visible:outline-brand'

function ReceiptDetailLayout({ receiptId, fileName, contentType, children }: ReceiptDetailLayoutProps) {
  const [activeTab, setActiveTab] = useState<Tab>('data')

  return (
    <div className="flex w-full flex-col gap-4">
      <div
        role="tablist"
        aria-label="Receipt view"
        className="flex gap-1 rounded-lg bg-slate-100 p-1 lg:hidden"
      >
        <button
          type="button"
          role="tab"
          id="receipt-tab-data"
          aria-selected={activeTab === 'data'}
          aria-controls="receipt-panel-data"
          onClick={() => setActiveTab('data')}
          className={`${SEGMENT_BASE} ${
            activeTab === 'data'
              ? 'bg-white font-semibold text-brand shadow-sm'
              : 'font-medium text-ink-muted'
          }`}
        >
          Receipt data
        </button>
        <button
          type="button"
          role="tab"
          id="receipt-tab-original"
          aria-selected={activeTab === 'original'}
          aria-controls="receipt-panel-original"
          onClick={() => setActiveTab('original')}
          className={`${SEGMENT_BASE} ${
            activeTab === 'original'
              ? 'bg-white font-semibold text-brand shadow-sm'
              : 'font-medium text-ink-muted'
          }`}
        >
          Original
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[5fr_6fr]">
        <div
          id="receipt-panel-original"
          role="tabpanel"
          aria-labelledby="receipt-tab-original"
          hidden={activeTab !== 'original'}
          className="lg:order-1 lg:!block lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)]"
        >
          <ReceiptFileViewer receiptId={receiptId} fileName={fileName} contentType={contentType} />
        </div>

        <div
          id="receipt-panel-data"
          role="tabpanel"
          aria-labelledby="receipt-tab-data"
          hidden={activeTab !== 'data'}
          className="lg:order-2 lg:!block"
        >
          {children}
        </div>
      </div>
    </div>
  )
}

export default ReceiptDetailLayout
