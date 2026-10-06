// Turns OCR text of a receipt into bill items. Pure, so it is unit-tested without Tesseract.
import { limits } from './limits.ts'

/** `unsure` rows are likely misreads: the rest add up to the receipt's total without them. */
export type ScannedItem = { name: string; quantity: number; unitPrice: number; unsure?: boolean }
/** `servicePercent` is the service charge printed on the receipt, as a share of the food; null when there is none. */
export type ScanResult = { items: ScannedItem[]; total: number | null; servicePercent: number | null }

/** Same limits as the add-item form: whole sums, 1–99 pieces. */
export const scanLimits = { nameLength: limits.itemNameLength, maxQuantity: 99, minPrice: 100 }

// "25 000,00", "25.000", "25000", "1,5": thousands groups of exactly three digits, then optional decimals.
// OCR sometimes reads the space in "401 000" as a dash.
const amount = String.raw`\d{1,3}(?:[  .,'-]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?`
const amountPattern = new RegExp(String.raw`(?<!\d)(${amount})(?!\d)`, 'g')
// "2 x 25 000", "1,000*39000,00 39000,00", "0,35 x 16675,00 = 5802,90": a quantity, a unit price and maybe the line total.
// The quantity's comma is a decimal one ("1,000" is one piece) and may carry a unit ("2dona", "3 шт"); OCR sometimes reads the "*" as "+".
const timesPattern = new RegExp(String.raw`(?<!\d)(\d+(?:[.,]\d{1,3})?)\s*(?:\p{L}{1,5}\.?)?\s*[xх×*+]\s*(${amount})(?!\d)(?:\s*(=)?\s*(${amount})(?!\d))?`, 'iu')
const reversedPattern = new RegExp(String.raw`(?<!\d)(${amount})\s*[xх×*]\s*(\d{1,2})(?![\d.,])`, 'iu')

