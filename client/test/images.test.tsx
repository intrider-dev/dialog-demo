import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import App from '../src/App'
import { isImageData, readImage } from '../src/lib/images'
import { useChat } from '../src/hooks/use-chat'
import { pendingRequest } from '../src/lib/chat'

const image = 'data:image/png;base64,iVBORw0KGgo='
beforeEach(() => {
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: 100, height: 100, close: vi.fn() })),
  )
})
const file = () =>
  new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'picture.png', {
    type: 'image/png',
  })
function mockApi(supportsImages = true) {
  const sessionId = crypto.randomUUID()
  const fetch = vi.fn(async (path: string, options?: RequestInit) => {
    if (path.endsWith('/models'))
      return Response.json({
        models: [{ id: 'vision/model', name: 'Vision', supportsImages }],
        defaultModel: 'vision/model',
      })
    if (path.endsWith('/session')) return Response.json({ sessionId, configured: true })
    if (options?.method === 'POST') {
      const data = JSON.parse(options.body as string)
      return Response.json({
        sessionId,
        message: {
          request_id: data.requestId,
          user_message: data.message,
          ai_message: 'A picture',
          image_ids: [crypto.randomUUID()],
          created_at: new Date().toISOString(),
        },
      })
    }
    return Response.json({ sessionId, messages: [] })
  })
  vi.stubGlobal('fetch', fetch)
  return { fetch, sessionId }
}

it('reads small supported files and rejects empty or undecodable files', async () => {
  expect(await readImage(file())).toBe(image)
  expect(isImageData('https://example.com/image.png')).toBe(false)
  expect(isImageData(null)).toBe(false)
  expect(isImageData('data:image/svg+xml;base64,YQ==')).toBe(false)
  await expect(readImage(new File([], 'empty.png', { type: 'image/png' }))).rejects.toThrow(
    'пустое',
  )
  vi.mocked(createImageBitmap).mockRejectedValueOnce(new Error('decode'))
  await expect(readImage(new File(['x'], 'broken.jpg'))).rejects.toThrow('Не удалось открыть')
})

it('compresses large photos without cropping, tries lossless first and releases decoded pixels', async () => {
  const close = vi.fn()
  vi.mocked(createImageBitmap).mockResolvedValue({
    width: 6000,
    height: 4000,
    close,
  } as unknown as ImageBitmap)
  const drawImage = vi.fn()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage,
  } as unknown as CanvasRenderingContext2D)
  const encode = vi
    .spyOn(HTMLCanvasElement.prototype, 'toBlob')
    .mockImplementation((callback, type) => {
      callback(new Blob([new Uint8Array(type === 'image/png' ? 3 * 1024 * 1024 : 100)], { type }))
    })
  const result = await readImage(
    new File([new Uint8Array(4 * 1024 * 1024)], 'photo.jpg', { type: 'image/jpeg' }),
  )
  expect(result).toMatch(/^data:image\/webp;base64,/)
  expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 2048, 1365)
  expect(encode.mock.calls.map(([, type, quality]) => [type, quality])).toEqual([
    ['image/png', undefined],
    ['image/webp', 0.95],
  ])
  expect(close).toHaveBeenCalledOnce()
})

it('reduces dimensions when encoding alone cannot fit and converts other decoded formats', async () => {
  vi.mocked(createImageBitmap).mockResolvedValue({
    width: 2048,
    height: 1024,
    close: vi.fn(),
  } as unknown as ImageBitmap)
  const drawImage = vi.fn()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage,
    fillRect: vi.fn(),
  } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (callback, type) {
    callback(new Blob([new Uint8Array(this.width === 2048 ? 3 * 1024 * 1024 : 100)], { type }))
  })
  expect(await readImage(new File(['pixels'], 'picture.avif', { type: 'image/avif' }))).toMatch(
    /^data:image\/png/,
  )
  expect(drawImage).toHaveBeenLastCalledWith(expect.anything(), 0, 0, 1638, 819)
})

it('reports unavailable canvas and encoding failures', async () => {
  const source = new File(['pixels'], 'picture.bmp', { type: 'image/bmp' })
  const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  await expect(readImage(source)).rejects.toThrow('Не удалось подготовить')
  context.mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
  const encode = vi
    .spyOn(HTMLCanvasElement.prototype, 'toBlob')
    .mockImplementation((callback) => callback(null))
  await expect(readImage(source)).rejects.toThrow('Не удалось сжать')
  context.mockReturnValue({
    drawImage: vi.fn(),
    fillRect: vi.fn(),
  } as unknown as CanvasRenderingContext2D)
  encode.mockImplementation((callback, type) =>
    callback(new Blob([new Uint8Array(3 * 1024 * 1024)], { type })),
  )
  await expect(readImage(source)).rejects.toThrow('для отправки')
})

