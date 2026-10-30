import { useState } from 'react'
import type { ReactNode } from 'react'
import Alert from './components/ui/Alert'
import Button from './components/ui/Button'
import Card from './components/ui/Card'
import RadioCardGroup from './components/ui/RadioCardGroup'
import Skeleton from './components/ui/Skeleton'
import StatusBadge from './components/ui/StatusBadge'

const BUTTON_VARIANTS = ['primary', 'secondary', 'danger', 'ghost', 'danger-ghost'] as const
const ALERT_VARIANTS = ['info', 'success', 'warning', 'error'] as const

const SAMPLE_APARTMENT_OPTIONS = [
  { value: 'oberaudorf-bergblick', label: 'Oberaudorf Bergblick' },
  { value: 'sankt-englmar-waldglueck', label: 'Sankt Englmar Waldglück' },
]

const SAMPLE_CATEGORY_OPTIONS = [
  { value: 'cleaning', label: 'Cleaning and supplies' },
  { value: 'repairs', label: 'Repairs and maintenance' },
]

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      {children}
    </section>
  )
}

function LogoMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-8 w-8 flex-shrink-0">
      <rect x="1" y="1" width="22" height="22" rx="6" className="fill-brand" />
      <path d="M7 7h10M7 11.5h10M7 16h6" stroke="white" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  )
}

type ReceiptApartmentState = 'selected' | 'none' | 'saving' | 'saved' | 'error'
type ReceiptCategoryState = 'selected' | 'none' | 'saving' | 'saved' | 'error'
type ReceiptStatusState = 'needs_review' | 'approved' | 'saving' | 'blocked'

