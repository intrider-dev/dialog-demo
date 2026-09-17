import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { MessagePair, PendingReply } from '../src/components/chat/message-pair'
import type { Message } from '../src/types/chat'

const message: Message = {
  request_id: crypto.randomUUID(),
  user_message: 'Вопрос',
  ai_message: 'Ответ на вопрос',
  sent_at: '2026-09-17T12:00:00.000Z',
  created_at: '2026-09-17T12:01:05.000Z',
}

it('shows distinct local times, full accessible dates and an SVG next to the reply', () => {
  const { container } = render(<MessagePair message={message} animate />)
  const times = container.querySelectorAll('time')
  expect(times).toHaveLength(2)
  expect(times[0]).toHaveAttribute('datetime', message.sent_at)
  expect(times[1]).toHaveAttribute('datetime', message.created_at)
  const format = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' })
  expect(times[0]).toHaveTextContent(format.format(new Date(message.sent_at!)))
  expect(times[1]).toHaveTextContent(format.format(new Date(message.created_at)))
  expect(times[0].getAttribute('aria-label')).toMatch(/^Отправлено:.*2026/)
  expect(times[1].getAttribute('title')).toMatch(/^Получен ответ:/)
  expect(container.querySelector('article svg')).toHaveAttribute('aria-hidden', 'true')
  expect(screen.getByText('Вы').parentElement?.querySelector('svg')).toHaveAttribute(
    'aria-hidden',
    'true',
  )
  expect(container.firstChild).toHaveClass('message-enter')
})

it('labels the fallback timestamp honestly for legacy history', () => {
  const { container } = render(<MessagePair message={{ ...message, sent_at: null }} />)
  const time = container.querySelector('time')!
  expect(time).toHaveAttribute('datetime', message.created_at)
  expect(time.getAttribute('title')).toMatch(/^Сохранено:/)
  expect(container.firstChild).not.toHaveClass('message-enter')
})

it('shows sending time and a decorative SVG while waiting for the reply', () => {
  const { container } = render(
    <PendingReply message={{ text: 'Ожидающий вопрос', sentAt: message.sent_at! }} />,
  )
  expect(screen.getByText('Ожидающий вопрос')).toBeInTheDocument()
  expect(screen.getByText('Вы').parentElement?.querySelector('svg')).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Готовлю ответ')
  expect(screen.getByRole('status').querySelector('svg')).toBeInTheDocument()
  expect(container.querySelectorAll('time')).toHaveLength(1)
})
