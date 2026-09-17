import sharp from 'sharp'
import { createHash } from 'node:crypto'
import { HttpError } from './errors.js'

export type PreparedImage = { data: Buffer; hash: string }

export async function prepareImages(value: unknown): Promise<PreparedImage[]> {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 3)
    throw new HttpError(400, 'Можно прикрепить до 3 изображений.')
  const result: PreparedImage[] = []
  for (const image of value) {
    if (typeof image !== 'string' || image.length > 2_800_000)
      throw new HttpError(400, 'Каждое изображение должно быть не больше 2 МБ.')
    const match = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image)
    if (!match) throw new HttpError(400, 'Поддерживаются PNG, JPEG, WebP и GIF.')
    const input = Buffer.from(match[2]!, 'base64')
    if (input.length > 2 * 1024 * 1024 || input.toString('base64') !== match[2])
      throw new HttpError(400, 'Некорректное изображение или размер больше 2 МБ.')
    const raster =
      input.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      input.subarray(0, 3).equals(Buffer.from([255, 216, 255])) ||
      /^GIF8[79]a$/.test(input.subarray(0, 6).toString('ascii')) ||
      (input.subarray(0, 4).toString('ascii') === 'RIFF' &&
        input.subarray(8, 12).toString('ascii') === 'WEBP')
    if (!raster) throw new HttpError(400, 'Файл не является поддерживаемым изображением.')
    try {
      // Decode raster data, strip metadata and bound dimensions before storing or forwarding it.
      const decoder = sharp(input, { limitInputPixels: 25_000_000, animated: false })
      const metadata = await decoder.metadata()
      if (!['png', 'jpeg', 'webp', 'gif'].includes(metadata.format ?? ''))
        throw new Error('Invalid format')
      const resized = decoder
        .rotate()
        .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
      let data = await resized.clone().webp({ lossless: true }).toBuffer()
      // Keep lossless output when it fits; reduce quality only as much as needed.
      for (const quality of [95, 90, 85, 80]) {
        if (data.length <= 2 * 1024 * 1024) break
        data = await resized.clone().webp({ quality }).toBuffer()
      }
      if (data.length > 2 * 1024 * 1024) throw new Error('Image too large')
      result.push({ data, hash: createHash('sha256').update(input).digest('hex') })
    } catch {
      throw new HttpError(400, 'Не удалось прочитать изображение. Выберите другой файл.')
    }
  }
  return result
}
