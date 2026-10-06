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

/** Draws a normalized OCR canvas, `stretch` times wider than tall for narrow fonts (see `glyphShape`). */
function drawVariant(bitmap: ImageBitmap, paper: Rect, mode: 'normal' | 'gray' | 'threshold' | 'thresholdStrong', stretch = 1) {
  const scale = Math.min(3, targetWidth / paper.width, Math.sqrt(maxPixels / (paper.width * paper.height * stretch)))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(paper.width * scale * stretch))
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

/** Gray levels darker than this count as ink when measuring the layout. */
const inkLevel = 180

/**
 * A quarter-size copy of the canvas as ink amounts, for measuring the layout; `scale` maps its pixels back.
 * The height of letters is the typical height of vertical runs of ink.
 */
function inkMap(canvas: HTMLCanvasElement) {
  const width = Math.min(700, canvas.width), scale = canvas.width / width
  const height = Math.max(1, Math.round(canvas.height / scale))
  const sample = document.createElement('canvas')
  sample.width = width; sample.height = height
  const ctx = sample.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height)
  ctx.drawImage(canvas, 0, 0, width, height)
  const px = ctx.getImageData(0, 0, width, height).data
  const ink = new Float32Array(width * height)
  for (let i = 0; i < ink.length; i++) ink[i] = Math.max(0, inkLevel - (px[i * 4] * .299 + px[i * 4 + 1] * .587 + px[i * 4 + 2] * .114))
  const runs: number[] = []
  for (let x = 0; x < width; x += 3) {
    let run = 0
    for (let y = 0; y <= height; y++) {
      if (y < height && ink[y * width + x] > 40) run++
      else { if (run >= 2) runs.push(run); run = 0 }
    }
  }
  runs.sort((a, b) => a - b)
  const letter = Math.max(4, runs[Math.floor(runs.length * .75)] ?? 10)
  return { ink, width, height, scale, letter }
}

/** How the text lines bend down the canvas: every `step` rows, the slope at the middle and how fast it changes across. */
type Bend = { step: number; slope: Float32Array; curve: Float32Array }

/**
 * Measures how the lines of a curled or tilted receipt run. In tiles a third of the width and a few lines tall, the slope whose
 * row profile is sharpest is the local direction of the text; a slope that changes linearly across the width is then fitted
 * to the tiles around every row, which follows both a tilt that differs along the receipt and paper bent across it.
 */
function bendOf(canvas: HTMLCanvasElement): Bend | null {
  const map = inkMap(canvas)
  if (!map) return null
  const { ink, width, height, scale, letter } = map
  const tileWidth = Math.round(width / 3), tileHeight = Math.round(letter * 4)
  const sharpness = (x0: number, y0: number, slope: number) => {
    const rows = new Float32Array(tileHeight), middle = x0 + tileWidth / 2
    for (let y = 0; y < tileHeight; y++) for (let x = x0; x < x0 + tileWidth; x += 2) {
      const from = Math.round(y0 + y + (x - middle) * slope)
      if (from >= 0 && from < height) rows[y] += ink[from * width + x]
    }
    let sum = 0, squares = 0
    for (const value of rows) { sum += value; squares += value * value }
    return squares / tileHeight - (sum / tileHeight) ** 2
  }
  const tiles: { x: number; y: number; slope: number; weight: number }[] = []
  for (let y0 = 0; y0 + tileHeight <= height; y0 += Math.round(letter * 1.5)) {
    for (let x0 = 0; x0 + tileWidth <= width; x0 += Math.round(tileWidth / 2)) {
      let total = 0
      for (let y = y0; y < y0 + tileHeight; y++) for (let x = x0; x < x0 + tileWidth; x += 2) total += ink[y * width + x]
      // Blank paper and margins say nothing about the lines.
      if (total < tileWidth * tileHeight * 4) continue
      let best = 0, bestScore = -1
      const tryAngle = (degrees: number) => {
        const score = sharpness(x0, y0, Math.tan(degrees * Math.PI / 180))
        if (score > bestScore) { bestScore = score; best = degrees }
      }
      for (let degrees = -8; degrees <= 8; degrees++) tryAngle(degrees)
      for (let degrees = best - .8; degrees <= best + .8; degrees += .2) tryAngle(degrees)
      if (bestScore > 0) tiles.push({ x: (x0 + tileWidth / 2) * scale, y: (y0 + tileHeight / 2) * scale, slope: Math.tan(best * Math.PI / 180), weight: Math.sqrt(bestScore) })
    }
  }
  if (tiles.length < 5) return null
  const middle = canvas.width / 2, reach = letter * scale * 4, step = Math.max(4, Math.round(letter * scale / 2))
  const rows = Math.ceil(canvas.height / step) + 1
  const slope = new Float32Array(rows), curve = new Float32Array(rows)
  // A bend of more than a few lines over the width is a misreading of something else, such as a table edge.
  const maxCurve = .3 / canvas.width
  for (let row = 0; row < rows; row++) {
    const near = tiles.map(tile => tile.weight * Math.exp(-(((tile.y - row * step) / reach) ** 2) / 2))
    let a = 0, b = 0
    // Least squares of slope = a + b·(x − middle); later rounds weigh down the tiles far off the fit, such as a logo.
    for (let round = 0; round < 3; round++) {
      let s0 = 0, s1 = 0, s2 = 0, t0 = 0, t1 = 0
      tiles.forEach((tile, i) => {
        const dx = tile.x - middle, off = tile.slope - a - b * dx
        const weight = near[i] / (round ? 1 + (off / .02) ** 2 : 1)
        s0 += weight; s1 += weight * dx; s2 += weight * dx * dx; t0 += weight * tile.slope; t1 += weight * tile.slope * dx
      })
      if (s0 < 1e-6) break
      const det = s0 * s2 - s1 * s1
      if (det <= 1e-9 * s0 * s2) { a = t0 / s0; b = 0 } else { a = (t0 * s2 - t1 * s1) / det; b = (s0 * t1 - s1 * t0) / det }
    }
    slope[row] = a; curve[row] = Math.max(-maxCurve, Math.min(maxCurve, b))
  }
  return { step, slope, curve }
}

