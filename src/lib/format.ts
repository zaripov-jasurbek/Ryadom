import type { PaymentStatus } from './calculations'

export const statusLabels: Record<PaymentStatus, string> = { unpaid: 'Не оплачено', partially_paid: 'Частично', proof_submitted: 'На проверке', paid: 'Оплачено' }

export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10, m100 = n % 100
  return `${n} ${m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many}`
}

const itemIcons: [RegExp, string][] = [[/пицц|pizza/, '🍕'], [/бургер|burger/, '🍔'], [/салат|salad/, '🥗'], [/хлеб|лепёш|лепеш|non|bread/, '🥖'], [/торт|десерт|cake|dessert/, '🍰'], [/кофе|coffee|латте|капуч/, '☕'], [/чай|tea/, '🍵'], [/пиво|beer/, '🍺'], [/вино|wine/, '🍷'], [/кола|cola|лимонад|сок|вода|drink|juice/, '🥤'], [/суп|шурп|soup/, '🍲'], [/плов|рис|plov/, '🍛'], [/шашлык|кебаб|мясо|стейк|kebab|steak/, '🍢'], [/паст|спагет|pasta/, '🍝'], [/суши|ролл|sushi/, '🍣']]
export const itemIcon = (name: string) => itemIcons.find(([pattern]) => pattern.test(name.toLowerCase()))?.[1] ?? '🍽️'
export const initial = (name: string) => name.slice(0, 1).toUpperCase()

export const createdDate = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' })
export const commentDate = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
