import { describe, it, expect, vi } from 'vitest'
import {
  api,
  ApiError,
  cached,
  getSession,
  isMessage,
  pendingRequest,
  save,
  savePending,
  storageKey,
} from '../src/lib/chat'

const message = {
  request_id: crypto.randomUUID(),
  user_message: 'Hi',
  ai_message: 'Hello',
  created_at: new Date().toISOString(),
}
describe('local history', () => {
  it('validates rows and caps reads and writes', () => {
    expect(isMessage(null)).toBe(false)
    expect(isMessage({ ...message, created_at: 'bad' })).toBe(false)
    expect(isMessage({ ...message, request_id: null })).toBe(true)
    expect(isMessage({ ...message, sent_at: null })).toBe(true)
    expect(isMessage({ ...message, sent_at: '2026-09-17T12:00:00Z' })).toBe(true)
    expect(isMessage({ ...message, sent_at: 'invalid' })).toBe(false)
    expect(isMessage({ ...message, sent_at: 123 })).toBe(false)
    save('session', Array(210).fill(message))
    expect(cached('session')).toHaveLength(200)
    expect(cached('other')).toEqual([])
    localStorage.setItem(storageKey('session'), JSON.stringify([null, {}, message]))
    expect(cached('session')).toEqual([message])
    localStorage.setItem(storageKey('session'), '{}')
    expect(cached('session')).toEqual([])
    localStorage.setItem(storageKey('session'), 'bad')
    expect(cached('session')).toEqual([])
  })
  it('handles blocked storage and exhausted quota', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(cached('s')).toEqual([])
    expect(() => save('s', [message])).not.toThrow()
    expect(pendingRequest('s')).toBeNull()
    expect(() =>
      savePending('s', { requestId: crypto.randomUUID(), message: 'hello' }),
    ).not.toThrow()
    expect(() => savePending('s', null)).not.toThrow()
  })
  it('keeps retry IDs and rejects damaged pending requests', () => {
    const pending = { requestId: crypto.randomUUID(), message: 'Hello' }
    savePending('s', pending)
    expect(pendingRequest('s')).toEqual(pending)
    savePending('s', null)
    expect(pendingRequest('s')).toBeNull()
    for (const value of ['bad', '{}', '{"requestId":"bad","message":"Hello"}']) {
      localStorage.setItem('pending:s', value)
      expect(pendingRequest('s')).toBeNull()
    }
  })
})
describe('HTTP client', () => {
  it('sends the session check and JSON body', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetch)
    expect(await api('messages', { message: 'Hi' }, 'session')).toEqual({ ok: true })
    expect(fetch.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      headers: { 'X-Session-Id': 'session', 'Content-Type': 'application/json' },
    })
  })
  it('shares initial session creation across mounts', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ sessionId: 's', configured: true }))
    vi.stubGlobal('fetch', fetch)
    const first = getSession(),
      second = getSession()
    expect(first).toBe(second)
    await Promise.all([first, second])
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('maps network, JSON and HTTP errors without exposing raw failures', async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('private network error'))
      .mockResolvedValueOnce(new Response('<html>error</html>'))
      .mockResolvedValueOnce(
        Response.json({ error: 'Changed', code: 'SESSION_CHANGED' }, { status: 409 }),
      )
      .mockResolvedValueOnce(Response.json({}, { status: 500 }))
    vi.stubGlobal('fetch', fetch)
    await expect(api('messages')).rejects.not.toThrow('private')
    await expect(api('messages')).rejects.toThrow('некорректный ответ')
    await expect(api('messages')).rejects.toMatchObject({
      code: 'SESSION_CHANGED',
      message: 'Changed',
    })
    await expect(api('messages')).rejects.toBeInstanceOf(ApiError)
  })
})
