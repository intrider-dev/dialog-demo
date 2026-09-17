import { afterEach, describe, it, expect, vi } from 'vitest'
import { complete } from '../src/gateway.js'

const config = {
  baseUrl: 'https://example.com/v1',
  apiKey: 'private',
  model: 'test',
  timeoutMs: 100,
}
afterEach(() => vi.unstubAllGlobals())
describe('gateway', () => {
  it('sends authorization only upstream, bounds output and trims reply', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(Response.json({ choices: [{ message: { content: ' Hello ' } }] }))
    vi.stubGlobal('fetch', fetch)
    expect(await complete([{ role: 'user', content: 'Hi' }], config)).toBe('Hello')
    const options = fetch.mock.calls[0][1]
    expect(options.redirect).toBe('error')
    expect(options.headers.Authorization).toBe('Bearer private')
    expect(JSON.parse(options.body).max_tokens).toBe(1000)
  })
  it.each([401, 402, 429, 500])('maps provider status %i without leaking body', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private error', { status })))
    await expect(complete([], config)).rejects.toMatchObject({ status: status === 429 ? 503 : 502 })
  })
  it.each([
    {},
    null,
    { choices: [] },
    { choices: [{ message: { content: ' ' } }] },
    { choices: [{ message: { content: 1 } }] },
    { choices: [{ message: { content: 'x'.repeat(16001) } }] },
  ])('rejects invalid content', async (body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body)))
    await expect(complete([], config)).rejects.toMatchObject({ status: 502 })
  })
  it('rejects malformed JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad')))
    await expect(complete([], config)).rejects.toMatchObject({ status: 502 })
  })
  it('cancels oversized responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('x'.repeat(256001))))
    await expect(complete([], config)).rejects.toMatchObject({ status: 502 })
  })
  it('handles missing body and network timeout', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null)))
    await expect(complete([], config)).rejects.toMatchObject({ status: 502 })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('Timeout', 'TimeoutError')))
    await expect(complete([], config)).rejects.toMatchObject({ status: 502 })
  })
})
