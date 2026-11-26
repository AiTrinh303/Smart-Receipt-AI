import { INITIAL_BATCH_STATE, batchReducer } from './batchReducer'
import type { BatchState } from './batchReducer'

function stateWithItem(): BatchState {
  return {
    ...INITIAL_BATCH_STATE,
    running: true,
    apartmentId: 'oberaudorf-bergblick',
    items: [{ id: '1', file: new File(['x'], 'a.jpg', { type: 'image/jpeg' }), status: 'reading', receiptId: 'r1' }],
  }
}

const EXTRACTED = { store_name: 'Edeka', purchase_date: '2026-11-20', total: 23.5, currency: 'EUR' }

test('ITEM_DONE stores the extracted summary alongside receiptId and warningsCount', () => {
  // Given an item being read
  const state = stateWithItem()

  // When it is done
  const next = batchReducer(state, { type: 'ITEM_DONE', id: '1', receiptId: 'r1', warningsCount: 1, extracted: EXTRACTED })

  // Then the summary is kept as given
  expect(next.items[0]).toMatchObject({ status: 'done', receiptId: 'r1', warningsCount: 1, extracted: EXTRACTED })
})

test('ITEM_SKIPPED leaves extracted unset', () => {
  // Given an item being uploaded
  const state = stateWithItem()

  // When the server reports it as a duplicate
  const next = batchReducer(state, { type: 'ITEM_SKIPPED', id: '1', errorKind: 'duplicate', existing: null })

  // Then it has no extracted summary
  expect(next.items[0].status).toBe('skipped')
  expect(next.items[0].extracted).toBeUndefined()
})