it('selects files, previews and removes them, pastes pictures and sends image-only messages', async () => {
  const { fetch } = mockApi()
  render(<App />)
  const picker = screen.getByLabelText('Выбрать изображения')
  await waitFor(() => expect(picker).toBeEnabled())
  await userEvent.click(screen.getByRole('button', { name: 'Прикрепить изображения' }))
  await userEvent.upload(picker, file())
  expect(await screen.findByAltText('Вложение 1')).toHaveAttribute('src', image)
  await userEvent.click(screen.getByRole('button', { name: 'Удалить изображение 1' }))
  expect(screen.queryByAltText('Вложение 1')).not.toBeInTheDocument()
  fireEvent.paste(screen.getByRole('textbox'), {
    clipboardData: { items: [{ kind: 'file', getAsFile: file }], getData: () => '' },
  })
  await screen.findByAltText('Вложение 1')
  await userEvent.click(screen.getByRole('button', { name: 'Отправить сообщение' }))
  await screen.findByText('A picture')
  const request = fetch.mock.calls.find(([, options]) => options?.method === 'POST')
  expect(JSON.parse(request![1]!.body as string)).toMatchObject({
    message: '',
    images: [image],
    model: 'vision/model',
  })
  expect(screen.getByAltText('Вложение 1').getAttribute('src')).toMatch(/^\/api\/images\//)
})

it('blocks attachments for text-only models and rejects too many files', async () => {
  mockApi(false)
  const view = render(<App />)
  await waitFor(() => expect(screen.getByRole('textbox')).toBeEnabled())
  expect(screen.getByRole('button', { name: 'Прикрепить изображения' })).toBeDisabled()
  fireEvent.paste(screen.getByRole('textbox'), {
    clipboardData: { items: [{ kind: 'file', getAsFile: file }], getData: () => '' },
  })
  expect(await screen.findByRole('alert')).toHaveTextContent('Выберите модель')
  view.unmount()
  mockApi()
  render(<App />)
  const picker = screen.getByLabelText('Выбрать изображения')
  await waitFor(() => expect(picker).toBeEnabled())
  await userEvent.upload(picker, [file(), file(), file(), file()])
  expect(screen.getByRole('alert')).toHaveTextContent('до 3 изображений')
  expect(screen.queryByAltText('Вложение 1')).not.toBeInTheDocument()
  vi.mocked(createImageBitmap).mockRejectedValueOnce(new Error('decode'))
  fireEvent.change(picker, {
    target: { files: [new File(['text'], 'note.txt', { type: 'text/plain' })] },
  })
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('PNG или JPEG'))
})

it('keeps a selected file when returning from the file dialog triggers a slow history refresh', async () => {
  const { fetch, sessionId } = mockApi()
  render(<App />)
  const picker = screen.getByLabelText('Выбрать изображения')
  await waitFor(() => expect(picker).toBeEnabled())
  let finish!: (response: Response) => void
  fetch.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve
      }),
  )
  fireEvent.focus(window)
  // Windows can restore focus before the file input's change event arrives.
  fireEvent.change(picker, { target: { files: [file()] } })
  expect(await screen.findByAltText('Вложение 1')).toHaveAttribute('src', image)
  await act(async () => finish(Response.json({ sessionId, configured: true })))
  expect(screen.getByAltText('Вложение 1')).toHaveAttribute('src', image)
  await userEvent.click(screen.getByRole('button', { name: 'Отправить сообщение' }))
  await screen.findByText('A picture')
  const request = fetch.mock.calls.find(([, options]) => options?.method === 'POST')
  expect(JSON.parse(request![1]!.body as string).images).toEqual([image])
})

it('retains attachments on failure, retries with the same ID and resets them for a new session', async () => {
  const { fetch, sessionId } = mockApi()
  const { result } = renderHook(() => useChat())
  await waitFor(() => expect(result.current.ready).toBe(true))
  act(() => result.current.setImages([image]))
  fetch.mockRejectedValueOnce(new Error('offline'))
  await act(() => result.current.send('vision/model'))
  expect(result.current.images).toEqual([image])
  const previous = pendingRequest(sessionId)!
  expect(previous.images).toEqual([image])
  await act(() => result.current.send('vision/model'))
  expect(result.current.messages[0].request_id).toBe(previous.requestId)
  expect(result.current.images).toEqual([])
  act(() => result.current.setImages([image]))
  await act(() => result.current.newSession())
  expect(result.current.images).toEqual([])
})

it('reports file read failures without leaving a pending read', async () => {
  vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (this: FileReader) {
    queueMicrotask(() => this.onerror?.(new ProgressEvent('error') as ProgressEvent<FileReader>))
  })
  await expect(readImage(file())).rejects.toThrow('Не удалось прочитать файл.')
})

it('does not restore old retry attachments over edits when focus returns', async () => {
  const { fetch } = mockApi()
  const { result } = renderHook(() => useChat())
  await waitFor(() => expect(result.current.ready).toBe(true))
  act(() => {
    result.current.setDraft('First')
    result.current.setImages([image])
  })
  fetch.mockRejectedValueOnce(new Error('offline'))
  await act(() => result.current.send('vision/model'))
  act(() => {
    result.current.setDraft('Edited')
    result.current.setImages([])
  })
  await act(async () => window.dispatchEvent(new Event('focus')))
  expect(result.current.draft).toBe('Edited')
  expect(result.current.images).toEqual([])
})

it('keeps attachments in a new dialog on focus but discards reads belonging to a replaced session', async () => {
  const { fetch } = mockApi()
  const { result } = renderHook(() => useChat())
  await waitFor(() => expect(result.current.ready).toBe(true))
  const nextId = crypto.randomUUID()
  fetch.mockImplementation(async (path) =>
    path.endsWith('/session')
      ? Response.json({ sessionId: nextId, configured: true })
      : Response.json({ sessionId: nextId, messages: [] }),
  )
  await act(() => result.current.newSession())
  act(() => result.current.addImages(nextId, [image]))
  await act(async () => window.dispatchEvent(new Event('focus')))
  expect(result.current.images).toEqual([image])
  const changedId = crypto.randomUUID()
  fetch.mockImplementation(async (path) =>
    path.endsWith('/session')
      ? Response.json({ sessionId: changedId, configured: true })
      : Response.json({ sessionId: changedId, messages: [] }),
  )
  await act(async () => window.dispatchEvent(new Event('focus')))
  expect(result.current.images).toEqual([])
  act(() => result.current.addImages(nextId, [image]))
  expect(result.current.images).toEqual([])
})
