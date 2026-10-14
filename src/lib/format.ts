import { limits } from './limits.ts'

export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10, m100 = n % 100
  return `${n} ${m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many}`
}

export const initial = (name: string) => name.slice(0, 1).toUpperCase()

/** A typed name as it is saved: no spaces at the ends, single spaces inside. */
export const cleanName = (name: string) => name.trim().replace(/\s+/g, ' ')
/** Two names are the same one whatever the case and spacing, like public.name_key on the server. */
export const sameName = (a: string, b: string) => cleanName(a).toLowerCase() === cleanName(b).toLowerCase()

/**
 * What is wrong with a name someone typed, or '' when it will do: from 2 to 24 characters, with letters,
 * and nobody else at the table called the same.
 */
export function nameProblem(name: string, taken: readonly string[] = []) {
  const value = cleanName(name)
  if (!value) return 'Напишите своё имя'
  if (value.length < limits.nameMin) return `Имя — хотя бы ${limits.nameMin} буквы`
  if (value.length > limits.nameMax) return `Имя — не длиннее ${limits.nameMax} символов`
  if (!/\p{L}/u.test(value)) return 'В имени должны быть буквы'
  if (taken.some(other => sameName(other, value))) return 'Такое имя уже есть в этом чеке — добавьте фамилию или первую букву'
  return ''
}

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

/** A card or phone number, as opposed to free text such as a bank name. */
const isNumberLike = (details: string) => /^[\d\s()+-]+$/.test(details)

/** Banking apps take a card or phone number without spaces; free text is copied as is. */
export const paymentCopyValue = (details: string) => isNumberLike(details) ? details.replace(/[\s()-]/g, '') : details
