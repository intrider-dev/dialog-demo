import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { resolve } from 'node:path'
import pg from 'pg'
import type { Server } from 'node:http'
import { createServer } from 'node:http'
import { readConfig } from '../src/config.js'
import { createStore, type Store } from '../src/db.js'
import { createApp } from '../src/app.js'
import { HttpError } from '../src/errors.js'
import { verifyInstallation } from '../../scripts/setup.mjs'

try {
  process.loadEnvFile('server/.env')
} catch {
  /* CI supplies environment variables. */
}
const schema = `test_${randomUUID().replaceAll('-', '')}`
const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL })
let store: Store
let server: Server
let base: string
const generate = vi.fn(async () => 'Answer')
const config = readConfig({
  ...process.env,
  SESSION_SECRET: 's'.repeat(48),
  AI_API_KEY: 'test-key',
  REQUESTS_PER_MINUTE: '1000',
})
type Session = { id: string; cookie: string }

async function session(url = base): Promise<Session> {
  const res = await fetch(`${url}/api/session`)
  expect(res.status).toBe(200)
  return { id: (await res.json()).sessionId, cookie: res.headers.get('set-cookie')!.split(';')[0] }
}
function request(path: string, user?: Session, body?: unknown, headers = {}, url = base) {
  return fetch(`${url}/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(user ? { Cookie: user.cookie, 'X-Session-Id': user.id } : {}),
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}
async function listen(app: ReturnType<typeof createApp>) {
  const instance = app.listen(0, '127.0.0.1')
  await once(instance, 'listening')
  return { instance, url: `http://127.0.0.1:${(instance.address() as { port: number }).port}` }
}
beforeAll(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`)
  const url = new URL(process.env.DATABASE_URL!)
  url.searchParams.set('options', `-c search_path=${schema}`)
  store = createStore(url.toString())
  await store.init()
  const listening = await listen(
    createApp(config, store, generate, resolve('client/dist'), async () => [
      { id: 'test/model', name: 'Test model' },
    ]),
  )
  server = listening.instance
  base = listening.url
})
beforeEach(async () => {
  await store.pool.query('TRUNCATE messages, request_limits')
  generate.mockReset()
  generate.mockResolvedValue('Answer')
})
afterAll(async () => {
  if (server) await new Promise<void>((done) => server.close(() => done()))
  if (store) await store.close()
  if (/^test_[a-f0-9]{32}$/.test(schema))
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
  await admin.end()
})

describe('database', () => {
  it('lists models separately and passes the selected model to generation', async () => {
    const catalog = await request('models')
    expect(catalog.status).toBe(200)
    expect(await catalog.json()).toEqual({
      models: [{ id: 'test/model', name: 'Test model' }],
      defaultModel: config.model,
    })
    const user = await session()
    const reply = await request('messages', user, {
      message: 'Hello',
      requestId: randomUUID(),
      model: 'test/model',
    })
    expect(reply.status).toBe(201)
    expect(generate).toHaveBeenCalledWith(expect.any(Array), 'test/model')
    generate.mockClear()
    for (const model of [null, '', 5, 'missing/model', 'x'.repeat(257)]) {
      expect(
        (await request('messages', user, { message: 'Hello', requestId: randomUUID(), model }))
          .status,
      ).toBe(400)
    }
    expect(generate).not.toHaveBeenCalled()
  })
  it('verifies installer settings and database access without calling the provider', async () => {
    const url = new URL(process.env.DATABASE_URL!)
    url.searchParams.set('options', `-c search_path=${schema}`)
    await expect(
      verifyInstallation(resolve('.'), { ...process.env, DATABASE_URL: url.toString() }),
    ).resolves.toBeUndefined()
    await expect(
      verifyInstallation(resolve('.'), { ...process.env, SESSION_SECRET: 'short' }),
    ).rejects.toThrow('SESSION_SECRET')
  })
  it('initializes repeatedly and checks health', async () => {
    await store.init()
    await expect(store.health()).resolves.toBeUndefined()
  })
  it('handles idle connection errors without exposing credentials', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    store.pool.emit('error', new Error('private database details'))
    expect(log).toHaveBeenCalledWith('Database connection interrupted')
    log.mockRestore()
  })
  it('saves a pair, isolates sessions and reuses request IDs without another provider call', async () => {
    const id = randomUUID(),
      requestId = randomUUID()
    const first = await store.reply(id, requestId, "Hello'; DROP TABLE messages; --", generate, 100)
    const retry = await store.reply(id, requestId, first.user_message, generate, 100)
    expect(retry).toEqual(first)
    expect(first.sent_at).toBeInstanceOf(Date)
    expect(first.sent_at!.getTime()).toBeLessThanOrEqual(first.created_at.getTime())
    expect(Math.abs(Date.now() - first.created_at.getTime())).toBeLessThan(2000)
    expect(generate).toHaveBeenCalledTimes(1)
    expect(await store.history(id)).toHaveLength(1)
    expect(await store.history(randomUUID())).toEqual([])
    await expect(store.reply(id, requestId, 'different', generate, 100)).rejects.toMatchObject({
      code: 'REQUEST_CONFLICT',
    })
  })
  it('locks a session across concurrent requests and releases the lock', async () => {
    const id = randomUUID()
    let release!: (text: string) => void
    let entered!: () => void
    const started = new Promise<void>((done) => {
      entered = done
    })
    const slow = () => {
      entered()
      return new Promise<string>((done) => {
        release = done
      })
    }
    const first = store.reply(id, randomUUID(), 'first', slow, 100)
    await started
    await expect(store.reply(id, randomUUID(), 'second', generate, 100)).rejects.toMatchObject({
      code: 'REQUEST_BUSY',
    })
    release('done')
    await first
    await expect(store.reply(id, randomUUID(), 'third', generate, 100)).resolves.toMatchObject({
      ai_message: 'Answer',
    })
  })
  it('counts failures, rolls back messages and persists the daily budget', async () => {
    generate.mockRejectedValueOnce(new HttpError(502, 'unavailable'))
    const id = randomUUID()
    await expect(store.reply(id, randomUUID(), 'first', generate, 1)).rejects.toMatchObject({
      status: 502,
    })
    expect(await store.history(id)).toEqual([])
    await expect(store.reply(id, randomUUID(), 'second', generate, 1)).rejects.toMatchObject({
      code: 'DAILY_LIMIT',
    })
    await store.pool.query("UPDATE request_limits SET started_at=now()-interval '2 days'")
    await expect(store.reply(id, randomUUID(), 'third', generate, 1)).resolves.toMatchObject({
      ai_message: 'Answer',
    })
  })
  it('limits context and ignores incomplete legacy rows', async () => {
    const id = randomUUID()
    await store.pool.query(
      `INSERT INTO messages(session_id,user_message,ai_message,created_at)
      SELECT $1, repeat('u',1000), repeat('a',1000), timezone('UTC',now()) + i*interval '1 microsecond' FROM generate_series(1,205) i`,
      [id],
    )
    await store.pool.query('INSERT INTO messages(session_id) VALUES($1)', [id])
    expect(await store.history(id)).toHaveLength(200)
    await store.reply(id, randomUUID(), 'latest', generate, 100)
    const context = generate.mock.calls.at(-1)![0] as unknown as { content: string; role: string }[]
    expect(context.reduce((sum, m) => sum + m.content.length, 0)).toBeLessThanOrEqual(24000)
    expect(context.at(-1)?.content).toBe('latest')
    expect(context[0].role).toBe('user')
  })
})

describe('HTTP and security', () => {
  it('calls the default HTTP gateway implementation', async () => {
    const upstream = createServer((_req, res) => {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ choices: [{ message: { content: 'Actual HTTP transport' } }] }))
    }).listen(0, '127.0.0.1')
    await once(upstream, 'listening')
    const gatewayApp = await listen(
      createApp(
        { ...config, baseUrl: `http://127.0.0.1:${(upstream.address() as { port: number }).port}` },
        store,
      ),
    )
    try {
      const user = await session(gatewayApp.url)
      const res = await request(
        'messages',
        user,
        { message: 'hello', requestId: randomUUID() },
        {},
        gatewayApp.url,
      )
      expect((await res.json()).message.ai_message).toBe('Actual HTTP transport')
    } finally {
      await new Promise<void>((done) => gatewayApp.instance.close(() => done()))
      await new Promise<void>((done) => upstream.close(() => done()))
    }
  })
  it('sets private signed cookies and safe response headers', async () => {
    const res = await request('session')
    expect(res.headers.get('set-cookie')).toMatch(/HttpOnly; SameSite=Strict/)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('content-security-policy')).toContain("script-src 'self'")
    expect(res.headers.get('x-powered-by')).toBeNull()
    const user = await session()
    expect((await (await request('session', user)).json()).sessionId).toBe(user.id)
  })
  it('checks the database for health and serves the built app', async () => {
    expect((await request('health')).status).toBe(200)
    expect((await fetch(base)).status).toBe(200)
    const env = await fetch(`${base}/.env`)
    expect(await env.text()).not.toContain('AI_API_KEY=')
  })
  it('rejects missing, forged, malformed and mismatched sessions', async () => {
    expect((await request('messages')).status).toBe(409)
    const user = await session()
    expect(
      (await request('messages', user, undefined, { Cookie: `session_id=${user.id}` })).status,
    ).toBe(409)
    expect((await request('messages', user, undefined, { Cookie: 'session_id=%XX' })).status).toBe(
      409,
    )
    expect(
      (await request('messages', user, undefined, { 'X-Session-Id': randomUUID() })).status,
    ).toBe(409)
  })
  it('blocks cross-site calls before they can change cookies or incur costs', async () => {
    const user = await session()
    for (const headers of [
      { Origin: 'https://evil.example' },
      { 'Sec-Fetch-Site': 'cross-site' },
    ]) {
      const res = await request('session', user, {}, headers)
      expect(res.status).toBe(403)
      expect(res.headers.get('set-cookie')).toBeNull()
    }
    expect(generate).not.toHaveBeenCalled()
  })
  it('rotates the session and leaves the old history private', async () => {
    const user = await session()
    await request('messages', user, { message: 'Hello', requestId: randomUUID() })
    const res = await request('session', user, {})
    const current = {
      id: (await res.json()).sessionId,
      cookie: res.headers.get('set-cookie')!.split(';')[0],
    }
    expect((await (await request('messages', current)).json()).messages).toEqual([])
    expect(await store.history(user.id)).toHaveLength(1)
    expect((await request('messages', { ...current, id: user.id })).status).toBe(409)
  })
  it.each([
    null,
    {},
    { message: '' },
    { message: ' ' },
    { message: 2 },
    { message: 'x'.repeat(4001) },
    { message: 'ok', requestId: 'bad' },
  ])('validates %j', async (body) => {
    expect((await request('messages', await session(), body)).status).toBe(400)
  })
  it('rejects huge and malformed bodies and non-JSON requests', async () => {
    const user = await session()
    expect((await request('messages', user, { message: 'x'.repeat(30000) })).status).toBe(413)
    expect((await request('messages', user, {}, { 'Content-Type': 'text/plain' })).status).toBe(415)
    expect(
      (
        await fetch(`${base}/api/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{bad',
        })
      ).status,
    ).toBe(400)
  })
  it('returns both session and message and never exposes database errors', async () => {
    const user = await session()
    const response = await request('messages', user, { message: 'Hello', requestId: randomUUID() })
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      sessionId: user.id,
      message: { ai_message: 'Answer' },
    })
    const spy = vi
      .spyOn(store, 'history')
      .mockRejectedValueOnce(new Error('postgres password=secret'))
    expect(await (await request('messages', user)).text()).not.toContain('secret')
    spy.mockRestore()
    expect((await request('missing', user)).status).toBe(404)
  })
  it('disables unconfigured providers, supports secure cookies and enforces per-IP limits', async () => {
    const off = await listen(
      createApp({ ...config, apiKey: '', secureCookie: true }, store, generate),
    )
    try {
      const res = await fetch(`${off.url}/api/session`)
      expect(res.headers.get('set-cookie')).toContain('Secure')
      const user = {
        id: (await res.json()).sessionId,
        cookie: res.headers.get('set-cookie')!.split(';')[0],
      }
      expect(
        (
          await request(
            'messages',
            user,
            { message: 'Hello', requestId: randomUUID() },
            {},
            off.url,
          )
        ).status,
      ).toBe(503)
    } finally {
      await new Promise<void>((done) => off.instance.close(() => done()))
    }
    const limited = await listen(createApp({ ...config, requestsPerMinute: 1 }, store, generate))
    try {
      const user = await session(limited.url)
      expect(
        (
          await request(
            'messages',
            user,
            { message: 'Hello', requestId: randomUUID() },
            {},
            limited.url,
          )
        ).status,
      ).toBe(201)
      const response = await request(
        'messages',
        user,
        { message: 'Again', requestId: randomUUID() },
        {},
        limited.url,
      )
      expect(response.status).toBe(429)
      expect(response.headers.get('retry-after')).toBeTruthy()
    } finally {
      await new Promise<void>((done) => limited.instance.close(() => done()))
    }
  })
  it('limits simultaneous provider calls across different sessions', async () => {
    const releases: ((value: string) => void)[] = []
    generate.mockImplementation(
      () =>
        new Promise((resolve) => {
          releases.push(resolve)
        }),
    )
    const users = await Promise.all(Array.from({ length: 5 }, () => session()))
    const pending = users
      .slice(0, 4)
      .map((user) => request('messages', user, { message: 'Hello', requestId: randomUUID() }))
    await vi.waitFor(() => expect(releases).toHaveLength(4))
    try {
      expect(
        (await request('messages', users[4], { message: 'Hello', requestId: randomUUID() })).status,
      ).toBe(503)
    } finally {
      releases.forEach((done) => done('done'))
      await Promise.all(pending)
    }
  })
})
