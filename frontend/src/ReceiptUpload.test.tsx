import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ReceiptUpload from './ReceiptUpload'

function getFileInput() {
  return screen.getByLabelText(/upload receipt/i)
}

test('rejects an invalid file type with an error message', () => {
  render(<ReceiptUpload />)

  const invalidFile = new File(['dummy'], 'receipt.pdf', { type: 'application/pdf' })
  fireEvent.change(getFileInput(), { target: { files: [invalidFile] } })

  expect(
    screen.getByText('Invalid file type. Please select a JPG or PNG image.'),
  ).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /submit/i })).toBeDisabled()
})

test('enables Submit only after a valid file is selected', async () => {
  const user = userEvent.setup()
  render(<ReceiptUpload />)

  expect(screen.getByRole('button', { name: /submit/i })).toBeDisabled()

  const validFile = new File(['dummy'], 'receipt.png', { type: 'image/png' })
  await user.upload(getFileInput(), validFile)

  expect(screen.getByRole('button', { name: /submit/i })).toBeEnabled()
})

test('displays the selected filename', async () => {
  const user = userEvent.setup()
  render(<ReceiptUpload />)

  const validFile = new File(['dummy'], 'my-receipt.jpg', { type: 'image/jpeg' })
  await user.upload(getFileInput(), validFile)

  expect(screen.getByText('Selected file: my-receipt.jpg')).toBeInTheDocument()
})
