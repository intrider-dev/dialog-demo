import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import App from '../src/App'
import { readDocument, isDocument } from '../src/lib/documents'
import { pendingRequest, savePending, isMessage } from '../src/lib/chat'
import { useChat } from '../src/hooks/use-chat'

const attachment = {
  name: 'report.pdf',
  data: 'data:application/octet-stream;base64,JVBERi0xLjcKJSVFT0Y=',
}
function mockApi() {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  let sessionId = crypto.randomUUID()
  const requests: Record<string, unknown>[] = []
  const fetch = vi.fn(async (path: string, options: RequestInit) => {
    if (path.endsWith('/models'))
      return Response.json({
        models: [
          { id: 'files', name: 'Files', supportsImages: true, supportsDocuments: true },
          { id: 'text', name: 'Text' },
        ],
        defaultModel: 'files',
      })
    if (path.endsWith('/session')) {
      if (options.method === 'POST') sessionId = crypto.randomUUID()
      return Response.json({ sessionId, configured: true })
    }
    if (options.method === 'POST') {
      requests.push(JSON.parse(options.body as string))
      return Response.json({ error: 'Unavailable' }, { status: 502 })
    }
    return Response.json({ sessionId, messages: [] })
  })
  vi.stubGlobal('fetch', fetch)
  return { fetch, requests, sessionId }
}

it('reads document bytes, rejects unsupported and oversized files, and validates cached requests', async () => {
  expect(await readDocument(new File(['%PDF-1.7\n%%EOF'], 'report.pdf'))).toEqual(attachment)
  for (const file of [
    new File(['x'], 'bad.exe'),
    new File([], 'empty.pdf'),
    new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.pdf'),
    new File(['x'], 'x'.repeat(201) + '.pdf'),
  ])
    await expect(readDocument(file)).rejects.toThrow()
  const read = vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function () {
    this.dispatchEvent(new ProgressEvent('error'))
  })
  await expect(readDocument(new File(['x'], 'ok.txt'))).rejects.toThrow('Не удалось прочитать')
  read.mockRestore()
  expect(isDocument(attachment)).toBe(true)
  for (const bad of [
    null,
    {},
    { name: 'a.pdf', data: 12 },
    { name: 'a.pdf', data: 'url' },
    { name: 'bad.exe', data: attachment.data },
  ])
    expect(isDocument(bad)).toBe(false)
  const id = crypto.randomUUID()
  const pending = { requestId: crypto.randomUUID(), message: '', documents: [attachment] }
  savePending(id, pending)
  expect(pendingRequest(id)).toEqual(pending)
  localStorage.setItem(`pending:${id}`, JSON.stringify({ ...pending, documents: [{}] }))
  expect(pendingRequest(id)).toBeNull()
  const message = {
    user_message: '',
    ai_message: 'Answer',
    created_at: new Date().toISOString(),
    request_id: null,
    documents: [{ id, name: 'report.pdf' }],
  }
  expect(isMessage(message)).toBe(true)
  expect(isMessage({ ...message, documents: [{ id: 'bad', name: 'report.pdf' }] })).toBe(false)
})

it('shows removable documents, icon-only capabilities, blocks incompatible models and retries the same request', async () => {
  const { requests } = mockApi()
  render(<App />)
  await waitFor(() => expect(screen.getByLabelText('Выбрать документы')).toBeEnabled())
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: 'Модель' })).toHaveTextContent('Files'),
  )
  const files = [new File(['%PDF-1.7\n%%EOF'], 'report.pdf')]
  fireEvent.click(screen.getByRole('button', { name: 'Прикрепить документы' }))
  fireEvent.change(screen.getByLabelText('Выбрать документы'), { target: { files } })
  await screen.findByRole('button', { name: 'Удалить документ report.pdf' })
  await userEvent.click(screen.getByRole('combobox', { name: 'Модель' }))
  expect(screen.getByRole('img', { name: 'Документы PDF' })).toHaveAttribute(
    'title',
    'Документы PDF',
  )
  expect(screen.getByRole('option', { name: /Files/ })).not.toHaveTextContent('Документы')
  expect(screen.getByRole('option', { name: /Text/ })).toHaveAttribute('aria-disabled', 'true')
  await userEvent.keyboard('{Escape}')
  await userEvent.click(screen.getByRole('button', { name: 'Отправить сообщение' }))
  await screen.findByText('Unavailable')
  await userEvent.click(screen.getByRole('button', { name: 'Отправить сообщение' }))
  await waitFor(() => expect(requests).toHaveLength(2))
  expect(requests[0]).toEqual(requests[1])
  expect(requests[0].documents).toEqual([attachment])
  await userEvent.click(await screen.findByRole('button', { name: 'Удалить документ report.pdf' }))
  expect(screen.getByRole('button', { name: 'Отправить сообщение' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Выбрать документы'), {
    target: { files: [new File(['x'], 'bad.exe')] },
  })
  expect(screen.getAllByRole('alert').at(-1)).toHaveTextContent('Поддерживаются PDF')
  fireEvent.change(screen.getByLabelText('Выбрать документы'), {
    target: { files: [...files, ...files, ...files, ...files] },
  })
  expect(screen.getAllByRole('alert').at(-1)).toHaveTextContent('до 3 документов')
  await userEvent.click(screen.getByRole('combobox', { name: 'Модель' }))
  await userEvent.click(screen.getByRole('option', { name: /Text/ }))
  fireEvent.change(screen.getByLabelText('Выбрать документы'), { target: { files } })
  expect(screen.getAllByRole('alert').at(-1)).toHaveTextContent(
    'Выберите модель со значком документа',
  )
  fireEvent.change(screen.getByLabelText('Выбрать документы'), {
    target: { files: [new File(['Hello'], 'notes.txt')] },
  })
  await screen.findByRole('button', { name: 'Удалить документ notes.txt' })
  await userEvent.click(screen.getByRole('button', { name: 'Новый диалог' }))
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Удалить документ notes.txt' }),
    ).not.toBeInTheDocument(),
  )
})

it('hydrates document retries once and ignores attachment reads from an old session', async () => {
  const { sessionId, requests } = mockApi()
  savePending(sessionId, {
    requestId: crypto.randomUUID(),
    message: '',
    model: 'files',
    documents: [attachment],
  })
  const { result } = renderHook(() => useChat())
  await waitFor(() => expect(result.current.ready).toBe(true))
  expect(result.current.documents).toEqual([attachment])
  await act(() => result.current.send('files'))
  expect(requests[0].documents).toEqual([attachment])
  act(() => result.current.setDocuments([{ ...attachment, name: 'other.pdf' }]))
  await act(() => result.current.send('files'))
  expect(requests[1].requestId).not.toBe(requests[0].requestId)
  await act(() => result.current.newSession())
  act(() => result.current.addDocuments(sessionId, [attachment]))
  expect(result.current.documents).toEqual([])
})
