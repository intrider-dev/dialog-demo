import { afterEach, expect, it, vi } from 'vitest'
import { createModelCatalog } from '../src/models.js'

const config = { baseUrl: 'https://example.com/v1', timeoutMs: 1000 }
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

it('normalizes every model, deduplicates, sorts, shares requests and refreshes after expiry', async () => {
  const fetch = vi.fn(async () =>
    Response.json({
      data: [
        { id: 'b', name: 'Beta' },
        { id: 'a', name: 'Alpha', architecture: { input_modalities: ['text', 'image'] } },
        { id: 'b', name: 'Beta' },
        { id: 'c' },
        {},
        null,
        { id: 'x'.repeat(257) },
      ],
    }),
  )
  vi.stubGlobal('fetch', fetch)
  vi.useFakeTimers()
  const list = createModelCatalog(config)
  const [first, second] = await Promise.all([list(), list()])
  expect(first).toEqual([
    { id: 'a', name: 'Alpha', supportsImages: true },
    { id: 'b', name: 'Beta', supportsImages: false },
    { id: 'c', name: 'c', supportsImages: false },
  ])
  expect(second).toBe(first)
  expect(await list()).toBe(first)
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(fetch.mock.calls[0][0]).toBe('https://example.com/v1/models')
  vi.advanceTimersByTime(300001)
  await list()
  expect(fetch).toHaveBeenCalledTimes(2)
})

it.each([{}, { data: [] }, { data: [null, {}] }])(
  'rejects malformed or empty catalogs and allows retry',
  async (data) => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(data))
      .mockResolvedValueOnce(Response.json({ data: [{ id: 'ok' }] }))
    vi.stubGlobal('fetch', fetch)
    const list = createModelCatalog(config)
    await expect(list()).rejects.toMatchObject({ status: 502 })
    expect(await list()).toEqual([{ id: 'ok', name: 'ok', supportsImages: false }])
  },
)

it('hides provider errors and bounds catalog size', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response('secret', { status: 500 }))
    .mockResolvedValueOnce(new Response(null))
    .mockResolvedValueOnce(new Response('x'.repeat(10000001)))
    .mockRejectedValueOnce(new Error('network secret'))
  vi.stubGlobal('fetch', fetch)
  const list = createModelCatalog(config)
  for (let i = 0; i < 4; i++)
    await expect(list()).rejects.toMatchObject({
      status: 502,
      message: 'Не удалось загрузить модели. Попробуйте ещё раз.',
    })
})
