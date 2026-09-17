import type { Message, Session, Pending } from '@/types/chat'
export class ApiError extends Error {
  code: string
  constructor(message: string, code = 'REQUEST_FAILED') {
    super(message)
    this.code = code
  }
}
export const storageKey = (id: string) => `chat:${id}`
export function isMessage(value: unknown): value is Message {
  if (!value || typeof value !== 'object') return false
  const m = value as Message
  return (
    typeof m.user_message === 'string' &&
    typeof m.ai_message === 'string' &&
    typeof m.created_at === 'string' &&
    Number.isFinite(Date.parse(m.created_at)) &&
    (m.sent_at == null ||
      (typeof m.sent_at === 'string' && Number.isFinite(Date.parse(m.sent_at)))) &&
    (m.request_id === null || typeof m.request_id === 'string')
  )
}
export function cached(id: string): Message[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(storageKey(id)) ?? '[]')
    return Array.isArray(data) ? data.filter(isMessage).slice(-200) : []
  } catch {
    return []
  }
}
export function save(id: string, messages: Message[]) {
  try {
    localStorage.setItem(storageKey(id), JSON.stringify(messages.slice(-200)))
  } catch {
    /* Storage can be disabled. */
  }
}
export function pendingRequest(id: string): Pending | null {
  try {
    const data = JSON.parse(localStorage.getItem(`pending:${id}`) ?? 'null')
    return data &&
      typeof data.requestId === 'string' &&
      /^[0-9a-f-]{36}$/i.test(data.requestId) &&
      typeof data.message === 'string' &&
      (data.model === undefined || (typeof data.model === 'string' && data.model.length <= 256)) &&
      data.message.length <= 4000
      ? data
      : null
  } catch {
    return null
  }
}
export function savePending(id: string, pending: Pending | null) {
  try {
    if (pending) localStorage.setItem(`pending:${id}`, JSON.stringify(pending))
    else localStorage.removeItem(`pending:${id}`)
  } catch {
    /* A failed storage write must not stop the chat. */
  }
}
export async function api<T>(path: string, body?: unknown, sessionId?: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(sessionId ? { 'X-Session-Id': sessionId } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(75_000),
    })
  } catch {
    throw new ApiError('Не удалось связаться с сервером. Проверьте соединение и повторите запрос.')
  }
  let data
  try {
    data = await response.json()
  } catch {
    throw new ApiError('Сервер вернул некорректный ответ. Попробуйте ещё раз.')
  }
  if (!response.ok)
    throw new ApiError(
      typeof data?.error === 'string' ? data.error : 'Не удалось выполнить запрос.',
      data?.code,
    )
  return data
}
let bootstrap: Promise<Session> | null = null
export function getSession() {
  // StrictMode can mount twice; both calls must share the same initial cookie.
  bootstrap ??= api<Session>('session').finally(() => {
    bootstrap = null
  })
  return bootstrap
}
