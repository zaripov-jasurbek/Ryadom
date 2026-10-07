import { formatUzs, personItems, type Bill, type ParticipantTotal } from './calculations.ts'
import { shareOr } from './share.ts'

/** The creator paid the restaurant, so their line says so instead of what is left to pay. */
const paymentLine = (person: ParticipantTotal, ownerId?: string) =>
  person.id === ownerId ? 'платил по счёту'
    : person.overpaid ? `оплачено ${formatUzs(person.paid + person.overpaid)} · переплатил ${formatUzs(person.overpaid)}`
    : `оплачено ${formatUzs(person.paid)} · осталось ${formatUzs(person.remaining)}`

/** What each person's amount is made of: their dishes, shares and service, as lines under their name. */
function detailLines(bill: Bill, person: ParticipantTotal) {
  const lines = personItems(bill, person.id).map(line => `${line.name}${line.sharedAll ? ' (на всех)' : `${line.units > 1 ? ` × ${line.units}` : ''}${line.shared ? ' (доля)' : ''}`} — ${formatUzs(line.amount)}`)
  if (person.service) lines.push(`Обслуживание ${bill.servicePercent}% — ${formatUzs(person.service)}`)
  return lines
}

/** The whole check for a chat or a file: who owes what, and what each amount is made of. */
export function summaryText(bill: Bill, total: number, totals: ParticipantTotal[], ownerId?: string) {
  const head = [bill.title, `Всего: ${formatUzs(total)}${bill.servicePercent ? ` · обслуживание ${bill.servicePercent}%` : ''}`]
  const people = totals.map(person => [`${person.name}: ${formatUzs(person.due)} · ${paymentLine(person, ownerId)}`, ...detailLines(bill, person).map(line => `  • ${line}`)].join('\n'))
  return [...head, '', people.join('\n\n')].join('\n')
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

/**
 * The PNG is built synchronously: Safari opens the share sheet only right after the tap,
 * and waiting for canvas.toBlob() can use that moment up.
 */
function pngBlob(canvas: HTMLCanvasElement) {
  const bytes = atob(canvas.toDataURL('image/png').split(',')[1])
  const buffer = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) buffer[i] = bytes.charCodeAt(i)
  return new Blob([buffer], { type: 'image/png' })
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) return text
  let end = text.length
  while (end > 1 && ctx.measureText(`${text.slice(0, end)}…`).width > maxWidth) end--
  return `${text.slice(0, end)}…`
}

/** On a phone the picture goes to the share sheet ("Сохранить изображение", a chat); on a computer it downloads. */
export function saveImage(bill: Bill, total: number, totals: ParticipantTotal[], ownerId?: string) {
  const title = bill.title
  const details = totals.map(person => detailLines(bill, person))
  const width = 1000, height = 340 + totals.length * 78 + details.reduce((sum, lines) => sum + lines.length * 26 + (lines.length ? 8 : 0), 0)
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
  let y = 292
  totals.forEach((person, index) => {
    ctx.font = '600 21px Arial'
    const due = formatUzs(person.due)
    ctx.fillStyle = '#eef0e5'; ctx.fillText(fitText(ctx, person.name, 790 - ctx.measureText(due).width), 96, y)
    ctx.fillStyle = '#ffffff'; ctx.textAlign = 'right'; ctx.fillText(due, 902, y); ctx.textAlign = 'left'
    ctx.fillStyle = '#bfc7b1'; ctx.font = '15px Arial'; ctx.fillText(paymentLine(person, ownerId), 96, y + 26)
    ctx.fillStyle = '#d9decd'; ctx.font = '16px Arial'
    details[index].forEach((line, row) => ctx.fillText(fitText(ctx, `• ${line}`, 782), 120, y + 60 + row * 26))
    y += 78 + details[index].length * 26 + (details[index].length ? 8 : 0)
  })
  const blob = pngBlob(canvas), name = `${safeFileName(title)}.png`
  void shareOr({ title, files: [new File([blob], name, { type: 'image/png' })] }, () => download(blob, name))
}
