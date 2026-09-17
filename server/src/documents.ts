import { createHash } from 'node:crypto'
import { HttpError } from './errors.js'

export type PreparedDocument = { name: string; data: Buffer; hash: string; text?: string }

export function prepareDocuments(value: unknown): PreparedDocument[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 3)
    throw new HttpError(400, 'Можно прикрепить до 3 документов.')
  return value.map((document) => {
    if (
      !document ||
      typeof document.name !== 'string' ||
      !document.name.length ||
      document.name.length > 200 ||
      /[\x00-\x1f/\\]/.test(document.name) ||
      !/\.(pdf|txt|md|csv|json)$/i.test(document.name) ||
      typeof document.data !== 'string' ||
      document.data.length > 7_000_000
    )
      throw new HttpError(400, 'Некорректный документ. Поддерживаются PDF, TXT, MD, CSV и JSON.')
    const match = /^data:application\/octet-stream;base64,([A-Za-z0-9+/]+={0,2})$/.exec(
      document.data,
    )
    const data = Buffer.from(match?.[1] ?? '', 'base64')
    if (!data.length || data.length > 5 * 1024 * 1024 || data.toString('base64') !== match?.[1])
      throw new HttpError(400, 'Документ должен быть непустым и не больше 5 МБ.')
    let text: string | undefined
    if (/\.pdf$/i.test(document.name)) {
      if (
        !data
          .subarray(0, 8)
          .toString('ascii')
          .match(/^%PDF-\d\.\d/) ||
        !data.subarray(-1024).includes(Buffer.from('%%EOF'))
      )
        throw new HttpError(400, 'Не удалось прочитать PDF. Пересохраните документ.')
    } else {
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(data)
      } catch {
        throw new HttpError(400, 'Сохраните текстовый документ в UTF-8.')
      }
      if (!text.trim() || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text) || text.length > 20000)
        throw new HttpError(
          400,
          'Текстовый документ должен содержать до 20 000 символов без двоичных данных.',
        )
    }
    return {
      name: document.name,
      data,
      text,
      hash: createHash('sha256').update(document.name).update('\0').update(data).digest('hex'),
    }
  })
}
