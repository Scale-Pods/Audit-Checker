import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

/* A multi-page PDF is converted into one tall image. Sending only page one
   silently drops every later page, including the S.O. sheet that frequently
   sits behind the invoice page, so the webhook then audits a different
   document than the user uploaded. */
const MAX_SCALE = 2
const MIN_SCALE = 0.05
const MAX_CANVAS_WIDTH = 8192
const MAX_CANVAS_HEIGHT = 24000
const MAX_CANVAS_AREA = 80000000
const PAGE_GAP = 12
// n8n rejects a payload over its configured limit, and a joined multi-page
// scan can easily pass that as lossless PNG. Small documents stay PNG; large
// ones are re-encoded as JPEG so every page still reaches the webhook.
const MAX_PNG_BYTES = 8 * 1024 * 1024

/* pdf.js decodes some scans with WebAssembly helpers (JBIG2, JPEG 2000, ICC)
   and falls back to embedded fonts/CMaps for text. Without these paths it
   silently drops those XObjects and fonts, which empties scanned invoices and
   wipes their text from the rendered page. The assets are vendored under
   public/pdfjs so the worker can fetch them in dev and in the built app. */
const resolvePdfAssetBase = () => new URL(
  `${import.meta.env.BASE_URL}pdfjs/`,
  window.location.href
).href

const canvasToBlob = (canvas, type, quality) => new Promise((resolve, reject) => {
  canvas.toBlob(
    result => (result ? resolve(result) : reject(new Error('Could not encode the converted PDF'))),
    type,
    quality
  )
})

const encodeCanvas = async (canvas) => {
  const png = await canvasToBlob(canvas, 'image/png')
  if (png.size <= MAX_PNG_BYTES) return { blob: png, extension: 'png', type: 'image/png' }

  const jpeg = await canvasToBlob(canvas, 'image/jpeg', 0.9)
  return jpeg.size < png.size
    ? { blob: jpeg, extension: 'jpg', type: 'image/jpeg' }
    : { blob: png, extension: 'png', type: 'image/png' }
}

const measureLayout = (sizes, scale) => {
  const width = Math.ceil(Math.max(...sizes.map(size => size.width)) * scale)
  const height = sizes.reduce((total, size) => total + Math.ceil(size.height * scale), 0)
    + PAGE_GAP * Math.max(0, sizes.length - 1)
  return { width, height }
}

/* Keeps the joined page image inside the browser's canvas limits while
   preserving the highest readable resolution that still fits. */
const resolveScale = (sizes) => {
  let scale = MAX_SCALE
  while (scale > MIN_SCALE) {
    const { width, height } = measureLayout(sizes, scale)
    if (width <= MAX_CANVAS_WIDTH && height <= MAX_CANVAS_HEIGHT && width * height <= MAX_CANVAS_AREA) {
      break
    }
    scale = Math.max(MIN_SCALE, scale * 0.9)
  }
  return scale
}

export const convertPdfToImage = async (file) => {
  const arrayBuffer = await file.arrayBuffer()
  const assetBase = resolvePdfAssetBase()
  // pdf.js v6 keeps destroy() on the loading task, not on the document proxy.
  const loadingTask = pdfjsLib.getDocument({
    data: arrayBuffer,
    cMapUrl: `${assetBase}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${assetBase}standard_fonts/`,
    wasmUrl: `${assetBase}wasm/`,
    iccUrl: `${assetBase}iccs/`,
  })
  const pdf = await loadingTask.promise

  try {
    const pageCount = pdf.numPages
    if (pageCount === 0) throw new Error('The PDF has no pages')

    // Measure every page first so the joined canvas can be sized before render.
    const sizes = []
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const viewport = page.getViewport({ scale: 1 })
      sizes.push({ width: viewport.width, height: viewport.height })
      page.cleanup()
    }

    const scale = resolveScale(sizes)
    const layout = measureLayout(sizes, scale)
    const canvas = document.createElement('canvas')
    canvas.width = layout.width
    canvas.height = layout.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not create a canvas to convert the PDF')

    // Pages with transparent backgrounds would otherwise show the previous page
    // through them after compositing.
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)

    let offsetY = 0
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const viewport = page.getViewport({ scale })

      // Each page renders into its own canvas: pdf.js clears the whole target
      // canvas before drawing, so rendering page two directly into the joined
      // canvas would erase page one.
      const pageCanvas = document.createElement('canvas')
      pageCanvas.width = Math.max(1, Math.ceil(viewport.width))
      pageCanvas.height = Math.max(1, Math.ceil(viewport.height))
      const pageContext = pageCanvas.getContext('2d')
      if (!pageContext) throw new Error('Could not create a canvas for a PDF page')

      await page.render({ canvasContext: pageContext, viewport }).promise
      const offsetX = Math.max(0, Math.floor((canvas.width - pageCanvas.width) / 2))
      context.drawImage(pageCanvas, offsetX, offsetY)

      offsetY += pageCanvas.height + PAGE_GAP
      pageCanvas.width = 0
      pageCanvas.height = 0
      page.cleanup()
    }

    const encoded = await encodeCanvas(canvas)
    canvas.width = 0
    canvas.height = 0

    const converted = new File(
      [encoded.blob],
      `${file.name.replace(/\.pdf$/i, '')}.${encoded.extension}`,
      { type: encoded.type }
    )
    // Flagged on the file itself so the preview can badge a genuine PDF
    // conversion — a plain PNG upload keeps its own name and must not claim one.
    converted.convertedFromPdf = true
    converted.pageCount = pageCount
    return converted
  } finally {
    await loadingTask.destroy().catch(() => {})
  }
}