/** Redraws the canvas with its text lines straight: each row is read along the line through it. */
function unbend(canvas: HTMLCanvasElement, bend: Bend) {
  const { width, height } = canvas
  const source = canvas.getContext('2d', { willReadFrequently: true })?.getImageData(0, 0, width, height).data
  const out = document.createElement('canvas')
  out.width = width; out.height = height
  const ctx = out.getContext('2d')
  if (!source || !ctx) return canvas
  const image = ctx.createImageData(width, height), px = image.data, middle = width / 2
  for (let y = 0; y < height; y++) {
    const at = Math.min(bend.slope.length - 2, Math.floor(y / bend.step)), f = y / bend.step - at
    const slope = bend.slope[at] * (1 - f) + bend.slope[at + 1] * f, curve = bend.curve[at] * (1 - f) + bend.curve[at + 1] * f
    for (let x = 0; x < width; x++) {
      const dx = x - middle, from = y + slope * dx + curve * dx * dx / 2
      const top = Math.floor(from), part = from - top, i = (y * width + x) * 4
      px[i + 3] = 255
      if (top < 0 || top + 1 >= height) { px[i] = px[i + 1] = px[i + 2] = 255; continue }
      const above = (top * width + x) * 4, below = above + width * 4
      for (let c = 0; c < 3; c++) px[i + c] = source[above + c] * (1 - part) + source[below + c] * part
    }
  }
  ctx.putImageData(image, 0, 0)
  return out
}

type Mode = 'normal' | 'gray' | 'threshold' | 'thresholdStrong'
/** One photo being read; the bend is measured the first time a view needs it. */
type Scan = { bitmap: ImageBitmap; paper: Rect; stretch: number; bend?: Bend | null }

function straight(scan: Scan, mode: Mode) {
  const canvas = drawVariant(scan.bitmap, scan.paper, mode, scan.stretch)
  // The evenly lit view shows the lines best; every view of one photo bends the same way.
  if (scan.bend === undefined) scan.bend = bendOf(mode === 'gray' ? canvas : drawVariant(scan.bitmap, scan.paper, 'gray', scan.stretch))
  return scan.bend ? unbend(canvas, scan.bend) : deskew(canvas)
}

/**
 * Deliberately different views of the same photo, read one at a time until the readings settle: most receipts read on
 * the first. Each canvas takes tens of megabytes, so a view is drawn again rather than kept. Straightened views help
 * curled paper and come early; a column of lines catches large bold totals. A full-photo view is kept as a fallback
 * because paper detection is heuristic and can accidentally crop a white table, a pale receipt, or a receipt with a shadow.
 */
