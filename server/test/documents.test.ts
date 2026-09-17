import { expect, it, vi, afterEach } from 'vitest'
import { prepareDocuments } from '../src/documents.js'
import { documentPrompt, imagePrompt, complete } from '../src/gateway.js'

const document = (name = 'report.pdf', content: string | Buffer = '%PDF-1.7\n%%EOF') => ({
  name,
  data: `data:application/octet-stream;base64,${Buffer.from(content).toString('base64')}`,
})
afterEach(() => vi.unstubAllGlobals())
it('preserves PDF bytes and UTF-8 text without cropping or truncation', async () => {
  const prepared = prepareDocuments([document(), document('notes.md', 'Важный текст')])
  expect(prepared[1].text).toBe('Важный текст')
  const prompt = documentPrompt(imagePrompt('Compare', [Buffer.from('image')]), prepared)
  expect(prompt.content).toEqual([
    { type: 'text', text: 'Compare' },
    { type: 'image_url', image_url: { url: 'data:image/webp;base64,aW1hZ2U=' } },
    {
      type: 'file',
      file: {
        filename: 'report.pdf',
        file_data: 'data:application/pdf;base64,JVBERi0xLjcKJSVFT0Y=',
      },
    },
    { type: 'text', text: 'Документ: notes.md\nВажный текст' },
  ])
  expect(documentPrompt({ role: 'user', content: '' }, prepared).content[0]).toEqual({
    type: 'text',
    text: 'Изучи вложенные документы.',
  })
  const fetch = vi.fn(async () => Response.json({ choices: [{ message: { content: 'Answer' } }] }))
  vi.stubGlobal('fetch', fetch)
  await complete([prompt], {
    baseUrl: 'https://example.com',
    apiKey: 'test',
    model: 'file/model',
    timeoutMs: 1000,
  })
  expect(JSON.parse(fetch.mock.calls[0][1].body).plugins).toEqual([
    { id: 'file-parser', pdf: { engine: 'native' } },
  ])
  expect(prepareDocuments(undefined)).toEqual([])
  expect(prepareDocuments([document('other.pdf')])[0].hash).not.toBe(prepared[0].hash)
})

it.each([
  null,
  {},
  [document(), document(), document(), document()],
  [null],
  [document('../test.pdf')],
  [document('bad\n.pdf')],
  [document('')],
  [document('a'.repeat(201) + '.pdf')],
  [document('test.exe')],
  [{ name: 'test.pdf', data: 12 }],
  [{ name: 'test.pdf', data: 'x'.repeat(7_000_001) }],
  [{ name: 'test.pdf', data: 'https://example.com/test.pdf' }],
  [document('test.txt', '')],
  [document('test.txt', Buffer.alloc(5 * 1024 * 1024 + 1))],
  [{ name: 'test.txt', data: 'data:application/octet-stream;base64,Zh==' }],
  [document('test.pdf', 'Not a PDF')],
  [document('test.pdf', '%PDF-1.7 no end')],
  [document('test.txt', Buffer.from([0xff]))],
  [document('test.txt', 'a\0b')],
  [document('test.txt', '   ')],
  [document('test.txt', 'x'.repeat(20001))],
])('rejects invalid or oversized documents: %#', (value) => {
  expect(() => prepareDocuments(value)).toThrow()
})
