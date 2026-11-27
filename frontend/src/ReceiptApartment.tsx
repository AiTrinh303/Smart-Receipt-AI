import { useEffect, useState } from 'react'
import { ApiError } from './api/ApiError'
import { updateReceiptApartment } from './api/updateReceiptApartment'
import type { SavedReceipt } from './api/getReceipt'
import { apartmentShortName } from './format/apartmentShortName'
import { useApartments } from './hooks/useApartments'
import Alert from './components/ui/Alert'
import Button from './components/ui/Button'
import { ApartmentDot } from './components/ui/ApartmentTone'
import RadioCardGroup from './components/ui/RadioCardGroup'
import Skeleton from './components/ui/Skeleton'

interface ReceiptApartmentProps {
  receiptId: string
  apartmentId: string | null
  onUpdated: (updated: SavedReceipt) => void
}

const NETWORK_ERROR_MESSAGE = 'Could not reach the server. Please try again.'

/** Shown above the data card on a saved receipt's view (right after
 * extraction, and when reopening `?receipt=<uuid>`) -- never inside
 * ReceiptResult itself. Lets the apartment be changed after the fact via
 * PUT /receipts/{id}/apartment, independent of editing the receipt's data. */
function ReceiptApartment({ receiptId, apartmentId, onUpdated }: ReceiptApartmentProps) {
  const { apartments, isLoading, error: loadError, retry } = useApartments(true)
  const [selected, setSelected] = useState(apartmentId)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [justSaved, setJustSaved] = useState(false)

  // The displayed selection always reflects the receipt's actual stored
  // apartment -- including when it changes for a reason outside this
  // component's own save flow (e.g. a different tab/session updated it).
  useEffect(() => {
    setSelected(apartmentId)
  }, [apartmentId])

  const handleChange = async (newApartmentId: string) => {
    const previous = selected
    setSelected(newApartmentId)
    setSaveError(null)
    setJustSaved(false)
    setIsSaving(true)

    try {
      const updated = await updateReceiptApartment(receiptId, newApartmentId)
      onUpdated(updated)
      setJustSaved(true)
    } catch (err) {
      setSelected(previous)
      setSaveError(err instanceof ApiError ? err.message : NETWORK_ERROR_MESSAGE)
    } finally {
      setIsSaving(false)
    }
  }

  if (loadError) {
    return (
      <div className="flex flex-col gap-2">
        <Alert variant="error">{loadError}</Alert>
        <Button variant="secondary" size="sm" className="self-start" onClick={retry}>
          Retry
        </Button>
      </div>
    )
  }

  if (isLoading || !apartments) {
    return (
      <div role="status" aria-busy="true" className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-ink-muted">Loading apartments...</span>
        <Skeleton className="h-11 w-28 sm:h-10" />
        <Skeleton className="h-11 w-28 sm:h-10" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {/* One compact line: "Apartment", the short-name options (full name
          as accessible name and title), then "Saving..."/"Saved". */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <RadioCardGroup
          layout="inline"
          legend="Apartment"
          name="receipt-apartment"
          options={apartments.map((apartment) => ({
            value: apartment.id,
            label: apartmentShortName(apartment.name) ?? apartment.name,
            accessibleName: apartment.name,
            leading: <ApartmentDot apartmentId={apartment.id} />,
          }))}
          value={selected}
          onChange={handleChange}
          disabled={isSaving}
        />
        {isSaving && <p className="text-sm text-ink-muted">Saving...</p>}
        {!isSaving && justSaved && (
          <p role="status" className="text-sm text-success">
            Saved
          </p>
        )}
      </div>
      {saveError && <Alert variant="error">{saveError}</Alert>}
    </div>
  )
}

export default ReceiptApartment
