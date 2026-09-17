import express from 'express'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import { rateLimit } from 'express-rate-limit'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import type { Config } from './config.js'
import type { Store } from './db.js'
import { complete, type Prompt } from './gateway.js'
import { HttpError } from './errors.js'
import { createModelCatalog } from './models.js'

export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
export function parseSession(value: unknown, now = Date.now()): string | null {
  if (typeof value !== 'string') return null
  const [id, issued, extra] = value.split('.')
  const timestamp = Number(issued)
  return isUuid(id) &&
    !extra &&
    /^\d+$/.test(issued ?? '') &&
    Number.isSafeInteger(timestamp) &&
    timestamp <= now &&
    now - timestamp < 30 * 86400_000
    ? id
    : null
}

export function createApp(
  config: Config,
  store: Store,
  generate: (messages: Prompt[], model: string) => Promise<string> = (messages, model) =>
    complete(messages, { ...config, model }),
  clientDist?: string,
  listModels = createModelCatalog(config),
) {
  const app = express()
  let activeRequests = 0
  const cookieOptions = {
    httpOnly: true,
    signed: true,
    sameSite: 'strict' as const,
    secure: config.secureCookie,
    path: '/',
    maxAge: 30 * 86400_000,
  }
  app.disable('x-powered-by')
  app.use(
    helmet({
      strictTransportSecurity: config.secureCookie ? undefined : false,
      contentSecurityPolicy: {
        directives: { 'upgrade-insecure-requests': config.secureCookie ? [] : null },
      },
    }),
  )
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    next()
  })
  app.get('/api/health', async (_req, res) => {
    await store.health()
    res.json({ status: 'ok' })
  })
  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: 120,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'Слишком много запросов. Подождите минуту.' },
    }),
  )
  app.use('/api', (req, _res, next) => {
    const origin = req.get('Origin')
    if (
      req.get('Sec-Fetch-Site') === 'cross-site' ||
      (origin && !config.origins.includes(origin))
    ) {
      throw new HttpError(403, 'Запрос с этого сайта запрещён.')
    }
    if (req.method === 'POST' && !req.is('application/json'))
      throw new HttpError(415, 'Ожидается JSON.')
    next()
  })
  app.use(express.json({ limit: '24kb' }))
  app.get('/api/models', async (_req, res) => {
    res.json({ models: await listModels(), defaultModel: config.model })
  })
  app.use(cookieParser(config.secret))
  // The header is not authentication: it catches a stale tab after another tab changes the signed cookie.
  app.use('/api', (req, res, next) => {
    const cookie = parseSession(req.signedCookies.session_id)
    const bootstrap = req.path === '/session' && req.method === 'GET'
    if (!isUuid(cookie) && !bootstrap)
      throw new HttpError(409, 'Сессия изменилась. Обновите диалог.', 'SESSION_CHANGED')
    const sessionId = isUuid(cookie) ? cookie : randomUUID()
    if (bootstrap) res.cookie('session_id', `${sessionId}.${Date.now()}`, cookieOptions)
    else if (req.get('X-Session-Id') !== sessionId)
      throw new HttpError(
        409,
        'Сессия изменилась в другой вкладке. Обновите диалог.',
        'SESSION_CHANGED',
      )
    res.locals.sessionId = sessionId
    next()
  })
  app.get('/api/session', (_req, res) =>
    res.json({ sessionId: res.locals.sessionId, configured: Boolean(config.apiKey) }),
  )
  app.post('/api/session', (_req, res) => {
    const sessionId = randomUUID()
    res.cookie('session_id', `${sessionId}.${Date.now()}`, cookieOptions)
    res.json({ sessionId, configured: Boolean(config.apiKey) })
  })
  app.get('/api/messages', async (_req, res) =>
    res.json({
      sessionId: res.locals.sessionId,
      messages: await store.history(res.locals.sessionId),
    }),
  )
  app.post(
    '/api/messages',
    rateLimit({
      windowMs: 60_000,
      limit: config.requestsPerMinute,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'Слишком много сообщений. Подождите минуту.' },
    }),
    async (req, res) => {
      const { message, requestId, model } = req.body ?? {}
      if (model !== undefined && (typeof model !== 'string' || !model || model.length > 256))
        throw new HttpError(400, 'Выберите модель из списка.')
      if (
        typeof message !== 'string' ||
        !message.trim() ||
        message.length > 4000 ||
        !isUuid(requestId)
      )
        throw new HttpError(400, 'Введите сообщение от 1 до 4000 символов.')
      if (!config.apiKey) throw new HttpError(503, 'Сервис пока не настроен. Попробуйте позже.')
      if (activeRequests >= 4) throw new HttpError(503, 'Сервис занят. Попробуйте через минуту.')
      activeRequests++
      try {
        const selectedModel = model ?? config.model
        if (model !== undefined && !(await listModels()).some((item) => item.id === model))
          throw new HttpError(400, 'Модель недоступна. Обновите список моделей.')
        const result = await store.reply(
          res.locals.sessionId,
          requestId,
          message.trim(),
          (messages) => generate(messages, selectedModel),
          config.dailyLimit,
        )
        res.status(201).json({ sessionId: res.locals.sessionId, message: result })
      } finally {
        activeRequests--
      }
    },
  )
  app.use('/api', () => {
    throw new HttpError(404, 'Не найдено.')
  })
  if (clientDist && existsSync(clientDist)) {
    app.use(express.static(clientDist, { dotfiles: 'deny' }))
    app.get('/{*path}', (_req, res) => res.sendFile('index.html', { root: clientDist }))
  }
  app.use(
    (
      error: { status?: number; code?: string; message?: string },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const status =
        error instanceof HttpError
          ? error.status
          : error.status === 400 || error.status === 413
            ? error.status
            : 500
      res.status(status).json({
        error:
          error instanceof HttpError
            ? error.message
            : status === 500
              ? 'Ошибка сервера. Попробуйте ещё раз.'
              : 'Некорректный запрос.',
        code: error instanceof HttpError ? error.code : 'REQUEST_FAILED',
      })
    },
  )
  return app
}
