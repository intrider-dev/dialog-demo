import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { MessageDocument } from '../src/components/chat/message-document'

it('opens PDF in a dialog, offers download and restores focus on close', async () => {
  const user = userEvent.setup()
  render(<MessageDocument document={{ id: 'example', name: 'Отчёт.PDF' }} />)
  const trigger = screen.getByRole('button', { name: 'Отчёт.PDF' })
  expect(screen.queryByTitle('Просмотр PDF: Отчёт.PDF')).not.toBeInTheDocument()
  await user.click(trigger)
  expect(screen.getByRole('dialog', { name: 'Отчёт.PDF' })).toBeVisible()
  expect(screen.getByTitle('Просмотр PDF: Отчёт.PDF')).toHaveAttribute(
    'src',
    '/api/documents/example?preview=1',
  )
  expect(screen.getByRole('link', { name: 'Скачать PDF' })).toHaveAttribute(
    'href',
    '/api/documents/example',
  )
  await user.click(screen.getByRole('button', { name: 'Закрыть просмотр' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(trigger).toHaveFocus()
  await user.click(trigger)
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('keeps text documents as downloads', () => {
  render(<MessageDocument document={{ id: 'text', name: 'notes.txt' }} />)
  const link = screen.getByRole('link', { name: 'notes.txt' })
  expect(link).toHaveAttribute('download')
  expect(link).toHaveAttribute('href', '/api/documents/text')
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})
