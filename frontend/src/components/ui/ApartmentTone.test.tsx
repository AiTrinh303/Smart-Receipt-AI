import { render, screen } from '@testing-library/react'
import { ApartmentDot, ApartmentPill } from './ApartmentTone'

test('ApartmentPill shows its text in the apartment\'s tone, with the full name as title', () => {
  // Given a pill for Waldglück
  render(
    <ApartmentPill apartmentId="sankt-englmar-waldglueck" title="Fewo JoJo - Sankt Englmar - Waldglück">
      Waldglück
    </ApartmentPill>,
  )

  // Then the visible name is there, in teal, with the full name as tooltip
  const pill = screen.getByTitle('Fewo JoJo - Sankt Englmar - Waldglück')
  expect(pill).toHaveTextContent('Waldglück')
  expect(pill).toHaveClass('bg-apartment-teal-soft', 'text-apartment-teal')
})

test('an unknown apartment gets the neutral pill', () => {
  render(<ApartmentPill apartmentId="elsewhere">Elsewhere</ApartmentPill>)
  expect(screen.getByText('Elsewhere').closest('span')).toHaveClass('bg-slate-100', 'text-ink-muted')
})

test('ApartmentDot is decorative and in the apartment\'s tone', () => {
  const { container } = render(<ApartmentDot apartmentId="oberaudorf-bergblick" />)
  const dot = container.firstElementChild as HTMLElement
  expect(dot).toHaveAttribute('aria-hidden', 'true')
  expect(dot).toHaveClass('bg-apartment-sky', 'rounded-full')
  expect(dot).toBeEmptyDOMElement()
})
