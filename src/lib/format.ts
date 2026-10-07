export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10, m100 = n % 100
  return `${n} ${m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many}`
}

export const initial = (name: string) => name.slice(0, 1).toUpperCase()

/** Three letters for someone who has not given a name: "XMA". */
export const randomName = () => Array.from({ length: 3 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('')

const fractions: [number, string][] = [[1 / 2, '½'], [1 / 3, '⅓'], [2 / 3, '⅔'], [1 / 4, '¼'], [3 / 4, '¾'], [1 / 5, '⅕'], [1 / 6, '⅙'], [1 / 8, '⅛']]
/** Servings someone has, with a shared one as a part: "3", "4½", "⅓"; an odd sum of parts is rounded to tenths. */
export function portionCount(count: number) {
  const whole = Math.floor(count + 1e-9), rest = count - whole
  if (rest < 1e-9) return String(whole)
  const glyph = fractions.find(([value]) => Math.abs(value - rest) < 1e-9)?.[1]
  return glyph ? `${whole || ''}${glyph}` : String(Math.round(count * 10) / 10).replace('.', ',')
}

export const createdDate = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' })
/** The name a check gets when the creator leaves it empty: «Ужин 4 октября». */
export function defaultTitle(now = new Date()) {
  const hour = now.getHours()
  return `${hour >= 5 && hour < 11 ? 'Завтрак' : hour >= 11 && hour < 16 ? 'Обед' : 'Ужин'} ${createdDate.format(now)}`
}
export const expiryDate = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })

/** A 16-digit card number reads in groups of four; anything else is shown as typed. */
export function formatPaymentDetails(details: string) {
  const digits = details.replace(/\s/g, '')
  return /^\d{16}$/.test(digits) ? digits.replace(/(\d{4})(?=\d)/g, '$1 ') : details
}

/** A card or phone number, as opposed to free text such as a bank name. */
export const isNumberLike = (details: string) => /^[\d\s()+-]+$/.test(details)

/** Banking apps take a card or phone number without spaces; free text is copied as is. */
export const paymentCopyValue = (details: string) => isNumberLike(details) ? details.replace(/[\s()-]/g, '') : details
