// Turns OCR text of a receipt into bill items. Pure, so it is unit-tested without Tesseract.
import { limits } from './limits.ts'

/** `unsure` rows are likely misreads: the rest add up to the receipt's total without them. */
export type ScannedItem = { name: string; quantity: number; unitPrice: number; unsure?: boolean }
/** `servicePercent` is the service charge printed on the receipt, as a share of the food; null when there is none. */
export type ScanResult = { items: ScannedItem[]; total: number | null; servicePercent: number | null }

/** Same limits as the add-item form: whole sums, 1–99 pieces. */
export const scanLimits = { nameLength: limits.itemNameLength, maxQuantity: 99, minPrice: 100 }

// "25 000,00", "25.000", "25000", "1,5": thousands groups of exactly three digits, then optional decimals.
const amount = String.raw`\d{1,3}(?:[  .,']\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?`
const amountPattern = new RegExp(String.raw`(?<!\d)(${amount})(?!\d)`, 'g')
// "2 x 25 000", "1,000*39000,00 39000,00", "0,35 x 16675,00 = 5802,90": a quantity, a unit price and maybe the line total.
// The quantity's comma is a decimal one ("1,000" is one piece); OCR sometimes reads the "*" as "+".
const timesPattern = new RegExp(String.raw`(?<!\d)(\d+(?:[.,]\d{1,3})?)\s*(?:шт\.?|pcs|dona|kg|кг)?\s*[xх×*+]\s*(${amount})(?!\d)(?:\s*(=)?\s*(${amount})(?!\d))?`, 'iu')

// Lines that are totals, payments, taxes or receipt metadata rather than dishes.
const totalWords = String.raw`итог\p{L}*|всего|к\s+оплате|jami|total|subtotal`
const skipWords = [
  totalWords,
  String.raw`оплат\p{L}*|наличн\p{L}*|безнал\p{L}*|карт(?:а|ой|е|ы)|сдача|ндс|qqs|naqd\p{L}*|karta|plastik|qaytim|t[o0]'?landi|tax|vat|sh\.?\s?j|jumladan`,
  String.raw`обслуживан\p{L}*|xizmat\p{L}*|service|скидк\p{L}*|chegirma|discount|бонус\p{L}*|чаев\p{L}*|tips?`,
  String.raw`инн|stir|чек|chek|check|касс\p{L}*|kass\p{L}*|смен\p{L}*|продаж\p{L}*|sotuv\p{L}*|фискал\p{L}*|fiskal\p{L}*|терминал\p{L}*|terminal`,
  String.raw`mxik|икпу|ikpu|штрих\p{L}*|shtrix\p{L}*|sku|sh\.?\s?k|qad[aoq]{1,4}|k[ao]d\p{L}?|код`,
  String.raw`дата|sana|время|vaqt|официант\p{L}*|ofitsiant|стол|stol|гост(?:ь|ей|и)|mehmon\p{L}*|спасибо|rahmat|телефон|tel|адрес|manzil`,
  String.raw`наименован\p{L}*|кол-?во|цена|сумма|nomi|soni|narxi|summa|позици\p{L}*|покуп\p{L}*`,
].join('|')
const skipPattern = new RegExp(String.raw`(?<!\p{L})(?:${skipWords})(?!\p{L})`, 'iu')
const totalPattern = new RegExp(String.raw`(?<!\p{L})(?:${totalWords})(?!\p{L})`, 'iu')
const servicePattern = /(?<!\p{L})(?:обслуживан\p{L}*|xizmat\p{L}*|service)(?!\p{L})/iu
// Dates, times and phone numbers are full of digits that would otherwise look like prices.
const metaPattern = /\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|(?<!\d)\d{1,2}:\d{2}(?!\d)|\+\s?\d{3}/
// Numbers that are never prices: receipt and article numbers, codes after a slash, weights and volumes in names.
const notPricePattern = new RegExp([
  String.raw`[№#]\s*:?\s*\d+`,
  String.raw`\[[^\]]*\]`,
  String.raw`\(\s*\d[\d\s.,]*\)`,
  String.raw`\/\s*\d+`,
  String.raw`(?<![\d.,])\d+(?:[.,]\d+)?\s?(?:кг|kg|гр?|gr?|мл|ml|л|l|%)(?!\p{L})`,
  String.raw`(?<!\S)0\d{4,}`,
].join('|'), 'giu')
const currencyPattern = /(?<!\p{L})(?:сум|so'?m|sum|uzs)(?!\p{L})/giu

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

/** Prices in the line, skipping numbers that only look like them; indexes match the original line. */
const amounts = (line: string) => [...line.replace(notPricePattern, match => ' '.repeat(match.length)).matchAll(amountPattern)]
  .map(match => ({ value: parseAmount(match[1]), index: match.index }))
  .filter(entry => entry.value <= limits.maxUnitPrice)
const letters = (text: string) => (text.match(/\p{L}/gu) ?? []).length
const isQuantity = (value: number) => Number.isInteger(value) && value >= 1 && value <= scanLimits.maxQuantity
const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, b * 0.01)

