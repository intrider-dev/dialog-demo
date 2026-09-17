import { expect, it } from 'vitest'
import sharp from 'sharp'
import { prepareImages } from '../src/images.js'
import { imagePrompt } from '../src/gateway.js'

it.each(['png', 'jpeg', 'webp', 'gif'] as const)(
  'decodes %s, bounds dimensions and strips metadata',
  async (format) => {
    const input = await sharp({
      create: { width: 2000, height: 20, channels: 3, background: 'red' },
    })
      .toFormat(format)
      .toBuffer()
    const result = await prepareImages([`data:image/${format};base64,${input.toString('base64')}`])
    const info = await sharp(result[0]!.data).metadata()
    expect(info.format).toBe('webp')
    expect(info.width).toBe(1600)
    expect(info.exif).toBeUndefined()
    expect(result[0]!.hash).toHaveLength(64)
    expect(imagePrompt('Describe', [result[0]!.data]).content).toEqual([
      { type: 'text', text: 'Describe' },
      { type: 'image_url', image_url: { url: expect.stringMatching(/^data:image\/webp;base64,/) } },
    ])
    expect(imagePrompt('', [result[0]!.data]).content[0]).toEqual({
      type: 'text',
      text: 'Опиши изображение.',
    })
  },
)

it('accepts absent attachments and rejects malformed, oversized, remote or active content', async () => {
  expect(await prepareImages(undefined)).toEqual([])
  expect(await prepareImages([])).toEqual([])
  const invalid = [
    null,
    {},
    [1],
    ['x'.repeat(2800001)],
    ['https://example.com/private.png'],
    ['data:image/svg+xml;base64,PHN2Zz4='],
    ['data:image/png;base64,PHN2Zz4='],
    ['data:image/png;base64,YQ'],
    ['data:image/png;base64,iVBORw0KGgo='],
    Array(4).fill('data:image/png;base64,YQ=='),
    [`data:image/png;base64,${Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64')}`],
  ]
  for (const value of invalid)
    await expect(prepareImages(value)).rejects.toMatchObject({ status: 400 })
})

it('rejects decompression bombs before processing their pixels', async () => {
  const input = await sharp({
    create: { width: 6000, height: 6000, channels: 3, background: 'white' },
  })
    .png()
    .toBuffer()
  await expect(
    prepareImages([`data:image/png;base64,${input.toString('base64')}`]),
  ).rejects.toMatchObject({ status: 400 })
})
