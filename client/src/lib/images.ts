export const imageAccept = 'image/png,image/jpeg,image/webp,image/gif'
export const maxImageBytes = 2 * 1024 * 1024

export function isImageData(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 2_800_000 &&
    /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
  )
}

export function readImage(file: File): Promise<string> {
  if (!imageAccept.split(',').includes(file.type))
    return Promise.reject(new Error('Поддерживаются PNG, JPEG, WebP и GIF.'))
  if (!file.size || file.size > maxImageBytes)
    return Promise.reject(new Error('Каждое изображение должно быть не больше 2 МБ.'))
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