/** Drops article codes, quotes, dot leaders, stray symbols, a unit at the end and a lone OCR letter left over from the quantity column. */
function cleanName(text: string) {
  let name = text.replace(/\[[^\]]*\]|\(\s*\d{3,}[\d\s.,]*\)/g, ' ').replace(/["«»“”„]/g, ' ')
  if ((name.match(/\(/g) ?? []).length !== (name.match(/\)/g) ?? []).length) name = name.replace(/[()]/g, ' ')
  name = name.replace(/[|_=~•·…:;—–]+/g, ' ').replace(/\.{2,}/g, ' ').replace(/^[^\p{L}\d(]+|[^\p{L}\d)%]+$/gu, '')
  if (/^\(.*\)$/.test(name)) name = name.slice(1, -1)
  name = name.replace(/\s(?:kg|кг|шт|pcs|dona)$/iu, '').replace(/(?<=\p{L}{2}.*)\s\p{L}$/u, '').replace(/\s+/g, ' ').trim()
  // A long name is cut at a word boundary.
  return name.length <= scanLimits.nameLength ? name : name.slice(0, scanLimits.nameLength + 1).replace(/\s+\S*$/, '')
}
const nameOrEmpty = (text: string) => { const name = cleanName(text); return letters(name) >= 2 ? name : '' }

/** Whole pieces stay as quantity; weights and fractions become one piece at the line total. */
function item(name: string, quantity: number, unitPrice: number): ScannedItem | null {
  if (unitPrice < scanLimits.minPrice) return null
  if (!isQuantity(quantity)) return { name, quantity: 1, unitPrice: Math.round(unitPrice * quantity) }
  return { name, quantity, unitPrice: Math.round(unitPrice) }
}

/** "2 x 25 000 = 50 000": the line total wins over a misread unit price, and gives the sum for weighed goods. */
function timesItem(name: string, match: RegExpExecArray): ScannedItem | null {
  const quantity = Number(match[1].replace(',', '.')), unitPrice = parseAmount(match[2])
  const lineTotal = match[4] === undefined ? null : parseAmount(match[4])
  // Without "=" a second number is the line total only when it adds up.
  if (lineTotal === null || !(match[3] || close(quantity * unitPrice, lineTotal))) return item(name, quantity, unitPrice)
  if (!isQuantity(quantity)) return item(name, 1, lineTotal)
  if (close(quantity * unitPrice, lineTotal)) return item(name, quantity, unitPrice)
  return Number.isInteger(lineTotal / quantity) ? item(name, quantity, lineTotal / quantity) : item(name, 1, lineTotal)
}

/**
 * Parses one line into an item. Its name is empty when the line has only numbers: fiscal receipts print the name
 * on the line above. `certain` lines ("1 x 5 000 = 5 000") are kept even when no name is found.
 */
function parseLine(line: string): (ScannedItem & { certain: boolean }) | null {
  const times = timesPattern.exec(line)
  if (times) {
    const parsed = timesItem(nameOrEmpty(line.slice(0, times.index)), times)
    return parsed && { ...parsed, certain: Boolean(times[3] || times[4]) }
  }
  const found = amounts(line)
  if (!found.length) return null
  // Text after the price, as in "100135 Республика Узбекистан", means the number is not a price.
  if (letters(line.slice(found.at(-1)!.index).replace(currencyPattern, '')) >= 3) return null
  const name = nameOrEmpty(line.slice(0, found[0].index))
  const values = found.map(entry => entry.value)
  // A small fraction first, as in "Cola 0,5 12 000", is part of the name rather than a quantity.
  if (values.length >= 2 && !Number.isInteger(values[0]) && values[0] < 10) {
    const rest = parseLine(line.slice(found[1].index))
    return rest && { ...rest, name: nameOrEmpty(line.slice(0, found[1].index)) }
  }
  const result = (entry: ScannedItem | null) => entry && { ...entry, certain: false }
  const [a, b, c] = values.slice(-3)
  if (values.length >= 3 && close(a * b, c)) return result(item(name, a, b))
  if (values.length >= 2) {
    const [previous, last] = values.slice(-2)
    if (isQuantity(previous)) {
      // "Плов 2 90 000" is a quantity and a line total; "Самса 3 12 500" cannot be, so it is a unit price.
      return result(last % previous === 0 ? item(name, previous, last / previous) : item(name, previous, last))
    }
    // "Плов 45 000 90 000": unit price and line total.
    if (isQuantity(last / previous)) return result(item(name, last / previous, previous))
  }
  return result(item(name, 1, values.at(-1)!))
}

function* combinations(size: number, count: number, from = 0): Generator<number[]> {
  if (!size) { yield []; return }
  for (let i = from; i <= count - size; i++) for (const rest of combinations(size - 1, count, i + 1)) yield [i, ...rest]
}

/** When the dishes add up to more than the total and dropping exactly one set of up to three rows fixes that, those rows are misreads. */
function markExtras(items: ScannedItem[], total: number | null) {
  if (total === null || items.length < 2) return
  // Weighed goods are rounded to whole sums, so each row may be off by one.
  const tolerance = items.length
  const sum = items.reduce((acc, entry) => acc + entry.quantity * entry.unitPrice, 0)
  if (sum - total <= tolerance) return
  for (let size = 1; size <= Math.min(3, items.length - 1); size++) {
    const fits: number[][] = []
    for (const set of combinations(size, items.length)) {
      const left = sum - set.reduce((acc, i) => acc + items[i].quantity * items[i].unitPrice, 0)
      if (Math.abs(left - total) <= tolerance && fits.push(set) > 1) return
    }
    if (fits.length === 1) { for (const i of fits[0]) items[i].unsure = true; return }
  }
}

/** `total` is the receipt's total without its service charge, since the bill adds service itself. */
export function parseReceipt(text: string): ScanResult {
  const items: ScannedItem[] = []
  let total: number | null = null, service = 0, ended = false
  // Lines with letters and no price: a name for the price line below, or the rest of a long name above.
  let names: string[] = []
  let last: ScannedItem | null = null
  const settle = () => {
    if (last && names.length) last.name = cleanName(`${last.name} ${names.join(' ')}`)
    names = []; last = null
  }
  for (const raw of text.split(/\r?\n/)) {
    // Row numbers such as "1." or "2)" come before the dish name; OCR may lose the dot before a name in capitals.
    const line = fixDigits(raw.replace(/\s+/g, ' ').trim()).replace(/^(?:(?:\d{1,3}|[|!lI])\s?[.)]\s*(?=[\p{L}[("«“])|\d{1,3}\s+(?=\p{Lu}{3}))/u, '')
    if (!line) continue
    if (skipPattern.test(line) || metaPattern.test(line)) {
      settle()
      const value = amounts(line).filter(entry => entry.value >= scanLimits.minPrice).at(-1)?.value
      if (totalPattern.test(line)) {
        total = value ?? total
        // Whatever follows the total is payment, change and fiscal data.
        if (value !== undefined) ended = true
      } else if (servicePattern.test(line)) service = value ?? service
      continue
    }
    if (ended) continue
    const parsed = parseLine(line)
    if (parsed && (parsed.name || names.length || parsed.certain)) {
      const { certain: _, ...entry } = parsed
      if (entry.name) settle()
      else if (last) { entry.name = names.pop() ?? ''; settle() }
      else { entry.name = cleanName(names.join(' ')); names = [] }
      items.push(entry); last = entry
      continue
    }
    const name = nameOrEmpty(line)
    if (name && !amounts(line).some(entry => entry.value >= scanLimits.minPrice)) names.push(name)
    else settle()
  }
  settle()
  // Only letters without a twin in the other alphabet tell which one the receipt is printed in.
  const distinct = (script: RegExp, twins: Map<string, string>) => (text.match(script) ?? []).filter(char => !twins.has(char)).length
  const cyrillicReceipt = distinct(/\p{Script=Cyrillic}/gu, toLatin) > distinct(/\p{Script=Latin}/gu, toCyrillic)
  const food = total === null ? null : Math.round(total - (service < total ? service : 0))
  markExtras(items, food)
  const base = food ?? items.reduce((sum, entry) => sum + entry.quantity * entry.unitPrice, 0)
  return {
    items: items.map(entry => ({ ...entry, name: unifyScript(entry.name, cyrillicReceipt) })),
    total: food,
    servicePercent: service && base ? Math.round(service / base * 100) : null,
  }
}
