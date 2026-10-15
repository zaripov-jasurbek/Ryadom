import { nameProblem } from './format.ts'

/**
 * What holds back the join button: a problem with the typed name, and a table with no free place.
 * After a try that failed without the server refusing it (a lost answer), this browser may already be at the table
 * under that name, in what looks like the last place. The retry goes in by its saved token, so then the page checks
 * only the name itself and leaves the rest to the server.
 */
export function joinState(name: string, taken: readonly string[], expected: number | null, retrying: boolean) {
  return {
    problem: nameProblem(name, retrying ? [] : taken),
    full: !retrying && expected !== null && taken.length >= expected,
  }
}
