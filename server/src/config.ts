export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const integer = (name: string, fallback: number, max: number) => {
    const value = Number(env[name] ?? fallback)
    if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(`Invalid ${name}`)
    return value
  }
  const secret = env.SESSION_SECRET?.trim() ?? ''
  if (secret.length < 32 || secret.includes('replace_with'))
    throw new Error('SESSION_SECRET must contain at least 32 random characters')
  if (!env.DATABASE_URL?.match(/^postgres(ql)?:\/\//)) throw new Error('DATABASE_URL is required')
  const base = new URL(env.AI_BASE_URL ?? 'https://openrouter.ai/api/v1')
  if (
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    (base.protocol !== 'https:' &&
      !(base.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)))
  ) {
    throw new Error('AI_BASE_URL must use HTTPS (HTTP is allowed for localhost)')
  }
  const port = integer('PORT', 3001, 65535)
  const origins = (
    env.APP_ORIGINS ??
    `http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:${port},http://localhost:${port}`
  )
    .split(',')
    .map((value) => {
      const url = new URL(value.trim())
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
        throw new Error('Invalid APP_ORIGINS')
      return url.origin
    })
  return {
    host: env.HOST ?? '127.0.0.1',
    port,
    secret,
    origins,
    databaseUrl: env.DATABASE_URL,
    baseUrl: base.href.replace(/\/$/, ''),
    apiKey: env.AI_API_KEY?.trim() ?? '',
    model: env.AI_MODEL?.trim() || 'openai/gpt-4.1-nano',
    secureCookie: env.COOKIE_SECURE === 'true',
    timeoutMs: integer('GATEWAY_TIMEOUT_MS', 60000, 120000),
    requestsPerMinute: integer('REQUESTS_PER_MINUTE', 15, 1000),
    dailyLimit: integer('DAILY_REQUEST_LIMIT', 100, 100000),
  }
}
export type Config = ReturnType<typeof readConfig>
