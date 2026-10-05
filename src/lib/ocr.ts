// On-device receipt recognition. Tesseract and its models load only when a scan starts and are served
// by the app itself (see tesseractAssets in vite.config.ts); the photo never leaves the device.

export type OcrProgress = (status: string, progress: number) => void

const stages: Record<string, string> = {
  'loading tesseract core': 'Готовим сканер',
  'initializing tesseract': 'Готовим сканер',
  'loading language traineddata': 'Готовим сканер — в первый раз чуть дольше',
  'initializing api': 'Почти готово',
  'recognizing text': 'Читаем чек',
}

/** Receipt text this wide reads best; narrower crops are scaled up, wider ones down. */
const targetWidth = 1400
/** Keeps long receipts within what phones can draw on one canvas. */
const maxPixels = 6_000_000

type Rect = { x: number; y: number; width: number; height: number }

/** Otsu's threshold: the gray level that best splits the histogram into dark and bright. */
function otsu(histogram: number[], count: number) {
  let sum = 0
  for (let level = 0; level < 256; level++) sum += level * histogram[level]
  let darkSum = 0, darkCount = 0, best = 0, threshold = 128
  for (let level = 0; level < 256; level++) {
    darkCount += histogram[level]
    const brightCount = count - darkCount
    if (!darkCount) continue
    if (!brightCount) break
    darkSum += level * histogram[level]
    const between = darkCount * brightCount * (darkSum / darkCount - (sum - darkSum) / brightCount) ** 2
    if (between > best) { best = between; threshold = level }
  }
  return threshold
}

/** The longest run of indexes whose share is at least half of the largest one. */
function longestRun(shares: number[]) {
  const cut = Math.max(...shares) / 2
  let start = 0, best = { start: 0, end: shares.length }, bestLength = 0
  for (let i = 0; i <= shares.length; i++) {
    if (i < shares.length && shares[i] >= cut) continue
    if (i - start > bestLength) { bestLength = i - start; best = { start, end: i } }
    start = i + 1
  }
  return best
}

/**
 * Finds the receipt in the photo: paper is bright and colourless, so the columns and then the rows that are
 * mostly bright mark it out from the table, hands and shadows around it. Text outside the paper only confuses OCR.
 */
function findPaper(bitmap: ImageBitmap): Rect {
  const scale = 400 / Math.max(bitmap.width, bitmap.height)
  const width = Math.max(1, Math.round(bitmap.width * scale)), height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width; canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const whole = { x: 0, y: 0, width: bitmap.width, height: bitmap.height }
  if (!ctx) return whole
  ctx.drawImage(bitmap, 0, 0, width, height)
  const px = ctx.getImageData(0, 0, width, height).data
  const gray = new Uint8Array(width * height), histogram = new Array<number>(256).fill(0)
  for (let i = 0; i < gray.length; i++) {
    const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2]
    const level = Math.max(0, Math.round(r * .299 + g * .587 + b * .114 - (Math.max(r, g, b) - Math.min(r, g, b))))
    gray[i] = level; histogram[level]++
  }
  const threshold = otsu(histogram, gray.length)
  const columns = longestRun(Array.from({ length: width }, (_, x) => {
    let bright = 0
    for (let y = 0; y < height; y++) if (gray[y * width + x] > threshold) bright++
    return bright / height
  }))
  const rows = longestRun(Array.from({ length: height }, (_, y) => {
    let bright = 0
    for (let x = columns.start; x < columns.end; x++) if (gray[y * width + x] > threshold) bright++
    return bright / (columns.end - columns.start)
  }))
  const pad = 4
  const x0 = Math.max(0, columns.start - pad), x1 = Math.min(width, columns.end + pad)
  const y0 = Math.max(0, rows.start - pad), y1 = Math.min(height, rows.end + pad)
  // A sliver is a misread (a white plate, a glare); then the whole photo is safer.
  if ((x1 - x0) < width * .2 || (y1 - y0) < height * .2) return whole
  return { x: x0 / scale, y: y0 / scale, width: (x1 - x0) / scale, height: (y1 - y0) / scale }
}

/** Crops the photo to the receipt, sizes the text for Tesseract and stretches contrast, which helps with faded thermal paper. */
async function prepare(file: Blob) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const paper = findPaper(bitmap)
  const scale = Math.min(3, targetWidth / paper.width, Math.sqrt(maxPixels / (paper.width * paper.height)))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(paper.width * scale); canvas.height = Math.round(paper.height * scale)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas is unavailable')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, paper.x, paper.y, paper.width, paper.height, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height), px = image.data
  const histogram = new Array<number>(256).fill(0)
  for (let i = 0; i < px.length; i += 4) {
    const gray = Math.round(px[i] * .299 + px[i + 1] * .587 + px[i + 2] * .114)
    px[i] = gray; histogram[gray]++
  }
  // Percentiles rather than the extremes, so one glare or one black speck does not cancel the stretch.
  const count = px.length / 4
  let min = 0, max = 255, seen = 0
  for (let level = 0; level < 256; level++) { seen += histogram[level]; if (seen >= count * .01) { min = level; break } }
  seen = 0
  for (let level = 255; level >= 0; level--) { seen += histogram[level]; if (seen >= count * .01) { max = level; break } }
  const range = Math.max(1, max - min)
  for (let i = 0; i < px.length; i += 4) px[i] = px[i + 1] = px[i + 2] = Math.max(0, Math.min(255, Math.round((px[i] - min) * 255 / range)))
  ctx.putImageData(image, 0, 0)
  return canvas
}

type OcrLine = { confidence: number; words: { text: string; confidence: number }[] }

/**
 * Rebuilds the text from what Tesseract is sure of. Dot leaders, stamps and the table under the receipt come out
 * as words it scores near zero, and they would otherwise turn into dishes with made-up names.
 */
export function confidentText(lines: OcrLine[]) {
  return lines
    .filter(line => line.confidence >= 40)
    .map(line => line.words.filter(word => word.confidence >= 20).map(word => word.text).join(' '))
    .join('\n')
}

/** Returns the receipt's text; aborting stops the worker. */
export async function recognizeReceipt(file: Blob, onProgress: OcrProgress, signal: AbortSignal): Promise<string> {
  onProgress('Подготавливаем фото', 0)
  const [{ createWorker, OEM, PSM }, image] = await Promise.all([import('tesseract.js'), prepare(file)])
  signal.throwIfAborted()
  const root = new URL(`${import.meta.env.BASE_URL}tesseract/`, location.href).href
  const worker = await createWorker(['rus', 'uzb'], OEM.LSTM_ONLY, {
    workerPath: `${root}worker.min.js`,
    corePath: `${root}core`,
    langPath: `${root}lang`,
    logger: message => onProgress(stages[message.status] ?? 'Читаем чек', message.progress),
  })
  const stop = () => void worker.terminate()
  signal.addEventListener('abort', stop)
  try {
    signal.throwIfAborted()
    // Receipts are one column of lines.
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_COLUMN })
    const { data } = await worker.recognize(image, {}, { blocks: true })
    return confidentText((data.blocks ?? []).flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines)))
  } finally {
    signal.removeEventListener('abort', stop)
    await worker.terminate().catch(() => {})
  }
}
