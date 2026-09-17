import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { MessageImages } from '../src/components/chat/message-images'

it('opens the clicked attachment in a dialog and returns focus after Escape', async () => {
  render(<MessageImages sources={['/api/images/first', '/api/images/second']} />)
  const trigger = screen.getByRole('button', { name: 'Увеличить изображение 2' })
  await userEvent.click(trigger)
  expect(screen.getByRole('dialog', { name: 'Изображение 2 из 2' })).toBeInTheDocument()
  expect(screen.getByAltText('Вложение 2, увеличенный просмотр')).toHaveAttribute(
    'src',
    '/api/images/second',
  )
  await userEvent.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(trigger).toHaveFocus()
})

it('opens with the keyboard, supports pending previews and closes with the close button', async () => {
  const src = 'data:image/png;base64,iVBORw0KGgo='
  render(<MessageImages sources={[src]} />)
  await userEvent.tab()
  await userEvent.keyboard('{Enter}')
  expect(screen.getByAltText('Вложение 1, увеличенный просмотр')).toHaveAttribute('src', src)
  await userEvent.click(screen.getByRole('button', { name: 'Закрыть просмотр' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
