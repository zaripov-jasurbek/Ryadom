import { limits } from './limits'
import { scanLimits } from './receipt'

/** One line of the item table: the create page, the scanner's review and the item editor all use it. */
export type ItemRow = { id: number; name: string; quantity: number | null; price: number | null; suspect?: boolean }

// Same limits as add_item on the server.
export const blankRow = (row: ItemRow) => !row.name.trim() && !row.price
export const validRow = (row: ItemRow) => Boolean(row.name.trim()) && Number.isInteger(row.quantity) && row.quantity! >= 1 && row.quantity! <= scanLimits.maxQuantity && Number.isInteger(row.price) && row.price! >= 1 && row.price! <= limits.maxUnitPrice
/** Rows that will be saved: everything typed in. */
export const filledRows = <T extends ItemRow>(rows: T[]) => rows.filter(row => !blankRow(row))
export const rowsTotal = (rows: ItemRow[]) => rows.reduce((sum, row) => sum + (validRow(row) ? row.quantity! * row.price! : 0), 0)
export const toItems = (rows: ItemRow[]) => rows.map(row => ({ name: row.name.trim(), quantity: row.quantity!, unitPrice: row.price! }))
