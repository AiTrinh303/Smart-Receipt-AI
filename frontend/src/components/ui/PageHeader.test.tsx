import { render, screen } from '@testing-library/react'
import PageHeader from './PageHeader'

test('renders the title as a level-1 heading', () => {
  render(<PageHeader title="Upload receipts" />)
  expect(screen.getByRole('heading', { level: 1, name: 'Upload receipts' })).toBeInTheDocument()
})

test('renders an optional description', () => {
  render(<PageHeader title="Items" description="Search every purchased item." />)
  expect(screen.getByText('Search every purchased item.')).toBeInTheDocument()
})

test('omits the description when none is given', () => {
  render(<PageHeader title="Items" />)
  expect(screen.queryByText(/./, { selector: 'p' })).not.toBeInTheDocument()
})

test('renders the actions slot', () => {
  render(<PageHeader title="Items" actions={<button type="button">Export</button>} />)
  expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument()
})
