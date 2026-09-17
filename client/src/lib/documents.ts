export type DocumentAttachment = { name: string; data: string }
export const documentAccept = '.pdf,.txt,.md,.csv,.json'
export const maxDocumentBytes = 5 * 1024 * 1024

export function isDocument(value: unknown): value is DocumentAttachment {
  if (!value || typeof value !== 'object') return false
  const d = value as DocumentAttachment
  return (
    typeof d.name === 'string' &&
    d.name.length > 0 &&
    d.name.length <= 200 &&
    /\.(pdf|txt|md|csv|json)$/i.test(d.name) &&
    typeof d.data === 'string' &&
    d.data.length <= 7_000_000 &&
    /^data:application\/octet-stream;base64,[A-Za-z0-9+/]+={0,2}$/.test(d.data)
  )
}

export async function readDocument(file: File): Promise<DocumentAttachment> {
  if (!/\.(pdf|txt|md|csv|json)$/i.test(file.name))
    throw new Error('Поддерживаются PDF, TXT, MD, CSV и JSON. Другой документ сохраните в PDF.')
  if (!file.size || file.size > maxDocumentBytes)
    throw new Error('Документ должен быть непустым и не больше 5 МБ.')
  if (file.name.length > 200) throw new Error('Сократите имя файла до 200 символов.')
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () =>
      resolve({
        name: file.name,
        data: String(reader.result).replace(
          /^data:[^,]*,/,
          'data:application/octet-stream;base64,',
        ),
      })
    reader.onerror = () => reject(new Error('Не удалось прочитать документ.'))
    reader.readAsDataURL(file)
  })
}
