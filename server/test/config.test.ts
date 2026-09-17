import { describe, it, expect } from 'vitest'
import { readConfig } from '../src/config.js'
import { isUuid, parseSession } from '../src/app.js'
import { HttpError } from '../src/errors.js'

const env = { DATABASE_URL: 'postgres://localhost/test', SESSION_SECRET: 's'.repeat(48) }
describe('configuration and validation', () => {
  it('has local defaults and trims secrets', () => {
    expect(readConfig({ ...env, AI_API_KEY: ' key ' })).toMatchObject({
      apiKey: 'key',
      port: 3001,
      model: 'openai/gpt-4.1-nano',
      dailyLimit: 100,
    })
  })
  it.each([
    { SESSION_SECRET: 'short' },
    { DATABASE_URL: 'file:/db' },
    { PORT: '0' },
    { PORT: '1.1' },
    { PORT: '65536' },
    { DAILY_REQUEST_LIMIT: '-1' },
    { AI_BASE_URL: 'http://example.com' },
    { AI_BASE_URL: 'https://user:pass@example.com' },
    { AI_BASE_URL: 'https://example.com?a=1' },
    { APP_ORIGINS: 'bad' },
    { APP_ORIGINS: 'file:///page.html' },
  ])('rejects unsafe configuration %j', (value) => {
    expect(() => readConfig({ ...env, ...value })).toThrow()
  })
  it('supports local providers and secure cookies', () => {
    expect(
      readConfig({
        ...env,
        AI_BASE_URL: 'http://127.0.0.1:11434/v1/',
        COOKIE_SECURE: 'true',
        APP_ORIGINS: 'https://example.com',
      }),
    ).toMatchObject({
      secureCookie: true,
      baseUrl: 'http://127.0.0.1:11434/v1',
      origins: ['https://example.com'],
    })
  })
  it('accepts only UUID v4 strings', () => {
    expect(isUuid('7f49b058-c40c-4fbb-a4d8-93d9075473af')).toBe(true)
    for (const value of [null, {}, '', '7f49b058-c40c-1fbb-a4d8-93d9075473af'])
      expect(isUuid(value)).toBe(false)
  })
  it('keeps safe error metadata', () => {
    expect(new HttpError(409, 'retry', 'BUSY')).toMatchObject({
      status: 409,
      message: 'retry',
      code: 'BUSY',
    })
  })
  it('expires cookies on the server and rejects future or malformed timestamps', () => {
    const id = '7f49b058-c40c-4fbb-a4d8-93d9075473af'
    const now = Date.now()
    expect(parseSession(`${id}.${now}`, now)).toBe(id)
    for (const token of [
      null,
      id,
      `${id}.bad`,
      `${id}.${now + 1}`,
      `${id}.${now - 30 * 86400_000}`,
      `${id}.${now}.extra`,
    ])
      expect(parseSession(token, now)).toBeNull()
  })
})
