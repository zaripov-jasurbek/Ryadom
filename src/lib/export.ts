import { formatUzs, personItems, serviceFee, type Bill, type ParticipantTotal } from './calculations.ts'
import { shareOr } from './share.ts'

/** The creator paid the restaurant, so their line says so instead of what is left to pay. */
export const paymentLine = (person: ParticipantTotal, ownerId?: string) =>
  person.id === ownerId ? 'платил по счёту'
    : person.overpaid ? `оплачено ${formatUzs(person.due + person.overpaid)} · переплатил ${formatUzs(person.overpaid)}`
    : person.mark === 'confirmed' ? 'оплачено ✓✓'
    : person.mark === 'marked' ? 'отметил оплату ✓'
    : 'не оплачено'

/** What each person's amount is made of: their dishes, shares and service, each with its amount. */
export function detailItems(bill: Bill, person: ParticipantTotal) {
  const items = personItems(bill, person.id).map(line => ({ label: `${line.name}${line.sharedAll ? ' (на всех)' : `${line.units > 1 ? ` × ${line.units}` : ''}${line.shared ? ' (доля)' : ''}`}`, amount: line.amount }))
  if (person.service) items.push({ label: `Обслуживание ${bill.servicePercent}%`, amount: person.service })
  return items
}

/** The same as lines of text: "Плов × 2 — 90 000 сум". */
export const detailLines = (bill: Bill, person: ParticipantTotal) => detailItems(bill, person).map(line => `${line.label} — ${formatUzs(line.amount)}`)

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

// The app's colours, so the picture looks like the check it came from.
const ink = '#263029', inkSoft = '#465148', muted = '#5f6a61', rule = '#dce1da', hairline = '#edf0ea', paper = '#fffefa'
const sans = 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif'
const serif = 'Georgia, "Times New Roman", serif'
/** Avatar colours in the order people joined, as --tone-0…9 in app.css. */
const tones: [string, string][] = [
  ['#e7c9ae', '#5a4332'], ['#d5dfb6', '#4b5e2f'], ['#dcd1e9', '#5e4f75'], ['#efd4c8', '#764b3d'], ['#c7e0dd', '#3f6661'],
  ['#f1dfa6', '#6b5418'], ['#c9d6ee', '#3c4f78'], ['#ecc8d8', '#7a3f5a'], ['#bfe0c4', '#2f6239'], ['#d9d2c6', '#55493a'],
]
/** The status pill under a name: settled green, marked light green, the payer neutral, unpaid a soft red. */
function statusStyle(person: ParticipantTotal, ownerId?: string): [string, string] {
  if (person.id === ownerId) return ['#e8ebe5', inkSoft]
  if (person.overpaid) return ['#f5e9c8', '#6b5418']
  if (person.mark === 'confirmed') return ['#d6ecc9', '#2f6239']
  if (person.mark === 'marked') return ['#eaf2d3', '#4b5e2f']
  return ['#f6e1d9', '#8a3f2a']
}

const plural = (count: number, one: string, few: string, many: string) => {
  const tens = count % 100, ones = count % 10
  return `${count} ${tens > 10 && tens < 20 ? many : ones === 1 ? one : ones > 1 && ones < 5 ? few : many}`
}

function dashed(ctx: CanvasRenderingContext2D, x: number, y: number, width: number) {
  ctx.save(); ctx.strokeStyle = rule; ctx.lineWidth = 2; ctx.setLineDash([10, 8])
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + width, y); ctx.stroke(); ctx.restore()
}

/** Paper with a torn, zigzag top and bottom, like a till receipt. */
function paperPath(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) {
  const tooth = 16, depth = 9, teeth = Math.round(width / tooth), step = width / teeth
  ctx.beginPath(); ctx.moveTo(x, y + depth)
  for (let i = 0; i < teeth; i++) { ctx.lineTo(x + step * (i + .5), y); ctx.lineTo(x + step * (i + 1), y + depth) }
  ctx.lineTo(x + width, y + height - depth)
  for (let i = teeth; i > 0; i--) { ctx.lineTo(x + step * (i - .5), y + height); ctx.lineTo(x + step * (i - 1), y + height - depth) }
  ctx.closePath()
}

/** roundRect arrived in Safari 16; an older phone gets square corners instead of no picture. */
function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath()
  if (ctx.roundRect) ctx.roundRect(x, y, width, height, radius)
  else ctx.rect(x, y, width, height)
}

function pill(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, [background, color]: [string, string]) {
  ctx.font = `600 16px ${sans}`
  const width = ctx.measureText(text).width + 24
  ctx.fillStyle = background; rounded(ctx, x, y, width, 30, 15); ctx.fill()
  ctx.fillStyle = color; ctx.textBaseline = 'middle'; ctx.fillText(text, x + 12, y + 16); ctx.textBaseline = 'alphabetic'
}

/**
 * Lays the whole picture out and paints it; returns how tall it came out. Run once on a scrap canvas to
 * learn the height, then on the real one: every line is one line (long text is cut with "…"), so both agree.
 */
