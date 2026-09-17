import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { ModelPicker } from '../src/components/chat/model-picker'
import { useChat } from '../src/hooks/use-chat'

const catalog = {
  models: [
    { id: 'a', name: 'Alpha' },
    { id: 'b', name: 'Beta' },
  ],
  defaultModel: 'a',
}
beforeEach(() => {
  // jsdom has no layout observer; browser checks cover the popup's actual sizing.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})
function Picker() {
  const [value, setValue] = useState<string>()
  return <ModelPicker value={value} onChange={setValue} disabled={false} />
}

it('selects with the keyboard and persists the choice', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(catalog)),
  )
  render(<Picker />)
  const trigger = screen.getByRole('combobox')
  await waitFor(() => expect(trigger).toHaveTextContent('Alpha'))
  fireEvent.keyDown(trigger, { key: 'ArrowDown' })
  const input = await screen.findByRole('combobox', { name: 'Поиск модели' })
  expect(input).toHaveFocus()
  await userEvent.keyboard('{ArrowDown}{Enter}')
  await waitFor(() => expect(trigger).toHaveTextContent('Beta'))
  expect(localStorage.getItem('chat-model')).toBe('b')
  await waitFor(() => expect(trigger).toHaveFocus())
})

it('searches names and IDs without case sensitivity, shows empty results and resets on reopen', async () => {
  const fetch = vi.fn(async () =>
    Response.json({
      models: [
        { id: 'vendor/one', name: 'Alpha' },
        { id: 'other/two', name: 'Beta' },
      ],
      defaultModel: 'vendor/one',
    }),
  )
  vi.stubGlobal('fetch', fetch)
  render(<Picker />)
  const trigger = screen.getByRole('combobox', { name: 'Модель' })
  await waitFor(() => expect(trigger).toHaveTextContent('Alpha'))
  expect(document.querySelector('#model-label svg')).toBeInTheDocument()
  await userEvent.click(trigger)
  const search = screen.getByRole('combobox', { name: 'Поиск модели' })
  await userEvent.type(search, '  bETA  ')
  expect(screen.getAllByRole('option')).toHaveLength(1)
  expect(screen.getByRole('option')).toHaveTextContent('Beta')
  await userEvent.clear(search)
  await userEvent.type(search, 'vendor/ONE')
  expect(screen.getAllByRole('option')).toHaveLength(1)
  expect(screen.getByRole('option')).toHaveTextContent('Alpha')
  await userEvent.clear(search)
  await userEvent.type(search, 'missing')
  expect(screen.queryAllByRole('option')).toHaveLength(0)
  expect(screen.getByRole('status')).toHaveTextContent('Модели не найдены')
  await userEvent.keyboard('{Escape}')
  expect(trigger).toHaveTextContent('Alpha')
  await userEvent.click(trigger)
  expect(screen.getByRole('combobox', { name: 'Поиск модели' })).toHaveValue('')
  expect(screen.getAllByRole('option')).toHaveLength(2)
  await userEvent.click(screen.getByRole('option', { name: /Beta/ }))
  expect(trigger).toHaveTextContent('Beta')
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('restores a saved model and falls back when that model disappears', async () => {
  localStorage.setItem('chat-model', 'b')
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(catalog)),
  )
  const view = render(<Picker />)
  await waitFor(() => expect(screen.getByRole('combobox')).toHaveTextContent('Beta'))
  view.unmount()
  localStorage.setItem('chat-model', 'removed')
  render(<Picker />)
  await waitFor(() => expect(screen.getByRole('combobox')).toHaveTextContent('Alpha'))
})

it('recovers from a catalog failure with a separate retry', async () => {
  const fetch = vi
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(Response.json(catalog))
  vi.stubGlobal('fetch', fetch)
  render(<Picker />)
  fireEvent.click(await screen.findByRole('button', { name: 'Повторить загрузку' }))
  await waitFor(() => expect(screen.getByRole('combobox')).toHaveTextContent('Alpha'))
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('handles invalid catalogs and disabled storage', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(Response.json({ models: [] }))
      .mockResolvedValueOnce(Response.json(catalog)),
  )
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked')
  })
  render(<Picker />)
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Не удалось прочитать список моделей.',
  )
  fireEvent.click(screen.getByRole('button', { name: 'Повторить загрузку' }))
  await waitFor(() => expect(screen.getByRole('combobox')).toHaveTextContent('Alpha'))
})

it('keeps the model on retry and generates a new request ID when switching models', async () => {
  const id = crypto.randomUUID()
  const requests: { model: string; requestId: string }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, options: RequestInit) => {
      if (path.endsWith('/session')) return Response.json({ sessionId: id, configured: true })
      if (options.method === 'POST') {
        requests.push(JSON.parse(options.body as string))
        return Response.json({ error: 'Unavailable' }, { status: 502 })
      }
      return Response.json({ sessionId: id, messages: [] })
    }),
  )
  const { result } = renderHook(() => useChat())
  await waitFor(() => expect(result.current.ready).toBe(true))
  act(() => result.current.setDraft('Hello'))
  await act(() => result.current.send('a'))
  await act(() => result.current.send('a'))
  await act(() => result.current.send('b'))
  expect(requests.map((request) => request.model)).toEqual(['a', 'a', 'b'])
  expect(requests[1].requestId).toBe(requests[0].requestId)
  expect(requests[2].requestId).not.toBe(requests[0].requestId)
})
