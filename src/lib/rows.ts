import { limits } from './limits'
import { scanLimits } from './receipt'

/** One line of the item table: the create page, the scanner's review and the item editor all use it. */
export type ItemRow = { id: number; name: string; quantity: number | null; price: number | null; suspect?: boolean }

// Same limits as add_item on the server.
export const blankRow = (row: ItemRow) => !row.name.trim() && !row.price
export const validRow = (row: ItemRow) => rowProblem(row) === null
/** The first field of a row that stops it from being saved, or null for a good row. */
export function rowProblem(row: ItemRow): 'name' | 'quantity' | 'price' | null {
  if (!row.name.trim()) return 'name'
  if (!(Number.isInteger(row.quantity) && row.quantity! >= 1 && row.quantity! <= scanLimits.maxQuantity)) return 'quantity'
  if (!(Number.isInteger(row.price) && row.price! >= 1 && row.price! <= limits.maxUnitPrice)) return 'price'
  return null
}
/** What is wrong with a row, said under the table when the form is sent with it. */
export function rowProblemText(row: ItemRow) {
  switch (rowProblem(row)) {
    case 'name': return 'нет названия'
    case 'quantity': return `количество от 1 до ${scanLimits.maxQuantity}`
    case 'price': return row.price === null ? 'нет цены' : 'цена — целое число больше нуля'
    default: return ''
  }
}
/** Rows that will be saved: everything typed in. */
export const filledRows = <T extends ItemRow>(rows: T[]) => rows.filter(row => !blankRow(row))
export const rowsTotal = (rows: ItemRow[]) => rows.reduce((sum, row) => sum + (validRow(row) ? row.quantity! * row.price! : 0), 0)
export const toItems = (rows: ItemRow[]) => rows.map(row => ({ name: row.name.trim(), quantity: row.quantity!, unitPrice: row.price! }))
