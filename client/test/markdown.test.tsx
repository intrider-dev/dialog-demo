import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { Markdown } from '../src/components/chat/markdown'

it('renders headings, emphasis, nested lists, quotes, task lists and shadcn tables', () => {
  const { container } = render(
    <Markdown>
      {
        '# Заголовок\n\nЭто **важно**, *курсив* и `код`.\n\n- Пункт\n  - Вложенный\n\n1. Первый\n2. Второй\n\n> Цитата\n\n- [x] Готово\n\n---\n\n| Имя | Цена |\n| --- | ---: |\n| Пример | 10 |'
      }
    </Markdown>,
  )
  expect(screen.getByRole('heading', { name: 'Заголовок' })).toBeInTheDocument()
  expect(container.querySelector('strong')).toHaveTextContent('важно')
  expect(container.querySelector('em')).toHaveTextContent('курсив')
  expect(container.querySelector('ul ul')).toHaveTextContent('Вложенный')
  expect(container.querySelector('ol')).toHaveTextContent('Первый')
  expect(container.querySelector('blockquote')).toHaveTextContent('Цитата')
  expect(screen.getByRole('checkbox')).toBeChecked()
  expect(screen.getByRole('checkbox')).toBeDisabled()
  expect(screen.getByRole('table')).toHaveAttribute('data-slot', 'table')
  expect(screen.getByRole('columnheader', { name: 'Цена' })).toHaveStyle({ textAlign: 'right' })
  expect(container.querySelector('[data-slot=separator]')).toBeInTheDocument()
})

it('keeps HTML inert, removes unsafe links and does not load remote images', () => {
  const { container } = render(
    <Markdown>
      {
        '<img src=x onerror=alert(1)>\n\n<script>alert(1)</script>\n\n[опасно](javascript:alert%281%29)\n\n[сайт](https://example.com)\n\n![схема](https://example.com/track.png)'
      }
    </Markdown>,
  )
  expect(container.querySelector('img, script, iframe')).toBeNull()
  expect(container).toHaveTextContent('<img src=x onerror=alert(1)>')
  expect(screen.getByText('опасно').closest('a')).toBeNull()
  expect(screen.getByRole('link', { name: 'сайт' })).toHaveAttribute('rel', 'noopener noreferrer')
  expect(screen.getByText('[Изображение: схема]')).toBeInTheDocument()
})

it('copies fenced code exactly, shows confirmation and resets it', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('navigator', { clipboard: { writeText } })
  render(<Markdown>{'```js\nconst greeting = "Hello"\nconsole.log(greeting)\n```'}</Markdown>)
  expect(screen.getByText('js')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Копировать код' }))
  await screen.findByRole('button', { name: 'Скопировано' })
  expect(writeText).toHaveBeenCalledWith('const greeting = "Hello"\nconsole.log(greeting)')
  await waitFor(
    () => expect(screen.getByRole('button', { name: 'Копировать код' })).toBeInTheDocument(),
    { timeout: 3500 },
  )
})

it('shows a useful fallback when clipboard access is blocked', async () => {
  vi.stubGlobal('navigator', {
    clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
  })
  render(<Markdown>{'```\n<unsafe> remains code\n```'}</Markdown>)
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Копировать код' })))
  expect(screen.getByText('Не удалось скопировать. Выделите код вручную.')).toBeInTheDocument()
  expect(screen.getByLabelText('Блок кода')).toHaveTextContent('<unsafe> remains code')
})
