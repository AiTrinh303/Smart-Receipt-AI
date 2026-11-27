import { listReceipts } from './listReceipts'

let fetchSpy: jest.Mock

beforeEach(() => {
  fetchSpy = jest.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ items: [], count: 0, total: 0 }),
  })
  global.fetch = fetchSpy as unknown as typeof fetch
})

afterEach(() => {
  // @ts-expect-error cleaning up the test-only global fetch stub
  delete global.fetch
})

function sentParams(): URLSearchParams {
  return new URL(String(fetchSpy.mock.calls[0][0]), 'http://x').searchParams
}

test('sort is always sent explicitly: the default date_desc when none is given', async () => {
  // Given no sort option
  await listReceipts({ limit: 10 })

  // Then the request still carries sort=date_desc
  expect(sentParams().get('sort')).toBe('date_desc')
})

test('a given sort is sent alongside the filters and paging', async () => {
  // Given a sort with filters and an offset
  await listReceipts({ sort: 'amount_desc', year: '2026', status: 'approved', limit: 50, offset: 50 })

  // Then every parameter is in the query string
  const params = sentParams()
  expect(params.get('sort')).toBe('amount_desc')
  expect(params.get('year')).toBe('2026')
  expect(params.get('status')).toBe('approved')
  expect(params.get('offset')).toBe('50')
})
