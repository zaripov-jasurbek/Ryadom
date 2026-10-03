import { formatUzs, type ParticipantTotal } from './calculations.ts'

export function summaryText(title: string, total: number, totals: ParticipantTotal[]) {
  return [title, `Всего: ${formatUzs(total)}`, '', ...totals.map(person => `${person.name}: ${formatUzs(person.due)} · оплачено ${formatUzs(person.paid)} · осталось ${formatUzs(person.remaining)}`)].join('\n')
}

/** Characters that Windows, macOS or Android refuse in file names. */
export const safeFileName = (name: string) => name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'чек'

function download(blob: Blob, fileName: string) {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = fileName
  link.click()
  // Revoking right after click() can cancel the download in Safari and Firefox.
  setTimeout(() => URL.revokeObjectURL(link.href), 30_000)
}

export function downloadText(title: string, text: string) {
  download(new Blob([text], { type: 'text/plain;charset=utf-8' }), `${safeFileName(title)}.txt`)
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) return text
  let end = text.length
  while (end > 1 && ctx.measureText(`${text.slice(0, end)}…`).width > maxWidth) end--
  return `${text.slice(0, end)}…`
}

export function downloadImage(title: string, total: number, totals: ParticipantTotal[]) {
  const width = 1000, height = 340 + totals.length * 78
  const scale = Math.min(3, Math.max(2, window.devicePixelRatio || 1))
  const canvas = document.createElement('canvas')
  canvas.width = width * scale; canvas.height = height * scale
  const ctx = canvas.getContext('2d'); if (!ctx) return
  ctx.scale(scale, scale)
  ctx.fillStyle = '#f6f5f1'; ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#313a2b'; ctx.fillRect(56, 56, 888, height - 112)
  ctx.fillStyle = '#d7ef73'; ctx.font = '700 20px Arial'; ctx.fillText('РЯДОМ  ·  ОБЩИЙ ЧЕК', 96, 112)
  ctx.fillStyle = '#fffefa'; ctx.font = '48px Georgia'; ctx.fillText(fitText(ctx, title, 808), 96, 180)
  ctx.fillStyle = '#bdc5ac'; ctx.font = '18px Arial'; ctx.fillText(`ОБЩИЙ ИТОГ  ${formatUzs(total)}`, 96, 226)
  totals.forEach((person, index) => {
    const y = 292 + index * 78
    ctx.font = '600 21px Arial'
    const due = formatUzs(person.due)
    ctx.fillStyle = '#eef0e5'; ctx.fillText(fitText(ctx, person.name, 790 - ctx.measureText(due).width), 96, y)
    ctx.fillStyle = '#ffffff'; ctx.textAlign = 'right'; ctx.fillText(due, 902, y); ctx.textAlign = 'left'
    ctx.fillStyle = '#bfc7b1'; ctx.font = '15px Arial'; ctx.fillText(`оплачено ${formatUzs(person.paid)} · осталось ${formatUzs(person.remaining)}`, 96, y + 26)
  })
  canvas.toBlob(blob => { if (blob) download(blob, `${safeFileName(title)}.png`) }, 'image/png')
}
