import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Button from './Button'

test('renders each variant with its label', () => {
  // Given each supported variant
  const variants = ['primary', 'secondary', 'danger', 'ghost'] as const

  // When rendered
  render(
    <>
      {variants.map((variant) => (
        <Button key={variant} variant={variant}>
          {variant} button
        </Button>
      ))}
    </>,
  )

  // Then each one is present
  for (const variant of variants) {
    expect(screen.getByRole('button', { name: `${variant} button` })).toBeInTheDocument()
  }
})

test('a disabled button does not fire onClick', async () => {
  // Given a disabled button
  const user = userEvent.setup()
  const onClick = jest.fn()
  render(
    <Button disabled onClick={onClick}>
      Submit
    </Button>,
  )

  // When the user clicks it
  await user.click(screen.getByRole('button', { name: 'Submit' }))

  // Then onClick is never called
  expect(onClick).not.toHaveBeenCalled()
})

test('a loading button shows the loading text, is disabled, and does not fire onClick', async () => {
  // Given a loading button with custom loading text
  const user = userEvent.setup()
  const onClick = jest.fn()
  render(
    <Button loading loadingText="Uploading..." onClick={onClick}>
      Submit
    </Button>,
  )

  // Then the loading text is shown and the button is disabled
  const button = screen.getByRole('button', { name: /uploading/i })
  expect(button).toBeDisabled()

  // When the user clicks it
  await user.click(button);

  // Then onClick is never called
  expect(onClick).not.toHaveBeenCalled()
})
