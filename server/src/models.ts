import type { Config } from './config.js'
import { HttpError } from './errors.js'

export type Model = { id: string; name: string; supportsImages?: boolean }

// Share in-flight requests and cache the catalog without tying it to a user session.
export function createModelCatalog(config: Pick<Config, 'baseUrl' | 'timeoutMs'>) {
  let cached: Model[] = []
  let expires = 0
  let pending: Promise<Model[]> | null = null
  return function models(): Promise<Model[]> {
    if (Date.now() < expires) return Promise.resolve(cached)
    pending ??= (async () => {
      try {
        const response = await fetch(`${config.baseUrl}/models`, {
          redirect: 'error',
          signal: AbortSignal.timeout(Math.min(config.timeoutMs, 15000)),
        })
        if (!response.ok || !response.body) {
          await response.body?.cancel()
          throw new Error('Catalog unavailable')
        }
        const chunks: Uint8Array[] = []
        let size = 0
        const reader = response.body.getReader()
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > 10_000_000) {
            await reader.cancel()
            throw new Error('Catalog too large')
          }
          chunks.push(value)
        }
        const data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        if (!Array.isArray(data?.data)) throw new Error('Invalid catalog')
        const unique = new Map<string, Model>()
        for (const model of data.data) {
          if (typeof model?.id !== 'string' || !model.id || model.id.length > 256) continue
          unique.set(model.id, {
            id: model.id,
            name: typeof model.name === 'string' && model.name ? model.name : model.id,
            supportsImages:
              Array.isArray(model.architecture?.input_modalities) &&
              model.architecture.input_modalities.includes('image'),
          })
        }
        if (!unique.size) throw new Error('Empty catalog')
        cached = [...unique.values()].sort((a, b) => a.name.localeCompare(b.name))
        expires = Date.now() + 5 * 60_000
        return cached
      } catch {
        throw new HttpError(502, 'Не удалось загрузить модели. Попробуйте ещё раз.')
      } finally {
        pending = null
      }
    })()
    return pending
  }
}
