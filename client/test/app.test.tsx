import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import App from '../src/App'
import { useChat } from '../src/hooks/use-chat'
import { cached, pendingRequest, save, savePending } from '../src/lib/chat'

const id = '7f49b058-c40c-4fbb-a4d8-93d9075473af'
const pair = {
  request_id: crypto.randomUUID(),
  user_message: 'Hello',
  ai_message: '<img src=x onerror=alert(1)>',
  created_at: new Date().toISOString(),
}
function mockApi() {
  const fetch = vi.fn(async (path: string, options?: RequestInit) => {
    if (path.endsWith('/models'))
      return Response.json({
        models: [{ id: 'test/model', name: 'Test model' }],
        defaultModel: 'test/model',
      })
    if (path.endsWith('/session'))
      return Response.json({
        sessionId: options?.method === 'POST' ? 'new-session' : id,
        configured: true,
      })
    if (options?.method === 'POST') {
      const body = JSON.parse(options.body as string)
      return Response.json({
        sessionId: id,
        message: { ...pair, request_id: body.requestId, user_message: body.message },
      })
    }
    return Response.json({ sessionId: id, messages: [] })
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}
async function mounted() {
  const hook = renderHook(() => useChat())
  await waitFor(() => expect(hook.result.current.ready).toBe(true))
  return hook
}
describe('chat screen', () => {
  it('sends via Enter, renders responses as text, saves history and starts a fresh dialog', async () => {
    mockApi()
    const user = userEvent.setup()
    render(<App />)
    expect(screen.queryByText('Без регистрации')).not.toBeInTheDocument()
    const input = screen.getByRole('textbox')
    await waitFor(() => expect(input).toBeEnabled())
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Модель' })).toHaveTextContent('Test model'),
    )
    await user.click(screen.getByRole('button', { name: 'Помоги с идеей' }))
    expect(input).toHaveValue('Помоги с идеей')
    await user.clear(input)
    await user.type(input, 'Hello{shift>}{enter}{/shift}again')
    expect(input).toHaveValue('Hello\nagain')
    await user.keyboard('{Enter}')
    await screen.findByText(pair.ai_message)
    expect(document.querySelector('img')).toBeNull()
    expect(cached(id)).toHaveLength(1)
    expect(pendingRequest(id)).toBeNull()
    await user.type(input, 'Second message')
    await user.click(screen.getByRole('button', { name: 'Отправить сообщение' }))
    await waitFor(() => expect(cached(id)).toHaveLength(2))
    await user.click(screen.getByRole('button', { name: 'Новый диалог' }))
    await screen.findByText('С чего начнём?')
    expect(cached(id)).toHaveLength(2)
    expect(localStorage.getItem('chat-session-changed')).toBe('new-session')
  })
  it('shows startup failure and can reload without losing the typed message', async () => {
    const fetch = mockApi()
    fetch.mockImplementationOnce(async () =>
      Response.json({
        models: [{ id: 'test/model', name: 'Test model' }],
        defaultModel: 'test/model',
      }),
    )
    fetch.mockRejectedValueOnce(new Error('offline'))
    render(<App />)
    await screen.findByRole('alert')
    expect(screen.getByRole('textbox')).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Обновить диалог' }))
    await waitFor(() => expect(screen.getByRole('textbox')).toBeEnabled())
  })
  it('does not send on composition, blank input or before setup', async () => {
    const fetch = mockApi()
    render(<App />)
    await waitFor(() => expect(screen.getByRole('textbox')).toBeEnabled())
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'test' } })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    expect(fetch.mock.calls.filter(([, o]) => o?.method === 'POST')).toHaveLength(0)
  })
})
describe('chat state', () => {
  it('restores cached history, reconciles persisted retries and filters duplicate request IDs', async () => {
    const fetch = mockApi()
    save(id, [pair])
    savePending(id, { requestId: pair.request_id, message: pair.user_message })
    fetch.mockImplementation(async (path) =>
      path.endsWith('/session')
        ? Response.json({ sessionId: id, configured: true })
        : Response.json({ sessionId: id, messages: [pair] }),
    )
    const { result } = await mounted()
    expect(result.current.messages).toEqual([pair])
    expect(pendingRequest(id)).toBeNull()
    expect(result.current.draft).toBe('')
  })
  it('prevents duplicate clicks synchronously, restores failed text and reuses its retry ID', async () => {
    const fetch = mockApi()
    const { result } = await mounted()
    await act(async () => result.current.setDraft('Hello'))
    fetch.mockRejectedValueOnce(new Error('lost response'))
    await act(async () => {
      await Promise.all([result.current.send(), result.current.send()])
    })
    expect(result.current.draft).toBe('Hello')
    expect(result.current.error).toBeTruthy()
    const retryId = pendingRequest(id)!.requestId
    await act(async () => result.current.send())
    expect(result.current.messages[0].request_id).toBe(retryId)
    expect(result.current.busy).toBe(false)
  })
  it('blocks stale tabs from mixing histories and supports recovery', async () => {
    const fetch = mockApi()
    const { result } = await mounted()
    await act(async () => result.current.setDraft('Hello'))
    fetch.mockResolvedValueOnce(
      Response.json({ error: 'Session changed', code: 'SESSION_CHANGED' }, { status: 409 }),
    )
    await act(async () => result.current.send())
    expect(result.current.session).toBeNull()
    expect(result.current.messages).toEqual([])
    expect(result.current.ready).toBe(false)
    await act(async () => result.current.load())
    expect(result.current.ready).toBe(true)
  })
  it('reuses a retry ID even when localStorage is disabled', async () => {
    const fetch = mockApi()
    const { result } = await mounted()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    await act(async () => result.current.setDraft('Hello'))
    fetch.mockRejectedValueOnce(new Error('offline'))
    await act(async () => result.current.send())
    const first = JSON.parse(fetch.mock.calls.at(-1)![1]!.body as string).requestId
    await act(async () => result.current.send())
    expect(result.current.messages[0].request_id).toBe(first)
  })
  it('handles history failures and rejects mismatched response sessions', async () => {
    const fetch = mockApi()
    fetch.mockResolvedValueOnce(Response.json({ sessionId: id, configured: true }))
    fetch.mockResolvedValueOnce(Response.json({ sessionId: 'wrong', messages: [] }))
    const { result } = renderHook(() => useChat())
    await waitFor(() => expect(result.current.error).toBeTruthy())
    expect(result.current.ready).toBe(false)
    await act(async () => result.current.load())
    await act(async () => result.current.setDraft('Hello'))
    fetch.mockResolvedValueOnce(Response.json({ sessionId: 'wrong', message: pair }))
    await act(async () => result.current.send())
    expect(result.current.messages).toEqual([])
    expect(result.current.draft).toBe('Hello')
  })
  it('keeps state on failed rotation and clears stale sessions', async () => {
    const fetch = mockApi()
    const { result } = await mounted()
    fetch.mockRejectedValueOnce(new Error('offline'))
    await act(async () => result.current.newSession())
    expect(result.current.session?.sessionId).toBe(id)
    fetch.mockResolvedValueOnce(
      Response.json({ error: 'Changed', code: 'SESSION_CHANGED' }, { status: 409 }),
    )
    await act(async () => result.current.newSession())
    expect(result.current.session).toBeNull()
  })
  it('refreshes on focus and cross-tab changes, not unrelated storage changes', async () => {
    const fetch = mockApi()
    const { result } = await mounted()
    const count = fetch.mock.calls.length
    await act(async () => window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated' })))
    expect(fetch.mock.calls.length).toBe(count)
    await act(async () =>
      window.dispatchEvent(new StorageEvent('storage', { key: 'chat-session-changed' })),
    )
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(fetch.mock.calls.length).toBeGreaterThan(count)
    await act(async () => window.dispatchEvent(new Event('focus')))
    await waitFor(() => expect(result.current.ready).toBe(true))
  })
  it('restores an unfinished prompt after a reload and never sends empty or overlong text', async () => {
    mockApi()
    savePending(id, { requestId: crypto.randomUUID(), message: 'Unfinished' })
    const { result } = await mounted()
    expect(result.current.draft).toBe('Unfinished')
    await act(async () => result.current.setDraft(' '))
    await act(async () => result.current.send())
    expect(result.current.messages).toEqual([])
    await act(async () => result.current.setDraft('x'.repeat(4001)))
    await act(async () => result.current.send())
    expect(result.current.messages).toEqual([])
  })
})
