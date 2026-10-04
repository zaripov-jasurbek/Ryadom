// Turns OCR text of a restaurant receipt into bill items. Pure, so it is unit-tested without Tesseract.

export type ScannedItem = { name: string; quantity: number; unitPrice: number }
export type ScanResult = { items: ScannedItem[]; total: number | null }

/** Same limits as the add-item form: whole sums, 1–99 pieces, names up to 48 characters. */
export const scanLimits = { nameLength: 80, maxQuantity: 99, minPrice: 100 }

// "25 000,00", "25.000", "25000", "1,5": thousands groups of exactly three digits, then optional decimals.
const amount = String.raw`\d{1,3}(?:[  .,']\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?`
const amountPattern = new RegExp(String.raw`(?<!\d)(${amount})(?!\d)`, 'g')
const timesPattern = new RegExp(String.raw`(?<!\d)(\d+(?:[.,]\d{1,3})?)\s*(?:шт\.?|pcs|dona|kg|кг)?\s*[xх×*]\s*(${amount})(?!\d)`, 'iu')

// Lines that are totals, payments, taxes or receipt metadata rather than dishes.
const totalWords = String.raw`итог\p{L}*|всего|к\s+оплате|jami|total|subtotal`
const skipWords = [
  totalWords,
  String.raw`оплат\p{L}*|наличн\p{L}*|безнал\p{L}*|карт(?:а|ой|е|ы)|сдача|ндс|qqs|naqd\p{L}*|karta|plastik|qaytim|tax|vat`,
  String.raw`обслуживан\p{L}*|xizmat\p{L}*|service|скидк\p{L}*|chegirma|discount|бонус\p{L}*|чаев\p{L}*|tips?`,
  String.raw`инн|stir|чек|chek|check|кассир\p{L}*|kassir|фискал\p{L}*|fiskal\p{L}*|терминал\p{L}*|terminal|mxik|икпу|ikpu|штрих\p{L}*|shtrix\p{L}*`,
  String.raw`дата|sana|время|vaqt|официант\p{L}*|ofitsiant|стол|stol|гост(?:ь|ей|и)|mehmon\p{L}*|спасибо|rahmat|телефон|tel|адрес|manzil`,
  String.raw`наименован\p{L}*|кол-?во|цена|сумма|nomi|soni|narxi|summa`,
].join('|')
const skipPattern = new RegExp(String.raw`(?<!\p{L})(?:${skipWords})(?!\p{L})`, 'iu')
const totalPattern = new RegExp(String.raw`(?<!\p{L})(?:${totalWords})(?!\p{L})`, 'iu')
const servicePattern = /(?<!\p{L})(?:обслуживан\p{L}*|xizmat\p{L}*|service)(?!\p{L})/iu
// Dates, times and phone numbers are full of digits that would otherwise look like prices.
const metaPattern = /\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|(?<!\d)\d{1,2}:\d{2}(?!\d)|\+\s?\d{3}/

/** Reads "25 000,00" as 25000 and "1,5" as 1.5. */
export function parseAmount(raw: string): number {
  const decimals = /[.,](\d{1,2})$/.exec(raw)
  const whole = (decimals ? raw.slice(0, decimals.index) : raw).replace(/\D/g, '')
  return Number(whole || '0') + (decimals ? Number(`0.${decimals[1]}`) : 0)
}

/** Common OCR slips in number columns: "i", "l", "T" or "|" for a lone 1, and the letter O for a zero. */
function fixDigits(line: string) {
  return line
    .replace(/(?<=\s)[iIlTТ|!](?=\s+\d)/gu, '1')
    // "45 OOO" and "4O 000": a group of O's after a digit group, or O's mixed into a number.
    .replace(/(?<=\d[ .,])[OoОо]{3}(?!\p{L})/gu, '000')
    .replace(/(?<!\p{L})[\dOoОо]*\d[\dOoОо]*(?!\p{L})/gu, token => token.replace(/[OoОо]/gu, '0'))
}

// Latin and Cyrillic letters that look the same; OCR with both languages loaded mixes them up ("Camca" for "Самса").
const latin = 'AaBCcEeHKkMmOoPpTXxy', cyrillic = 'АаВСсЕеНКкМмОоРрТХху'
const toCyrillic = new Map([...latin].map((char, i) => [char, cyrillic[i]]))
const toLatin = new Map([...cyrillic].map((char, i) => [char, latin[i]]))

/** Rewrites look-alike letters in the receipt's main script, so a dish reads as one alphabet. */
function unifyScript(name: string, cyrillicReceipt: boolean) {
  const map = cyrillicReceipt ? toCyrillic : toLatin
  const own = cyrillicReceipt ? /\p{Script=Cyrillic}/u : /\p{Script=Latin}/u
  return name.replace(/\p{L}+/gu, word => own.test(word) || [...word].every(char => map.has(char)) ? [...word].map(char => map.get(char) ?? char).join('') : word)
}

