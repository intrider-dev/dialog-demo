export const imageAccept = 'image/*'
export const maxImageBytes = 2 * 1024 * 1024

export function isImageData(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 2_800_000 &&
    /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
  )
}

export async function readImage(file: File): Promise<string> {
  if (!file.size) throw new Error('Изображение пустое.')
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error(
      'Не удалось открыть изображение. Сохраните его как PNG или JPEG и попробуйте снова.',
    )
  }
  try {
    if (
      file.size <= maxImageBytes &&
      Math.max(bitmap.width, bitmap.height) <= 2048 &&
      ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)
    )
      return await asDataUrl(file)

    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Не удалось подготовить изображение.')
    let scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height))
    while (true) {
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      // Try lossless first to preserve text and diagrams, then gently lower photo quality.
      for (const [type, quality] of [
        ['image/png', undefined],
        ['image/webp', 0.95],
        ['image/webp', 0.9],
        ['image/webp', 0.85],
        ['image/jpeg', 0.9],
      ] as const) {
        if (type === 'image/jpeg') {
          context.globalCompositeOperation = 'destination-over'
          context.fillStyle = '#fff'
          context.fillRect(0, 0, canvas.width, canvas.height)
          context.globalCompositeOperation = 'source-over'
        }
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, type, quality),
        )
        if (!blob) throw new Error('Не удалось сжать изображение.')
        if (blob.size <= maxImageBytes) return await asDataUrl(blob)
      }
      if (Math.max(canvas.width, canvas.height) <= 256)
        throw new Error('Не удалось подготовить изображение для отправки.')
      scale *= 0.8
    }
  } finally {
    bitmap.close()
  }
}

function asDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () =>
      isImageData(reader.result)
        ? resolve(reader.result)
        : reject(new Error('Не удалось прочитать изображение.'))
    reader.onerror = () => reject(new Error('Не удалось прочитать файл.'))
    reader.readAsDataURL(file)
  })
}
