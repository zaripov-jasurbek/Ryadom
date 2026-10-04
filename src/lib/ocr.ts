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

/** Scales the photo down for speed and boosts contrast, which helps with faded thermal paper. */
async function prepare(file: Blob) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas is unavailable')
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height), px = image.data
  let min = 255, max = 0
  for (let i = 0; i < px.length; i += 4) {
    const gray = Math.round(px[i] * .299 + px[i + 1] * .587 + px[i + 2] * .114)
    px[i] = gray
    if (gray < min) min = gray
    if (gray > max) max = gray
  }
  const range = Math.max(1, max - min)
  for (let i = 0; i < px.length; i += 4) px[i] = px[i + 1] = px[i + 2] = Math.round((px[i] - min) * 255 / range)
  ctx.putImageData(image, 0, 0)
  return canvas
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
    // Receipts are one column of lines; keeping runs of spaces separates names from price columns.
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_COLUMN, preserve_interword_spaces: '1' })
    const { data } = await worker.recognize(image)
    return data.text
  } finally {
    signal.removeEventListener('abort', stop)
    await worker.terminate().catch(() => {})
  }
}
