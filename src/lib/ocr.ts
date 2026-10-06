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
    // The gray level goes into the red channel, read again below.
    const i = (y * width + x) * 4, cell = Math.floor(y / step) * w + Math.floor(x / step)
    px[i] = px[i] * .299 + px[i + 1] * .587 + px[i + 2] * .114
    small[cell] += px[i]; counts[cell]++
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
      px[i] = px[i + 1] = px[i + 2] = px[i] / Math.max(1, mean) * 235
    }
  }
}

/** Draws a normalized OCR canvas. */
function drawVariant(bitmap: ImageBitmap, paper: Rect, mode: 'normal' | 'gray' | 'threshold' | 'thresholdStrong') {
  const scale = Math.min(3, targetWidth / paper.width, Math.sqrt(maxPixels / (paper.width * paper.height)))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(paper.width * scale))
  canvas.height = Math.max(1, Math.round(paper.height * scale))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas is unavailable')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, paper.x, paper.y, paper.width, paper.height, 0, 0, canvas.width, canvas.height)
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  if (mode !== 'normal') evenLight(image.data, canvas.width, canvas.height)
  if (mode === 'gray') {
    for (let i = 0; i < image.data.length; i += 4) {
      const value = image.data[i]
      image.data[i] = image.data[i + 1] = image.data[i + 2] = value
    }
  } else if (mode === 'threshold' || mode === 'thresholdStrong') {
    const cut = mode === 'threshold' ? 165 : 200
    for (let i = 0; i < image.data.length; i += 4) {
      const value = image.data[i] < cut ? 0 : 255
      image.data[i] = image.data[i + 1] = image.data[i + 2] = value
    }
  }
  ctx.putImageData(image, 0, 0)
  return canvas
}

/**
 * Estimates a small camera tilt from horizontal text/table lines and rotates the receipt before OCR.
 * This is intentionally limited to a few degrees: large perspective distortion is better left to a future
 * corner-based rectifier, while small tilt is common in handheld photos and costs very little to fix.
 */
function deskew(canvas: HTMLCanvasElement) {
  const sampleWidth = Math.min(300, canvas.width)
  const sampleHeight = Math.max(1, Math.round(canvas.height * sampleWidth / canvas.width))
  const sample = document.createElement('canvas')
  sample.width = sampleWidth; sample.height = sampleHeight
  const ctx = sample.getContext('2d', { willReadFrequently: true })
  if (!ctx) return canvas
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, sampleWidth, sampleHeight)
  ctx.drawImage(canvas, 0, 0, sampleWidth, sampleHeight)
  const pixels = ctx.getImageData(0, 0, sampleWidth, sampleHeight).data
  const score = (angle: number) => {
    const radians = angle * Math.PI / 180
    const cos = Math.cos(radians), sin = Math.sin(radians)
    const cx = (sampleWidth - 1) / 2, cy = (sampleHeight - 1) / 2
    const rows = new Float32Array(sampleHeight)
    for (let y = 0; y < sampleHeight; y += 2) for (let x = 0; x < sampleWidth; x += 2) {
      const sx = Math.round((x - cx) * cos + (y - cy) * sin + cx)
      const sy = Math.round(-(x - cx) * sin + (y - cy) * cos + cy)
      if (sx < 0 || sx >= sampleWidth || sy < 0 || sy >= sampleHeight) continue
      const i = (sy * sampleWidth + sx) * 4
      const gray = pixels[i] * .299 + pixels[i + 1] * .587 + pixels[i + 2] * .114
      rows[y] += Math.max(0, 220 - gray)
    }
    const mean = rows.reduce((a, b) => a + b, 0) / rows.length
    return rows.reduce((sum, value) => sum + (value - mean) ** 2, 0) / rows.length
  }
  let bestAngle = 0, bestScore = score(0)
  for (let angle = -7; angle <= 7; angle += 1) {
    const value = score(angle)
    if (value > bestScore) { bestScore = value; bestAngle = angle }
  }
  if (Math.abs(bestAngle) < 1) return canvas

  const radians = bestAngle * Math.PI / 180
  const sin = Math.abs(Math.sin(radians)), cos = Math.abs(Math.cos(radians))
  const width = Math.ceil(canvas.width * cos + canvas.height * sin)
  const height = Math.ceil(canvas.width * sin + canvas.height * cos)
  const rotated = document.createElement('canvas')
  rotated.width = width; rotated.height = height
  const out = rotated.getContext('2d')
  if (!out) return canvas
  out.fillStyle = '#fff'; out.fillRect(0, 0, width, height)
  out.translate(width / 2, height / 2)
  out.rotate(radians)
  out.drawImage(canvas, -canvas.width / 2, -canvas.height / 2)
  return rotated
}

