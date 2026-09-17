import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { expect, it, vi } from 'vitest'
import { ModelPicker } from '../src/components/chat/model-picker'
import { useChat } from '../src/hooks/use-chat'

const catalog = {
  models: [
    { id: 'a', name: 'Alpha' },
    { id: 'b', name: 'Beta' },
  ],
  defaultModel: 'a',
}
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
  const option = await screen.findByRole('option', { name: 'Beta' })
  fireEvent.keyDown(option, { key: 'Enter' })
  await waitFor(() => expect(trigger).toHaveTextContent('Beta'))
  expect(localStorage.getItem('chat-model')).toBe('b')
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
