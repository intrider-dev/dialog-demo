import type { Config } from './config.js'
import { HttpError } from './errors.js'

export type Prompt = { role: 'user' | 'assistant'; content: string }

export async function complete(
  messages: Prompt[],
  config: Pick<Config, 'baseUrl' | 'apiKey' | 'model' | 'timeoutMs'>,
): Promise<string> {
  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, messages, max_tokens: 1000 }),
      signal: AbortSignal.timeout(config.timeoutMs),
    })
    if (!response.ok) {
      await response.body?.cancel()
      if (response.status === 429)
        throw new HttpError(503, 'Модель сейчас занята. Попробуйте через минуту.', 'PROVIDER_BUSY')
      throw new HttpError(502, 'Не удалось получить ответ. Попробуйте ещё раз.')
    }
    if (!response.body) throw new Error('Empty body')
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 256_000) {
        await reader.cancel()
        throw new Error('Response too large')
      }
      chunks.push(value)
    }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    const answer = data?.choices?.[0]?.message?.content
    if (typeof answer !== 'string' || !answer.trim() || answer.length > 16000)
      throw new Error('Invalid response')
    return answer.trim()
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(502, 'Не удалось получить ответ. Попробуйте ещё раз.')
  }
}