const passes: { view: string; draw: (scan: Scan) => HTMLCanvasElement; column?: boolean }[] = [
  { view: 'normal', draw: scan => deskew(drawVariant(scan.bitmap, scan.paper, 'normal', scan.stretch)) },
  { view: 'gray', draw: scan => deskew(drawVariant(scan.bitmap, scan.paper, 'gray', scan.stretch)) },
  { view: 'gray straight', draw: scan => straight(scan, 'gray') },
  { view: 'normal', draw: scan => deskew(drawVariant(scan.bitmap, scan.paper, 'normal', scan.stretch)), column: true },
  { view: 'gray', draw: scan => deskew(drawVariant(scan.bitmap, scan.paper, 'gray', scan.stretch)), column: true },
  { view: 'threshold straight', draw: scan => straight(scan, 'threshold') },
  { view: 'thresholdStrong', draw: scan => deskew(drawVariant(scan.bitmap, scan.paper, 'thresholdStrong', scan.stretch)) },
  { view: 'photo', draw: scan => drawVariant(scan.bitmap, { x: 0, y: 0, width: scan.bitmap.width, height: scan.bitmap.height }, 'normal', scan.stretch) },
]

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
type Box = { x0: number; x1: number; y0: number; y1: number }
type OcrLine = { confidence: number; words: { text: string; confidence: number; bbox: Box }[] }

/**
 * How much wider the photo should be drawn for Tesseract to read its font: about 1 for most receipts, up to 2 for the tall,
 * narrow fonts of some kitchen printers, which Tesseract misreads ("9 000" as "3000", "70" as "10") until they are stretched
 * to usual proportions. Measured on the words it is sure of: their width per character against their height.
 */
function glyphShape(lines: OcrLine[]) {
  const shapes = lines.flatMap(line => line.words)
    .filter(word => word.confidence >= 75 && word.text.length >= 3)
    .map(word => (word.bbox.x1 - word.bbox.x0) / word.text.length / Math.max(1, word.bbox.y1 - word.bbox.y0))
    .sort((a, b) => a - b)
  const shape = shapes.length >= 5 ? shapes[Math.floor(shapes.length / 2)] : null
  return shape !== null && shape < .42 ? Math.min(2, .55 / shape) : 1
}

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
 * Reads the receipt in the passes above until `enough` accepts the readings so far. The first reading also measures the
 * font: a narrow one is read again from the first pass, stretched. Returns every reading; aborting stops the engine.
 */
export async function recognizeReceipt(file: Blob, onProgress: OcrProgress, signal: AbortSignal, enough: (readings: string[]) => boolean): Promise<string[]> {
  onProgress('Подготавливаем фото', 0)
  // Rereads show their own count, so a bar that fills again does not look like the scan started over.
  let pass = 0, rereads = passes.length - 1
  const mine = report = (status, progress) => {
    if (status !== 'recognizing text') onProgress(stages[status] ?? 'Читаем чек', progress)
    else if (!pass) onProgress('Читаем чек', progress)
    else onProgress(`Перечитываем чек (${pass}/${rereads})`, (pass - 1 + progress) / rereads)
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
    let scan: Scan = { bitmap, paper: findPaper(bitmap), stretch: 1 }
    const readings: string[] = []
    let measured = false
    for (let index = 0; index < passes.length; index++) {
      signal.throwIfAborted()
      const { draw, column } = passes[index]
      const image = draw(scan)
      signal.throwIfAborted()
      await Promise.race([worker.setParameters({ tessedit_pageseg_mode: column ? PSM.SINGLE_COLUMN : PSM.SINGLE_BLOCK }), aborted])
      const { data } = await Promise.race([worker.recognize(image, {}, { blocks: true }), aborted])
      const lines = (data.blocks ?? []).flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines))
      const text = confidentText(lines)
      if (text) readings.push(text)
      if (text && enough(readings)) return readings
      pass++
      if (!measured) {
        measured = true
        const stretch = glyphShape(lines)
        // Drawn wider, the photo is measured afresh.
        if (stretch > 1) { scan = { ...scan, stretch, bend: undefined }; index = -1; rereads++ }
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
