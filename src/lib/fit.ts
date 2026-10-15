import { flushSync } from 'svelte'

/** One line that can be drawn at several densities, densest last, and can say whether it fits as drawn. */
export type Fitter = { levels: number; set: (level: number) => void; fits: () => boolean }

const waiting = new Set<Fitter>()
let scheduled = false

/**
 * Picks the first density that fits, for every line that asked since the last run, all together:
 * each step redraws all of them once and then measures all of them, so a check of 100 lines costs
 * three layouts instead of three per line. It runs in a microtask, still before the screen is painted.
 */
export function requestFit(fitter: Fitter) {
  waiting.add(fitter)
  if (scheduled) return
  scheduled = true
  queueMicrotask(run)
}

export function cancelFit(fitter: Fitter) { waiting.delete(fitter) }

function run() {
  scheduled = false
  let pending = [...waiting]
  waiting.clear()
  for (let level = 0; pending.length; level++) {
    for (const fitter of pending) fitter.set(level)
    flushSync()
    // All reads after all writes: only the first one makes the browser lay the page out.
    pending = pending.filter(fitter => level < fitter.levels - 1 && !fitter.fits())
  }
}
