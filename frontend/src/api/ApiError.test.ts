import { ApiError, apiErrorFromDetail } from './ApiError'

test('a string detail becomes the message, with no code or details', () => {
  const error = apiErrorFromDetail('Unknown apartment.', 422, 'fallback')
  expect(error).toBeInstanceOf(ApiError)
  expect(error.message).toBe('Unknown apartment.')
  expect(error.status).toBe(422)
  expect(error.code).toBeUndefined()
  expect(error.details).toBeUndefined()
})

test('an object detail with message and code keeps all three, plus the whole object as details', () => {
  const existing = { receipt_id: 'abc', store_name: 'Store' }
  const error = apiErrorFromDetail(
    { code: 'DUPLICATE_FILE', message: 'This file is already saved.', existing },
    409,
    'fallback',
  )
  expect(error.message).toBe('This file is already saved.')
  expect(error.status).toBe(409)
  expect(error.code).toBe('DUPLICATE_FILE')
  expect(error.details).toEqual({ code: 'DUPLICATE_FILE', message: 'This file is already saved.', existing })
  expect((error.details?.existing as typeof existing).receipt_id).toBe('abc')
})

test('an object detail with no message string falls back to the given message', () => {
  const error = apiErrorFromDetail({ code: 'SOMETHING' }, 400, 'fallback message')
  expect(error.message).toBe('fallback message')
  expect(error.code).toBe('SOMETHING')
})

test('a missing or malformed detail falls back to the given message, no code/details', () => {
  expect(apiErrorFromDetail(null, 500, 'fallback').message).toBe('fallback')
  expect(apiErrorFromDetail(undefined, 500, 'fallback').message).toBe('fallback')
  expect(apiErrorFromDetail(42, 500, 'fallback').message).toBe('fallback')
  expect(apiErrorFromDetail(null, 500, 'fallback').code).toBeUndefined()
})

test('the ApiError constructor still accepts the existing (message, status, missing) shape unchanged', () => {
  const error = new ApiError('To approve this receipt, also set: a valid purchase date.', 422, ['date'])
  expect(error.message).toBe('To approve this receipt, also set: a valid purchase date.')
  expect(error.missing).toEqual(['date'])
  expect(error.code).toBeUndefined()
  expect(error.details).toBeUndefined()
})