const amounts = (line: string) => [...line.matchAll(amountPattern)].map(match => ({ value: parseAmount(match[1]), index: match.index }))
const letters = (text: string) => (text.match(/\p{L}/gu) ?? []).length
const isQuantity = (value: number) => Number.isInteger(value) && value >= 1 && value <= scanLimits.maxQuantity
const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, b * 0.01)

/** Drops dot leaders, stray symbols and a lone OCR letter left over from the quantity column. */
function cleanName(text: string) {
  return text.replace(/[|_=~•·…:;]+/g, ' ').replace(/\.{2,}/g, ' ')
    .replace(/^[^\p{L}\d]+|[^\p{L}\d)%]+$/gu, '').replace(/(?<=\p{L}{2}.*)\s\p{L}$/u, '')
    .replace(/\s+/g, ' ').trim().slice(0, scanLimits.nameLength).trim()
}

/** Whole pieces stay as quantity; weights and fractions become one piece at the line total. */
function item(name: string, quantity: number, unitPrice: number): ScannedItem | null {
  if (unitPrice < scanLimits.minPrice) return null
  if (!isQuantity(quantity)) return { name, quantity: 1, unitPrice: Math.round(unitPrice * quantity) }
  return { name, quantity, unitPrice: Math.round(unitPrice) }
}

/** Parses one line; the name comes from the previous line when the receipt prints prices underneath it. */
function parseLine(line: string, pendingName: string): ScannedItem | null {
  const nameBefore = (index: number) => { const own = cleanName(line.slice(0, index)); return letters(own) >= 2 ? own : pendingName }
  const times = timesPattern.exec(line)
  if (times) {
    const name = nameBefore(times.index)
    return name ? item(name, parseAmount(times[1]), parseAmount(times[2])) : null
  }
  const found = amounts(line)
  const name = found.length ? nameBefore(found[0].index) : ''
  if (!name) return null
  const values = found.map(entry => entry.value)
  // A small fraction first, as in "Cola 0,5 12 000", is part of the name rather than a quantity.
  if (values.length >= 2 && !Number.isInteger(values[0]) && values[0] < 10) return parseLine(line.slice(found[1].index), cleanName(line.slice(0, found[1].index)))
  const [a, b, c] = values.slice(-3)
  if (values.length >= 3 && close(a * b, c)) return item(name, a, b)
  if (values.length >= 2) {
    const [previous, last] = values.slice(-2)
    if (isQuantity(previous)) {
      // "Плов 2 90 000" is a quantity and a line total; "Самса 3 12 500" cannot be, so it is a unit price.
      return last % previous === 0 ? item(name, previous, last / previous) : item(name, previous, last)
    }
    // "Плов 45 000 90 000": unit price and line total.
    if (isQuantity(last / previous)) return item(name, last / previous, previous)
  }
  return item(name, 1, values.at(-1)!)
}

/** `total` is the receipt's total without its service charge, since the bill adds service itself. */
export function parseReceipt(text: string): ScanResult {
  const items: ScannedItem[] = []
  let total: number | null = null, service = 0
  let pendingName = ''
  for (const raw of text.split(/\r?\n/)) {
    // Row numbers such as "1." or "2)" come before the dish name.
    const line = fixDigits(raw.replace(/\s+/g, ' ').trim()).replace(/^\d{1,3}\s?[.)]\s*(?=\p{L})/u, '')
    if (!line) continue
    if (skipPattern.test(line) || metaPattern.test(line)) {
      if (totalPattern.test(line)) total = amounts(line).at(-1)?.value ?? total
      else if (servicePattern.test(line)) service = amounts(line).filter(entry => entry.value >= scanLimits.minPrice).at(-1)?.value ?? service
      pendingName = ''
      continue
    }
    const parsed = parseLine(line, pendingName)
    if (parsed) { items.push(parsed); pendingName = ''; continue }
    // A line without a price waits for the "2 x 25 000" line that follows it on fiscal receipts.
    const name = cleanName(line)
    pendingName = letters(name) >= 2 ? name : ''
  }
  // Only letters without a twin in the other alphabet tell which one the receipt is printed in.
  const distinct = (script: RegExp, twins: Map<string, string>) => (text.match(script) ?? []).filter(char => !twins.has(char)).length
  const cyrillicReceipt = distinct(/\p{Script=Cyrillic}/gu, toLatin) > distinct(/\p{Script=Latin}/gu, toCyrillic)
  return {
    items: items.map(entry => ({ ...entry, name: unifyScript(entry.name, cyrillicReceipt) })),
    total: total === null ? null : Math.round(total - (service < total ? service : 0)),
  }
}