// Lines that are totals, payments, taxes or receipt metadata rather than dishes.
// OCR often loses the start of "TO'LOV UCHUN:", leaving "UCHUN:" or "CHUN:".
const totalWords = String.raw`итог\p{L}*|всего|к\s+оплате|jami|to.?lov\s+uchun|u?chun(?=\s*:)|total|subtotal`
const skipWords = [
  totalWords,
  String.raw`оплат\p{L}*|наличн\p{L}*|безнал\p{L}*|карт(?:а|ой|е|ы)|сдача|ндс|qqs|naqd\p{L}*|karta(?:si|lar\p{L}*|ga|dan)?|bank\p{L}*|банк\p{L}*|plastik|qaytim|t[o0]'?landi|tax|vat|sh\.?\s?j|jumladan`,
  String.raw`обслуживан\p{L}*|надбавк\p{L}*|xizmat\p{L}*|service|скидк\p{L}*|chegirma|discount|бонус\p{L}*|чаев\p{L}*|tips?`,
  // Exact words where a dish could start the same way: "Открытый пирог", "Кассата".
  String.raw`инн|stir|чек|chek\p{L}*|check|savdo|сч[её]т|гостевой|открыт|заказ|зал|касс[аы]|кассир\p{L}*|kassa|kassir|смена|продажа|sotuv\p{L}*|фискал\p{L}*|fiskal\p{L}*|терминал|terminal`,
  String.raw`mxik|mk|мк|икпу|ikpu|штрих\p{L}*|shtrix\p{L}*|sku|sh\.?\s?k|qad[aoq]{1,4}|k[ao]d\p{L}?|код`,
  String.raw`дата|sana|время|vaqt|официант\p{L}*|ofitsiant|стол|stol|гост(?:ь|ей|и)|mehmon\p{L}*|спасибо|rahmat|телефон|tel|адрес|manzil|ko.?cha(?:si)?`,
  String.raw`наименован\p{L}*|кол-?во|цена|сумма|полная|nomi|soni|narxi|summa|позици\p{L}*|покуп\p{L}*`,
].join('|')
const skipPattern = new RegExp(String.raw`(?<!\p{L})(?:${skipWords})(?!\p{L})`, 'iu')
const totalPattern = new RegExp(String.raw`(?<!\p{L})(?:${totalWords})(?!\p{L})`, 'iu')
const servicePattern = /(?<!\p{L})(?:обслуживан\p{L}*|надбавк\p{L}*|xizmat\p{L}*|service)(?!\p{L})/iu
const discountPattern = /(?<!\p{L})(?:скидк\p{L}*|chegirma|discount)(?!\p{L})/iu
// Numbers that are never prices: dates, times and phone numbers ("Кальян до 17:00" is still a dish), receipt and
// article numbers, codes after a slash, weights, volumes and pieces in names, and numbers glued to a word ("1кишилик").
// Sizes such as "5x3" in "Uzaytirgich Tekled 5x3 dona": no thousands group follows, unlike "2 x 25 000".
const sizePattern = /(?<![\d.,])\d{1,2}\s?[xх×]\s?\d{1,2}(?![\d.,]|\s?\d{3})/giu
const notPricePattern = new RegExp([
  sizePattern.source,
  String.raw`\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|(?<!\d)\d{1,2}:\d{2}(?::\d{2})?(?!\d)|\+\s?\d[\d\s()-]{7,}\d`,
  String.raw`[№#]\s*:?\s*\d+`,
  String.raw`\[[^\]]*\]`,
  String.raw`\(\s*\d[\d\s.,]*\)`,
  String.raw`\/\s*\d+`,
  String.raw`(?<![\d.,])\d+(?:[.,]\d+)?\s?(?:кг|kg|гр?|gr?|мл|ml|л|l|шт|pcs|dona|%)(?!\p{L})`,
  String.raw`(?<![\d.,])\d+(?:[.,]\d+)?(?=\p{L}{2})(?!сум|so'?m|sum|uzs)|(?<![\d.,])\d+-(?=\p{L})`,
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

/** Only letters without a twin in the other alphabet tell which one a text is written in. */
const distinct = (text: string, script: RegExp, twins: Map<string, string>) => (text.match(script) ?? []).filter(char => !twins.has(char)).length
const scriptBalance = (text: string) => distinct(text, /\p{Script=Cyrillic}/gu, toLatin) - distinct(text, /\p{Script=Latin}/gu, toCyrillic)
const isCyrillic = (text: string) => scriptBalance(text) > 0
/** Two texts in different alphabets; one of only look-alike letters ("сом") fits either. */
const otherScript = (a: string, b: string) => scriptBalance(a) * scriptBalance(b) < 0

/** Rewrites look-alike letters in the receipt's main script, so a dish reads as one alphabet. */
function unifyScript(name: string, cyrillicReceipt: boolean) {
  const map = cyrillicReceipt ? toCyrillic : toLatin
  const own = cyrillicReceipt ? /\p{Script=Cyrillic}/u : /\p{Script=Latin}/u
  return name.replace(/\p{L}+/gu, word => own.test(word) || [...word].every(char => map.has(char)) ? [...word].map(char => map.get(char) ?? char).join('') : word)
}

/** The "10" in "Обслуживание 10%". */
const percentOf = (line: string) => { const match = /(?<![\d.,])(\d{1,2}(?:[.,]\d)?)\s?%/.exec(line); return match ? Number(match[1].replace(',', '.')) : null }

/** Prices in the line, skipping numbers that only look like them; indexes match the original line. */
const amounts = (line: string) => [...line.replace(notPricePattern, match => ' '.repeat(match.length)).matchAll(amountPattern)]
  .map(match => ({ value: parseAmount(match[1]), index: match.index }))
  .filter(entry => entry.value <= limits.maxUnitPrice)
const letters = (text: string) => (text.match(/\p{L}/gu) ?? []).length
const isQuantity = (value: number) => Number.isInteger(value) && value >= 1 && value <= scanLimits.maxQuantity
const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, b * 0.01)
const lineSum = (entry: ScannedItem) => entry.quantity * entry.unitPrice
const sumOf = (entries: ScannedItem[]) => entries.reduce((acc, entry) => acc + lineSum(entry), 0)
/** Weighed goods are rounded to whole sums, so each row may be off by one. */
const addsUp = (entries: ScannedItem[], total: number) => Math.abs(sumOf(entries) - total) <= entries.length

/** Drops article codes, quotes, dot leaders, stray symbols, a unit at the end and a lone OCR letter left over from the quantity column. */
function cleanName(text: string) {
  let name = text.replace(/\[[^\]]*\]|\(\s*\d{3,}[\d\s.,]*\)/g, ' ').replace(/["«»“”„]/g, ' ')
  if ((name.match(/\(/g) ?? []).length !== (name.match(/\)/g) ?? []).length) name = name.replace(/[()]/g, ' ')
  name = name.replace(/[|_=~•·…;—–]+|(?<!\d):|:(?!\d)/g, ' ').replace(/\.{2,}/g, ' ').replace(/^[^\p{L}\d(]+|[^\p{L}\d)%]+$/gu, '')
  if (/^\(.*\)$/.test(name)) name = name.slice(1, -1)
  name = name.replace(/\s(?:kg|кг|шт|pcs|dona)$/iu, '').replace(/(?<=\p{L}{2}.*\D)\s\p{L}$/u, '').replace(/\s+/g, ' ').trim()
  // A long name is cut at a word boundary.
  return name.length <= scanLimits.nameLength ? name : name.slice(0, scanLimits.nameLength + 1).replace(/\s+\S*$/, '')
}
/** A name needs two letters besides currency; on a price line, also besides units glued to numbers ("2dona", "33g"). */
const nameOrEmpty = (text: string, priceLine = false) => {
  const name = cleanName(text), words = name.replace(currencyPattern, '')
  return letters(priceLine ? words.replace(/\d+(?:[.,]\d+)?\p{L}*/gu, '') : words) >= 2 ? name : ''
}

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
 * An item while parsing. `certain` lines ("1 x 5 000 = 5 000") are kept even when no name is found. `alt` is the unit price
 * if the line's last number is the price of one piece rather than the line's sum: "Самса 2 22 000" reads either way.
 * `vat` is the line's sum worked out from the tax printed under it, for when OCR misread the price.
 */
type Parsed = ScannedItem & { certain: boolean; alt?: number; vat?: number }

/** Parses one line into an item. Its name is empty when the line has only numbers: fiscal receipts print the name on the line above. */
function parseLine(line: string): Parsed | null {
  const bare = line.replace(sizePattern, match => ' '.repeat(match.length))
  const times = timesPattern.exec(bare)
  const parsed = times && timesItem(nameOrEmpty(line.slice(0, times.index), true), times)
  if (parsed) return { ...parsed, certain: Boolean(times![3] || times![4]) }
  // "Шашлык 45 000 x 2": the price first, then the pieces.
  const reversed = reversedPattern.exec(bare)
  const flipped = reversed && item(nameOrEmpty(line.slice(0, reversed.index), true), Number(reversed[2]), parseAmount(reversed[1]))
  if (flipped) return { ...flipped, certain: false }
  const found = amounts(line)
  if (!found.length) return null
  // Text after the price, as in "100135 Республика Узбекистан", means the number is not a price.
  if (letters(line.slice(found.at(-1)!.index).replace(currencyPattern, '')) >= 3) return null
  const name = nameOrEmpty(line.slice(0, found[0].index), true)
  const values = found.map(entry => entry.value)
  // A small fraction first, as in "Cola 0,5 12 000", is part of the name rather than a quantity.
  if (values.length >= 2 && !Number.isInteger(values[0]) && values[0] < 10) {
    const rest = parseLine(line.slice(found[1].index))
    return rest && { ...rest, name: nameOrEmpty(line.slice(0, found[1].index), true) }
  }
  const result = (entry: ScannedItem | null, alt?: number): Parsed | null => entry && { ...entry, certain: false, ...(alt ? { alt } : {}) }
  const [a, b, c] = values.slice(-3)
  if (values.length >= 3 && close(a * b, c)) return result(item(name, a, b))
  if (values.length >= 2) {
    const [previous, last] = values.slice(-2)
    if (isQuantity(previous)) {
      // "Плов 2 90 000" is most often a quantity and a line sum; the receipt's header or total settles it (see fitColumns).
      // "Самса 3 12 500" cannot be a sum, so it is a unit price.
      return last % previous === 0 && previous > 1 ? result(item(name, previous, last / previous), last) : result(item(name, previous, last))
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
  const sums = items.map(lineSum), excess = sumOf(items) - total, tolerance = items.length
  if (excess <= tolerance) return
  for (let size = 1; size <= Math.min(3, items.length - 1); size++) {
    let fit: number[] | null = null
    for (const set of combinations(size, items.length)) {
      if (Math.abs(set.reduce((acc, i) => acc + sums[i], 0) - excess) > tolerance) continue
      // Two different sets fit: the total cannot tell which rows are extra.
      if (fit) return
      fit = set
    }
    if (fit) { for (const i of fit) items[i].unsure = true; return }
  }
}

/** When other pieces in exactly one row make the dishes add up to the total, OCR misread them: "1" often comes out as "7" or "4". */
function fixQuantity<T extends ScannedItem>(items: T[], total: number): T[] | null {
  const fixes = items.flatMap((entry, i) => {
    const quantity = Math.round((total - sumOf(items) + lineSum(entry)) / entry.unitPrice)
    const fixed = items.map((other, j) => j === i ? { ...other, quantity } : other)
    return isQuantity(quantity) && quantity !== entry.quantity && addsUp(fixed, total) ? [fixed] : []
  })
  return fixes.length === 1 ? fixes[0] : null
}

// "Shu jumladan QQS 12%: 1 713,21" under an item on Uzbek fiscal receipts: the tax included in the line's sum.
const vatPattern = /(?<!\p{L})(?:qqs|ндс)(?!\p{L})/iu
const centsPattern = /(?<!\d)(\d{1,3}(?:[  ]\d{3})*[.,]\d{2})\s*$/

/**
 * The line's sum that the tax in the line comes from: 1 713,21 at 12% is 15 990. Only a tax read to the tiyin that gives
 * whole sums counts, so a misread or cut-off tax ("1 713") is not taken for a price.
 */
function vatSum(line: string) {
  const percent = percentOf(line), tax = centsPattern.exec(line)
  if (!percent || percent > 30 || !tax) return null
  const sum = parseAmount(tax[1]) * (100 + percent) / percent
  return Math.abs(sum - Math.round(sum)) <= 0.06 && Math.round(sum) >= scanLimits.minPrice ? Math.round(sum) : null
}

/** The row with the line's sum its tax gives; the pieces stay when they divide it. */
function withVat<T extends Parsed>(entry: T): T {
  if (!entry.vat || close(lineSum(entry), entry.vat)) return entry
  const quantity = Number.isInteger(entry.vat / entry.quantity) ? entry.quantity : 1
  return { ...entry, quantity, unitPrice: entry.vat / quantity }
}

/** "Сумма: 401 000" before service and discounts: what the dishes add up to. */
const subtotalPattern = /^полная(?!\p{L})|^сумма(?!\s+\p{L})|(?<!\p{L})(?:subtotal|подытог)(?!\p{L})/iu
const currencyLine = /^[^\p{L}\d]*(?:сум|so'?m|sum|uzs)[^\p{L}\d]*$/iu
const sizeLine = /^\d+(?:[.,]\d+)?\s?(?:кг|kg|гр?|gr?|мл|ml|л|l)\.?$/iu
// The table header names the last column: "Цена" is the price of one piece, "Сумма" the line's sum.
const headerPattern = /(?<!\p{L})(?:наименован\p{L}*|кол-?во|nomi|soni)(?!\p{L})/iu
const unitPriceHeader = /(?<!\p{L})(?:цена|narxi?)(?!\p{L})/iu, lineSumHeader = /(?<!\p{L})(?:сумма|summa)(?!\p{L})/iu

/**
 * `total` is what the dishes add up to on the receipt: its total without service charge and before discounts, since the bill
 * adds service itself. `known` gives the total and service read from another reading of the same photo, for when this one missed them.
 */
export function parseReceipt(text: string, known?: Pick<ScanResult, 'total' | 'servicePercent'>): ScanResult {
  const items: Parsed[] = []
  let total: number | null = null, subtotal: number | null = null, ended = false, unitPrices = false
  // Service and discount printed after the last total line are not part of it: "Итого 143 000, обслуживание 14 300".
  let service = 0, servicePercent: number | null = null, serviceInTotal = true, discount = 0, discountInTotal = true
  // Lines with letters and no price: a name for the price line below, or the rest of a long name above.
  // `numbered` lines started with a row number, so a name begins there.
  let names: { text: string; numbered: boolean }[] = []
  // The last item, and whether its name was on its own price line: only then do lines below continue the name.
  // Fiscal receipts print the name above the price and a translation below it.
  let last: ScannedItem | null = null, lastNamedInline = false
  const settle = () => {
    // A line in the other alphabet is a translation, as "Удлинитель Tekled 5x3 шт" under "Uzaytirgich Tekled 5x3 dona".
    const rest = last && lastNamedInline ? names.filter(entry => !otherScript(entry.text, last!.name)) : []
    if (last && rest.length) last.name = cleanName(`${last.name} ${rest.map(entry => entry.text).join(' ')}`)
    names = []; last = null
  }
  for (const raw of text.split(/\r?\n/)) {
    // A tab or a run of spaces separates columns; it is kept, so numbers in two columns never merge into one.
    const cells = raw.replace(/ {2,}/g, '\t').replace(/[^\S\t]+/g, ' ').trim().split(/ *\t[\t ]*/)
    // Specks at the paper's edge come out as a short first or last column: "2 ⇥ Суп ⇥ 1 ⇥ 42 000 ⇥ 3".
    if (cells.length >= 2 && cells[0].length <= 4 && letters(cells[0]) < 2 && letters(cells[1]) >= 2) cells.shift()
    if (cells.length >= 3 && cells.at(-1)!.length <= 2 && amounts(cells.at(-2)!).some(entry => entry.value >= scanLimits.minPrice)) cells.pop()
    // Row numbers such as "1." or "2)" come before the dish name; OCR may lose the dot before a name in capitals.
    const fixed = fixDigits(cells.join('\t'))
    const line = fixed.replace(/^(?:(?:\d{1,3}|[|!lI])\s?[.)]\s*(?=[\p{L}[("«“])|\d{1,3}\s+(?=\p{Lu}{3}))/u, '')
    if (!line || currencyLine.test(line)) continue
    if (skipPattern.test(line)) {
      // The tax line under an item, before the next one starts; never the receipt's total tax.
      if (!ended && last && items.at(-1) === last && vatPattern.test(line) && !totalPattern.test(line)) {
        const sum = vatSum(line)
        if (sum) (last as Parsed).vat = sum
      }
      settle()
      const value = amounts(line).filter(entry => entry.value >= scanLimits.minPrice).at(-1)?.value
      if (headerPattern.test(line) && value === undefined) unitPrices = unitPriceHeader.test(line) && !lineSumHeader.test(line)
      else if (totalPattern.test(line)) {
        if (value !== undefined) { total = value; serviceInTotal = discountInTotal = true }
      } else if (servicePattern.test(line)) {
        service = value ?? service; servicePercent = percentOf(line) ?? servicePercent; serviceInTotal = total === null
      } else if (discountPattern.test(line)) {
        discount = value ?? discount; discountInTotal = total === null
      } else if (subtotalPattern.test(line)) subtotal = value ?? subtotal
      // Whatever follows the totals is service, payment, change and fiscal data.
      if (value !== undefined && (totalPattern.test(line) || subtotalPattern.test(line))) ended = true
      continue
    }
    if (ended) continue
    const parsed = parseLine(line)
    // Among the dishes, a price line whose name OCR lost is kept for the owner to name.
    if (parsed && (parsed.name || names.length || parsed.certain || items.length)) {
      // A line for exactly the total borrowed from another reading is the total line misread ("ЗАМ!" for "JAMI").
      if (items.length && known?.total === lineSum(parsed)) { settle(); ended = true; continue }
      const inline = Boolean(parsed.name)
      if (inline) {
        // A name wrapped onto the price line goes on in lower case: "Logotipli paket Bio poelitilen 4 k" over "gacha ⇥ 1 ⇥ 400".
        if (names.length && /^\p{Ll}/u.test(parsed.name)) parsed.name = cleanName(`${names.pop()!.text} ${parsed.name}`)
        // A short line in title case right above a dish, such as "Кухня" or "Напитки", is a menu section.
        else if (/^\p{Lu}\p{Ll}/u.test(names.at(-1)?.text ?? '')) names.pop()
        settle()
      } else {
        // The name above the price starts at a numbered line; else, after a dish named on its own price line, it is
        // the last line (the ones before continue that dish); else it is every line since the previous dish.
        const numbered = names.findLastIndex(entry => entry.numbered)
        const from = numbered >= 0 ? numbered : last && lastNamedInline ? names.length - 1 : 0
        parsed.name = cleanName(names.slice(from).map(entry => entry.text).join(' '))
        names = names.slice(0, from)
        settle()
      }
      items.push(parsed); last = parsed; lastNamedInline = inline
      continue
    }
    // A size on its own line, as "0,5 l" under "Coca-Cola", belongs to the name.
    const name = nameOrEmpty(line) || (sizeLine.test(line) ? line : '')
    if (name && !amounts(line).some(entry => entry.value >= scanLimits.minPrice)) names.push({ text: name, numbered: fixed !== line })
    else settle()
  }
  settle()

  // What the dishes should add up to, most likely first; the first one they do add up to wins.
  const dearest = Math.max(0, ...items.map(lineSum))
  const plausible = (value: number | null) => value !== null && Math.round(value) >= dearest ? Math.round(value) : null
  const inTotal = (serviceInTotal ? service : 0) - (discountInTotal ? discount : 0)
  const candidates = [
    total !== null && servicePercent && !service && serviceInTotal ? total / (1 + servicePercent / 100) + discount : total === null ? null : total - inTotal,
    subtotal,
    total === null ? null : total - service + discount,
    total,
    known?.total ?? null,
  ].map(plausible).filter(value => value !== null)
  // Lines such as "Самса 2 22 000" read as a line sum unless the header says the column is the unit price, or the total
  // only adds up the other way.
  const asSums = items, asUnits = items.map(entry => entry.alt ? { ...entry, unitPrice: entry.alt } : entry)
  const readings = unitPrices ? [asUnits, asSums] : [asSums, asUnits]
  // Prices from the tax lines come last: they only win when the receipt's total agrees with them.
  if (items.some(entry => entry.vat && !close(lineSum(entry), entry.vat))) readings.push(...readings.map(entries => entries.map(withVat)))
  const options = candidates.flatMap(value => readings.map(entries => ({ value, entries })))
  const fit = options.find(({ value, entries }) => addsUp(entries, value))
    ?? options.map(({ value, entries }) => ({ value, entries: fixQuantity(entries, value) })).find(option => option.entries)
  const food = fit?.value ?? candidates[0] ?? null
  const chosen = fit?.entries ?? readings[0]
  markExtras(chosen, food)

  const cyrillicReceipt = isCyrillic(text)
  const base = food ?? sumOf(chosen)
  // The printed percent is exact; else it comes from the amount. Above half the food it is a misread number.
  const percent = servicePercent ?? (service && base ? service / base * 100 : null)
  return {
    items: chosen.map(({ name, quantity, unitPrice, unsure }) => ({ name: unifyScript(name, cyrillicReceipt), quantity, unitPrice, ...(unsure ? { unsure } : {}) })),
    total: food,
    servicePercent: percent !== null && percent > 0 && percent < 50 ? Math.round(percent) : known?.servicePercent ?? null,
  }
}

/** The checked dishes add up to the receipt's total. */
export function isComplete(result: ScanResult) {
  return result.total !== null && result.items.length > 0 && Math.abs(sumOf(result.items.filter(entry => !entry.unsure)) - result.total) <= result.items.length
}

/**
 * Readings are enough when the last one adds up, or when three of them found the same rows and total: those come from
 * at least two views of the photo, and more passes rarely change the answer then.
 */
export function settled(texts: string[]) {
  const results = texts.map(text => parseReceipt(text))
  const last = results.at(-1)
  if (!last) return false
  if (isComplete(last)) return true
  const key = (result: ScanResult) => JSON.stringify([result.total, result.items.map(entry => [entry.quantity, entry.unitPrice])])
  return last.items.length > 0 && results.filter(result => key(result) === key(last)).length >= 3
}

/**
 * Of several readings of one photo: the one that adds up to its total, else one that found a total, else the one with most
 * dishes. A reading that missed the total line borrows it from another, since each pass loses different lines.
 */
export function bestReading(texts: string[]) {
  const rank = (result: ScanResult) => (isComplete(result) ? 2000 : 0) + (result.total === null ? 0 : 1000) + result.items.length
  const readings = texts.map(text => ({ text, result: parseReceipt(text) }))
  const known = readings.map(reading => reading.result).filter(result => result.total !== null).sort((a, b) => rank(b) - rank(a))[0]
  return readings
    .map(reading => reading.result.total === null && known ? { text: reading.text, result: parseReceipt(reading.text, known) } : reading)
    .reduce((best, next) => rank(next.result) > rank(best.result) ? next : best)
}
