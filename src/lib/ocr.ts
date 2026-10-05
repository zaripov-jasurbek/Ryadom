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
 * Rows take a lower threshold, so the end of a receipt in the shadow of a hand still counts as paper.
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
    for (let x = columns.start; x < columns.end; x++) if (gray[y * width + x] > threshold * .4) bright++
    return bright / (columns.end - columns.start)
  }))
  // A margin for a tilted receipt, whose corners stick out of the bright run.
  const padX = Math.ceil(width * .015), padY = Math.ceil(height * .015)
  const x0 = Math.max(0, columns.start - padX), x1 = Math.min(width, columns.end + padX)
  const y0 = Math.max(0, rows.start - padY), y1 = Math.min(height, rows.end + padY)
  // A sliver is a misread (a white plate, a glare); then the whole photo is safer.
  if ((x1 - x0) < width * .2 || (y1 - y0) < height * .2) return whole
  return { x: x0 / scale, y: y0 / scale, width: (x1 - x0) / scale, height: (y1 - y0) / scale }
}

/**
 * Divides every pixel by the mean brightness around it, so text in a shadow or under uneven light gets the same
 * contrast as the rest; Tesseract binarizes the page with one threshold and would lose it otherwise.
 * The mean is taken on a quarter-size copy: background light changes slowly, and phones have little memory.
 */
function evenLight(px: Uint8ClampedArray, width: number, height: number) {
  const step = 4, w = Math.ceil(width / step), h = Math.ceil(height / step)
  const small = new Float32Array(w * h), counts = new Uint16Array(w * h)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4, cell = Math.floor(y / step) * w + Math.floor(x / step)
    small[cell] += px[i] * .299 + px[i + 1] * .587 + px[i + 2] * .114; counts[cell]++
  }
  // Summed-area table of the quarter-size image, for constant-time box means.
  const sums = new Float64Array((w + 1) * (h + 1))
  for (let y = 0; y < h; y++) {
    let row = 0
    for (let x = 0; x < w; x++) { row += small[y * w + x] / counts[y * w + x]; sums[(y + 1) * (w + 1) + x + 1] = sums[y * (w + 1) + x + 1] + row }
  }
  const radius = Math.max(2, Math.round(w / 25))
  for (let y = 0; y < height; y++) {
    const cy = Math.floor(y / step), y0 = Math.max(0, cy - radius), y1 = Math.min(h, cy + radius + 1)
    for (let x = 0; x < width; x++) {
      const cx = Math.floor(x / step), x0 = Math.max(0, cx - radius), x1 = Math.min(w, cx + radius + 1)
      const mean = (sums[y1 * (w + 1) + x1] - sums[y0 * (w + 1) + x1] - sums[y1 * (w + 1) + x0] + sums[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0))
      const i = (y * width + x) * 4
      px[i] = px[i + 1] = px[i + 2] = Math.min(255, (px[i] * .299 + px[i + 1] * .587 + px[i + 2] * .114) / Math.max(1, mean) * 235)
    }
  }
}

/** Crops the photo to the receipt, sizes the text for Tesseract and evens out the light. */
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
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  evenLight(image.data, canvas.width, canvas.height)
  ctx.putImageData(image, 0, 0)
  return canvas
}

type Box = { x0: number; x1: number }
type OcrLine = { confidence: number; words: { text: string; confidence: number; bbox: Box }[] }

/**
 * Rebuilds the text from what Tesseract is sure of. Dot leaders, stamps and the table under the receipt come out
 * as words it scores near zero, and they would otherwise turn into dishes with made-up names.
 * A gap wider than about two characters becomes a tab: it separates columns, so "2   120 000" is not read as 2 120 000.
 */
export function confidentText(lines: OcrLine[]) {
  return lines
    .filter(line => line.confidence >= 40)
    .map(line => {
      const words = line.words.filter(word => word.confidence >= 20)
      const chars = words.reduce((sum, word) => sum + word.text.length, 0)
      const charWidth = words.reduce((sum, word) => sum + word.bbox.x1 - word.bbox.x0, 0) / Math.max(1, chars)
      return words.map((word, i) => (i === 0 ? '' : word.bbox.x0 - words[i - 1].bbox.x1 > charWidth * 1.6 ? '\t' : ' ') + word.text).join('')
    })
    .join('\n')
}

/**
 * Reads the receipt as one block of text, which keeps price columns on their rows. When `complete` rejects that
 * reading, reads it again as a column of lines of varying size, which catches large bold totals.
 * Returns every reading; aborting stops the worker.
 */
export async function recognizeReceipt(file: Blob, onProgress: OcrProgress, signal: AbortSignal, complete: (text: string) => boolean): Promise<string[]> {
  onProgress('Подготавливаем фото', 0)
  const [{ createWorker, OEM, PSM }, image] = await Promise.all([import('tesseract.js'), prepare(file)])
  signal.throwIfAborted()
  const root = new URL(`${import.meta.env.BASE_URL}tesseract/`, location.href).href
  let again = false
  const worker = await createWorker(['rus', 'uzb'], OEM.LSTM_ONLY, {
    workerPath: `${root}worker.min.js`,
    corePath: `${root}core`,
    langPath: `${root}lang`,
    logger: message => onProgress(again ? 'Перечитываем чек' : stages[message.status] ?? 'Читаем чек', message.progress),
  })
  const stop = () => void worker.terminate()
  signal.addEventListener('abort', stop)
  try {
    const readings: string[] = []
    for (const mode of [PSM.SINGLE_BLOCK, PSM.SINGLE_COLUMN]) {
      signal.throwIfAborted()
      await worker.setParameters({ tessedit_pageseg_mode: mode })
      const { data } = await worker.recognize(image, {}, { blocks: true })
      readings.push(confidentText((data.blocks ?? []).flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines))))
      if (complete(readings.at(-1)!)) break
      again = true
    }
    return readings
  } finally {
    signal.removeEventListener('abort', stop)
    await worker.terminate().catch(() => {})
  }
}