function StyleGuide() {
  const [dropzoneState, setDropzoneState] = useState<'idle' | 'drag-over' | 'file-selected'>('idle')
  const [apartmentChoice, setApartmentChoice] = useState<string | null>(null)
  const [receiptApartmentState, setReceiptApartmentState] = useState<ReceiptApartmentState>('selected')
  const [receiptCategoryState, setReceiptCategoryState] = useState<ReceiptCategoryState>('selected')
  const [receiptStatusState, setReceiptStatusState] = useState<ReceiptStatusState>('needs_review')

  return (
    <div className="flex flex-col gap-10 pb-16">
      <div>
        <h1 className="text-2xl font-bold text-ink">Style guide</h1>
        <p className="text-sm text-ink-muted">
          Development-only page (<code>?view=styleguide</code>) for checking every component state
          without relying on a backend. Not linked from the app, not included in production
          builds.
        </p>
      </div>

      <Section title="Logo mark">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-surface p-4">
          <LogoMark />
          <span className="text-lg font-bold text-ink">Smart Receipt AI</span>
        </div>
      </Section>

      <Section title="Nav tab (active / inactive)">
        <div className="flex gap-4 rounded-lg border border-border bg-surface p-4 text-sm">
          <span className="border-b-2 border-brand px-1 py-2 font-semibold text-brand" aria-current="page">
            Active tab
          </span>
          <span className="border-b-2 border-transparent px-1 py-2 font-medium text-ink-muted">
            Inactive tab
          </span>
        </div>
      </Section>

      <Section title="Button variants -- enabled">
        <div className="flex flex-wrap gap-3">
          {BUTTON_VARIANTS.map((variant) => (
            <Button key={variant} variant={variant}>
              {variant}
            </Button>
          ))}
        </div>
      </Section>

      <Section title="Button variants -- disabled">
        <div className="flex flex-wrap gap-3">
          {BUTTON_VARIANTS.map((variant) => (
            <Button key={variant} variant={variant} disabled>
              {variant} (disabled)
            </Button>
          ))}
        </div>
      </Section>

      <Section title="Button variants -- loading">
        <div className="flex flex-wrap gap-3">
          {BUTTON_VARIANTS.map((variant) => (
            <Button key={variant} variant={variant} loading loadingText="Loading...">
              {variant}
            </Button>
          ))}
        </div>
      </Section>

      <Section title="Alert variants">
        <div className="flex flex-col gap-3">
          {ALERT_VARIANTS.map((variant) => (
            <Alert key={variant} variant={variant}>
              This is a {variant} alert.
            </Alert>
          ))}
        </div>
      </Section>

      <Section title="Card">
        <Card>
          <p className="text-sm text-ink">A basic Card with some sample content.</p>
        </Card>
      </Section>

      <Section title="Skeleton (loading placeholders)">
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      </Section>

      <Section title="Items as cards (below the sm breakpoint)">
        <ul className="flex max-w-xs flex-col gap-2">
          {[
            { name: 'Milk', quantity: 2, unit_price: '2.50', line_total: '5.00' },
            { name: 'Bread', quantity: 1, unit_price: '3.00', line_total: '3.00' },
          ].map((item) => (
            <li key={item.name} className="rounded-md border border-border p-3">
              <p className="font-medium text-ink">{item.name}</p>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <dt className="text-ink-muted">Qty</dt>
                <dd className="text-right tabular-nums">{item.quantity}</dd>
                <dt className="whitespace-nowrap text-ink-muted">Unit price (USD)</dt>
                <dd className="whitespace-nowrap text-right tabular-nums">{item.unit_price}</dd>
                <dt className="whitespace-nowrap text-ink-muted">Line total (USD)</dt>
                <dd className="whitespace-nowrap text-right tabular-nums">{item.line_total}</dd>
              </dl>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Data-quality warnings, Edited badge and reset confirmation">
        <Alert variant="warning">
          <div className="flex gap-2">
            <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 flex-shrink-0" fill="none">
              <path
                d="M10 3.5l8 13.5H2l8-13.5z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              <path d="M10 8.5v3.5M10 14.75h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <div>
              <p className="font-semibold">Check these values</p>
              <ul className="mt-1 list-disc pl-4">
                <li>The total (79.40) does not match the items, discounts and tax (69.40 + 0.00).</li>
                <li>The purchase date is missing.</li>
              </ul>
            </div>
          </div>
        </Alert>

        <div className="flex items-center gap-2 rounded-lg border border-border bg-surface p-4">
          <h3 className="text-lg font-bold text-ink">
            Corner Store
            <span
              className="ml-2 inline-flex items-center rounded-full bg-warning-soft px-2 py-0.5 align-middle text-xs font-medium text-warning"
              title="Edited 2026-01-16T09:00:00+00:00"
            >
              Edited
            </span>
          </h3>
        </div>

        <Alert variant="warning">
          <div className="flex flex-col gap-3">
            <p>Replace your edits with the original AI result? This cannot be undone.</p>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm">
                Yes, reset
              </Button>
              <Button variant="secondary" size="sm">
                Cancel
              </Button>
            </div>
          </div>
        </Alert>
      </Section>

      <Section title="Apartment choice (RadioCardGroup -- none chosen / chosen / loading / failure)">
        <Card className="flex flex-col gap-4">
          <RadioCardGroup
            legend="Which apartment is this receipt for?"
            name="styleguide-apartment"
            options={SAMPLE_APARTMENT_OPTIONS}
            value={apartmentChoice}
            onChange={setApartmentChoice}
          />
          <p className="text-sm text-ink-muted">
            {apartmentChoice ? `Chosen: ${apartmentChoice}` : 'Choose an apartment to continue.'}
          </p>
        </Card>

        <div role="status" aria-busy="true" className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
          <span className="text-sm text-ink-muted">Loading apartments...</span>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Skeleton className="h-11 flex-1" />
            <Skeleton className="h-11 flex-1" />
          </div>
        </div>

        <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
          <Alert variant="error">Could not load apartments. Please try again.</Alert>
          <Button variant="secondary" size="sm" className="self-start">
            Retry
          </Button>
        </div>
      </Section>

      <Section title="Apartment on a saved receipt (ReceiptApartment -- selected / none / saving / saved / error)">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => setReceiptApartmentState('selected')}>
            Show selected
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setReceiptApartmentState('none')}>
            Show none selected
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setReceiptApartmentState('saving')}>
            Show saving
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setReceiptApartmentState('saved')}>
            Show saved
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setReceiptApartmentState('error')}>
            Show error
          </Button>
        </div>

        <Card className="flex flex-col gap-2">
          <RadioCardGroup
            legend="Apartment"
            name="styleguide-receipt-apartment"
            options={SAMPLE_APARTMENT_OPTIONS}
            value={receiptApartmentState === 'none' ? null : SAMPLE_APARTMENT_OPTIONS[0].value}
            onChange={() => {}}
            disabled={receiptApartmentState === 'saving'}
          />
          {receiptApartmentState === 'saving' && (
            <p className="text-sm text-ink-muted">Saving...</p>
          )}
          {receiptApartmentState === 'saved' && (
            <p role="status" className="text-sm text-success">
              Saved
            </p>
          )}
          {receiptApartmentState === 'error' && (
            <Alert variant="error">Could not update the apartment. Please try again.</Alert>
          )}
        </Card>
      </Section>

      <Section title="Category select on a saved receipt (ReceiptClassification -- selected / none / saving / saved / failure)">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => setReceiptCategoryState('selected')}>
            Show selected
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setReceiptCategoryState('none')}>
            Show none selected
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setReceiptCategoryState('saving')}>
            Show saving
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setReceiptCategoryState('saved')}>
            Show saved
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setReceiptCategoryState('error')}>
            Show error
          </Button>
        </div>

        <Card className="flex flex-col gap-2">
          <label htmlFor="styleguide-category-select" className="text-sm font-medium text-ink">
            Category
          </label>
          <select
            id="styleguide-category-select"
            value={receiptCategoryState === 'none' ? '' : SAMPLE_CATEGORY_OPTIONS[0].value}
            onChange={() => {}}
            disabled={receiptCategoryState === 'saving'}
            className="h-11 min-h-[44px] rounded-md border border-border bg-surface px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
          >
            <option value="">Choose a category</option>
            {SAMPLE_CATEGORY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {receiptCategoryState === 'saving' && <p className="text-sm text-ink-muted">Saving...</p>}
          {receiptCategoryState === 'saved' && (
            <p role="status" className="text-sm text-success">
              Saved
            </p>
          )}
          {receiptCategoryState === 'error' && (
            <Alert variant="error">Could not update the category. Please try again.</Alert>
          )}
        </Card>
      </Section>

      <Section title="Review status (ReceiptClassification -- needs review / approved / saving / approval blocked)">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => setReceiptStatusState('needs_review')}>
            Show needs review
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setReceiptStatusState('approved')}>
            Show approved
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setReceiptStatusState('saving')}>
            Show saving
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setReceiptStatusState('blocked')}>
            Show approval blocked
          </Button>
        </div>

        <Card className="flex flex-col gap-2">
          <span className="text-sm font-medium text-ink">Status</span>
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={receiptStatusState === 'approved' ? 'approved' : 'needs_review'} />
            {(() => {
              const isSaving = receiptStatusState === 'saving'
              return receiptStatusState === 'approved' ? (
                <Button variant="secondary" size="sm" disabled={isSaving}>
                  Back to needs review
                </Button>
              ) : (
                <Button variant="primary" size="sm" disabled={isSaving}>
                  Mark as approved
                </Button>
              )
            })()}
          </div>
          {receiptStatusState === 'saving' && <p className="text-sm text-ink-muted">Saving...</p>}
          {receiptStatusState === 'blocked' && (
            <Alert variant="error">
              To approve this receipt, also set: apartment, category. You can fix the date with Edit.
            </Alert>
          )}
        </Card>
      </Section>

      <Section title="History row badges (apartment / category / status)">
        <ul className="flex max-w-xs flex-col gap-2">
          <li className="rounded border border-gray-200 px-3 py-2 text-sm">
            <span className="block font-medium text-gray-900">Corner Store</span>
            <span className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand">
                <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5 flex-shrink-0" fill="none">
                  <path
                    d="M4 17.5V5.5a1 1 0 011-1h4.5v13M11.5 17.5V9h3.5a1 1 0 011 1v7.5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path d="M6 7.5h1M6 10.5h1M6 13.5h1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                Oberaudorf Bergblick
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs font-medium text-ink">
                Cleaning and supplies
              </span>
              <StatusBadge status="approved" />
            </span>
          </li>
          <li className="rounded border border-gray-200 px-3 py-2 text-sm">
            <span className="block font-medium text-gray-900">Other Store</span>
            <span className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className="text-ink-muted">Not assigned</span>
              <span className="text-ink-muted">No category</span>
              <StatusBadge status="needs_review" />
            </span>
          </li>
        </ul>
      </Section>

      <Section title="Dropzone (idle / drag-over / file-selected)">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => setDropzoneState('idle')}>
            Show idle
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setDropzoneState('drag-over')}>
            Show drag-over
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setDropzoneState('file-selected')}>
            Show file-selected
          </Button>
        </div>

        <Card className="flex flex-col gap-4">
          <div
            className={`flex flex-col items-center gap-2 rounded-lg border-2 border-dashed p-8 text-center ${
              dropzoneState === 'drag-over' ? 'border-brand bg-brand-soft' : 'border-border'
            }`}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-8 w-8 text-brand" fill="none">
              <path
                d="M12 16V4m0 0L7 9m5-5l5 5M5 20h14"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <p className="text-sm font-medium text-ink">Drag a receipt here, or choose a file</p>
            <p className="text-sm text-ink-muted">JPG, PNG or PDF, up to 10 MB</p>
          </div>

          {dropzoneState === 'file-selected' && (
            <div className="flex items-center gap-3 rounded-md border border-border bg-surface-page px-3 py-2">
              <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                Selected file: sample-receipt.jpg (120 KB)
              </p>
              <Button variant="ghost" size="sm">
                Remove
              </Button>
            </div>
          )}
        </Card>
      </Section>
    </div>
  )
}

export default StyleGuide