/**
 * Deliberately different views of the same photo, drawn one at a time: most receipts read on the first, and each
 * canvas takes tens of megabytes. A full-photo view is kept as a fallback because paper detection is heuristic and
 * can accidentally crop a white table, a pale receipt, or a receipt with a shadow.
 */
const views = [
  { draw: (bitmap: ImageBitmap, paper: Rect) => deskew(drawVariant(bitmap, paper, 'normal')), column: true },
  { draw: (bitmap: ImageBitmap, paper: Rect) => deskew(drawVariant(bitmap, paper, 'gray')), column: true },
  { draw: (bitmap: ImageBitmap, paper: Rect) => deskew(drawVariant(bitmap, paper, 'threshold')), column: false },
  { draw: (bitmap: ImageBitmap, paper: Rect) => deskew(drawVariant(bitmap, paper, 'thresholdStrong')), column: false },
  { draw: (bitmap: ImageBitmap) => drawVariant(bitmap, { x: 0, y: 0, width: bitmap.width, height: bitmap.height }, 'normal'), column: true },
]
/** Every view is read as one block; most also as a column of lines. */
const passCount = views.reduce((sum, view) => sum + (view.column ? 2 : 1), 0)

// The worker stays loaded while the scanner is open, so a retake skips loading the engine and its models.
// Its logger reports to whichever scan is running.
let engine: Promise<import('tesseract.js').Worker> | null = null
let report: (status: string, progress: number) => void = () => {}

function startEngine() {
  if (engine) return engine
  const root = new URL(`${import.meta.env.BASE_URL}tesseract/`, location.href).href
  const started = engine = import('tesseract.js').then(({ createWorker, OEM }) => createWorker(['rus', 'uzb'], OEM.LSTM_ONLY, {
    workerPath: `${root}worker.min.js`,
    corePath: `${root}core`,
    langPath: `${root}lang`,
    logger: message => report(message.status, message.progress),
  }))
  // A failed start, such as no network for the models, is retried by the next scan.
  started.catch(() => { if (engine === started) engine = null })
  return started
}

/** Unloads the engine; also stops a reading in progress. */
export function stopReceiptEngine() {
  const current = engine
  engine = null
  void current?.then(worker => worker.terminate()).catch(() => {})
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
 * Reads the receipt as one block of text, which keeps price columns on their rows; then as a column of lines of
 * varying size, which catches large bold totals; then the other views, until `enough` accepts the readings so far.
 * Returns every reading; aborting stops the engine.
 */
export async function recognizeReceipt(file: Blob, onProgress: OcrProgress, signal: AbortSignal, enough: (readings: string[]) => boolean): Promise<string[]> {
  onProgress('Подготавливаем фото', 0)
  // Rereads show their own count, so a bar that fills again does not look like the scan started over.
  let pass = 0
  const mine = report = (status, progress) => {
    if (status !== 'recognizing text') onProgress(stages[status] ?? 'Читаем чек', progress)
    else if (!pass) onProgress('Читаем чек', progress)
    else onProgress(`Перечитываем чек (${pass}/${passCount - 1})`, (pass - 1 + progress) / (passCount - 1))
  }
  // A terminated worker never settles its pending job, so the scan stops on this instead and cleans up after itself.
  const aborted = new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
  aborted.catch(() => {})
  const stop = () => stopReceiptEngine()
  signal.addEventListener('abort', stop)
  const decoding = createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const [{ PSM }, worker] = await Promise.race([Promise.all([import('tesseract.js'), startEngine()]), aborted])
    const bitmap = await decoding
    signal.throwIfAborted()
    const paper = findPaper(bitmap)
    const readings: string[] = []
    for (const view of views) {
      const image = view.draw(bitmap, paper)
      for (const mode of view.column ? [PSM.SINGLE_BLOCK, PSM.SINGLE_COLUMN] : [PSM.SINGLE_BLOCK]) {
        signal.throwIfAborted()
        await Promise.race([worker.setParameters({ tessedit_pageseg_mode: mode }), aborted])
        const { data } = await Promise.race([worker.recognize(image, {}, { blocks: true }), aborted])
        const text = confidentText((data.blocks ?? []).flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines)))
        if (text) readings.push(text)
        if (text && enough(readings)) return readings
        pass++
      }
    }
    return readings
  } finally {
    void decoding.then(bitmap => bitmap.close(), () => {})
    signal.removeEventListener('abort', stop)
    // A scan started after this one was aborted reports on its own.
    if (report === mine) report = () => {}
  }
}