function paint(ctx: CanvasRenderingContext2D, bill: Bill, total: number, totals: ParticipantTotal[], ownerId: string | undefined, height: number) {
  const width = 1080, left = 60, paperWidth = 960, x = left + 64, inner = paperWidth - 128, right = x + inner
  ctx.fillStyle = '#eef0ec'; ctx.fillRect(0, 0, width, height)
  ctx.save(); ctx.shadowColor = 'rgb(38 48 41 / .12)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 12
  paperPath(ctx, left, 60, paperWidth, height - 120); ctx.fillStyle = paper; ctx.fill(); ctx.restore()

  // Brand and date
  let y = 60 + 64
  ctx.fillStyle = '#cce59a'; rounded(ctx, x, y, 44, 44, 13); ctx.fill()
  ctx.fillStyle = '#2d3b1b'; ctx.font = `700 28px ${serif}`; ctx.textAlign = 'center'; ctx.fillText('р', x + 22, y + 31)
  ctx.textAlign = 'left'; ctx.fillStyle = ink; ctx.fillText('рядом', x + 58, y + 32)
  ctx.fillStyle = muted; ctx.font = `20px ${sans}`; ctx.textAlign = 'right'
  ctx.fillText(new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(new Date(bill.createdAt)), right, y + 30); ctx.textAlign = 'left'

  // Title and what is in the check
  y += 120
  ctx.fillStyle = ink; ctx.font = `500 54px ${serif}`; ctx.fillText(fitText(ctx, bill.title, inner), x, y)
  y += 42
  ctx.fillStyle = muted; ctx.font = `20px ${sans}`
  ctx.fillText(`${plural(totals.length, 'человек', 'человека', 'человек')} · ${plural(bill.items.length, 'позиция', 'позиции', 'позиций')}`, x, y)
  y += 36; dashed(ctx, x, y, inner)

  // Totals
  y += 48
  if (bill.servicePercent) {
    const food = bill.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
    ctx.font = `21px ${sans}`
    for (const [label, amount] of [['Блюда', food], [`Обслуживание ${bill.servicePercent}%`, serviceFee(food, bill.servicePercent)]] as const) {
      ctx.fillStyle = inkSoft; ctx.fillText(label, x, y)
      ctx.textAlign = 'right'; ctx.fillText(formatUzs(amount), right, y); ctx.textAlign = 'left'
      y += 36
    }
    y += 14
  }
  ctx.fillStyle = ink; ctx.font = `600 24px ${sans}`; ctx.fillText('Итого', x, y)
  ctx.font = `500 50px ${serif}`; ctx.textAlign = 'right'; ctx.fillText(formatUzs(total), right, y + 4); ctx.textAlign = 'left'
  y += 40; dashed(ctx, x, y, inner)

  // Who owes what, with what it is made of
  y += 50
  ctx.fillStyle = muted; ctx.font = `700 15px ${sans}`; ctx.letterSpacing = '2px'; ctx.fillText('КТО СКОЛЬКО', x, y); ctx.letterSpacing = '0px'
  y += 26
  totals.forEach((person, index) => {
    if (index) { ctx.fillStyle = hairline; ctx.fillRect(x, y, inner, 2) }
    y += 26
    const [tone, toneInk] = tones[Math.max(0, bill.participants.findIndex(entry => entry.id === person.id)) % tones.length]
    ctx.fillStyle = tone; ctx.beginPath(); ctx.arc(x + 28, y + 28, 28, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = toneInk; ctx.font = `700 24px ${sans}`; ctx.textAlign = 'center'; ctx.fillText(person.name.slice(0, 1).toUpperCase(), x + 28, y + 37); ctx.textAlign = 'left'
    const due = formatUzs(person.due)
    ctx.font = `700 27px ${sans}`
    const dueWidth = ctx.measureText(due).width
    ctx.fillStyle = ink; ctx.fillText(fitText(ctx, person.name, inner - 76 - dueWidth - 24), x + 76, y + 24)
    ctx.textAlign = 'right'; ctx.fillText(due, right, y + 24); ctx.textAlign = 'left'
    pill(ctx, paymentLine(person, ownerId), x + 76, y + 38, statusStyle(person, ownerId))
    y += 82
    for (const line of detailItems(bill, person)) {
      y += 30
      const amount = formatUzs(line.amount)
      ctx.font = `19px ${sans}`
      const amountWidth = ctx.measureText(amount).width
      ctx.fillStyle = muted; ctx.fillText(fitText(ctx, line.label, inner - 76 - amountWidth - 24), x + 76, y)
      ctx.fillStyle = inkSoft; ctx.textAlign = 'right'; ctx.fillText(amount, right, y); ctx.textAlign = 'left'
    }
    y += 24
  })

  // Footer
  y += 10; dashed(ctx, x, y, inner)
  y += 50
  ctx.fillStyle = muted; ctx.font = `18px ${sans}`; ctx.textAlign = 'center'
  ctx.fillText(`Посчитано в «Рядом»${typeof location === 'undefined' ? '' : ` · ${location.host}`}`, left + paperWidth / 2, y); ctx.textAlign = 'left'
  return y + 60 + 60
}

/** On a phone the picture goes to the share sheet ("Сохранить изображение", a chat); on a computer it downloads. */
export function saveImage(bill: Bill, total: number, totals: ParticipantTotal[], ownerId?: string) {
  const title = bill.title
  const scrap = document.createElement('canvas').getContext('2d'); if (!scrap) return
  const width = 1080, height = Math.ceil(paint(scrap, bill, total, totals, ownerId, 1))
  // iOS Safari draws nothing on a canvas over 16.7 million pixels, so a long check gets a lower scale.
  const scale = Math.min(3, Math.max(2, window.devicePixelRatio || 1), Math.sqrt(16_000_000 / (width * height)))
  const canvas = document.createElement('canvas')
  canvas.width = width * scale; canvas.height = height * scale
  const ctx = canvas.getContext('2d'); if (!ctx) return
  ctx.scale(scale, scale)
  paint(ctx, bill, total, totals, ownerId, height)
  const blob = pngBlob(canvas), name = `${safeFileName(title)}.png`
  void shareOr({ title, files: [new File([blob], name, { type: 'image/png' })] }, () => download(blob, name))
}
