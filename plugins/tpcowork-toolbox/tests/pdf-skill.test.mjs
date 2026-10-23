import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { createDocument } from '../resources/skills/office-pdf/scripts/create.mjs'

const requirePreview = createRequire(new URL('../../../../deepseek-harness/packages/client/ui-sidebar-documentpreview/package.json', import.meta.url))
const pdfRoot = dirname(requirePreview.resolve('pdfjs-dist/package.json'))
const { getDocument } = await import(pathToFileURL(requirePreview.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href)

test('creates a paginated Chinese PDF with extractable text and preserves existing output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tpcowork-pdf-'))
  try {
    const output = join(directory, '中文报告.pdf')
    const paragraphs = Array.from({ length: 81 }, (_, index) => `第${index + 1}条：中文内容与 English text 2026。`)
    await createDocument(output, { title: '中国人工智能发展', paragraphs })
    const bytes = await readFile(output)
    await assert.rejects(createDocument(output, { paragraphs: ['Do not replace the original'] }), { code: 'EEXIST' })
    assert.deepEqual(await readFile(output), bytes)
    const loading = getDocument({ data: Uint8Array.from(bytes), cMapUrl: join(pdfRoot, 'cmaps/'), cMapPacked: true, standardFontDataUrl: join(pdfRoot, 'standard_fonts/') })
    const document = await loading.promise
    try {
      assert.equal(document.numPages, 3)
      const text = []
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
        const page = await document.getPage(pageNumber)
        const content = await page.getTextContent()
        text.push(content.items.map(item => (item.str ?? '') + (item.hasEOL ? '\n' : '')).join(''))
        for (const item of content.items) {
          if (!('str' in item) || !item.str) continue
          assert.ok(item.transform[5] >= 40, 'text stays above the bottom margin')
          assert.ok(item.transform[4] + item.width <= 555, 'text stays inside the right margin')
        }
        const viewport = page.getViewport({ scale: 1 })
        const { canvas, context } = document.canvasFactory.create(viewport.width, viewport.height)
        try {
          await page.render({ canvas, canvasContext: context, viewport }).promise
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
          let ink = 0
          for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 220 && pixels[i + 1] < 220 && pixels[i + 2] < 220 && pixels[i + 3] > 0) ink++
          assert.ok(ink > 100, 'rendered page contains visible text')
        } finally { document.canvasFactory.destroy({ canvas, context }) }
      }
      assert.match(text[0], /中国人工智能发展/)
      assert.match(text.join('\n'), /第81条：中文内容与 English text 2026。/)
    } finally { await loading.destroy() }
    await assert.rejects(createDocument(join(directory, 'invalid.pdf'), { paragraphs: ['😀'] }), /does not support/)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
