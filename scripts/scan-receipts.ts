// Measures the receipt scanner on real photos: runs src/lib/ocr.ts and src/lib/receipt.ts in headless Chromium exactly as the
// app does and compares the rows with what is printed on each receipt.
//
//   node scripts/scan-receipts.ts [name ...] [--all] [--text]
//
// Photos and their rows live in receipts/ (private, not in git): receipts/expected.json maps a photo's file name to
// { total, servicePercent, items: [[name, quantity, unitPrice], ...] }. --all reads every view of the photo instead of stopping
// once the readings settle, and scores each reading; --text prints the chosen reading. Chromium is $CHROMIUM or Playwright's.
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'vite'

type Expected = { area: [number, number][]; total: number | null; servicePercent: number | null; items: [string, number, number][] }
type Item = { name: string; quantity: number; unitPrice: number; unsure?: boolean }
type Result = { items: Item[]; total: number | null; servicePercent: number | null }
type Scan = { ms: number; text: string; result: Result; readings: { text: string; result: Result }[] }

const args = process.argv.slice(2)
const all = args.includes('--all'), showText = args.includes('--text')
const expected: Record<string, Expected> = JSON.parse(readFileSync('receipts/expected.json', 'utf8'))
const names = args.filter(arg => !arg.startsWith('--'))
const photos = Object.keys(expected).filter(name => !names.length || names.some(part => name.includes(part)))

/** Edit distance on letters and digits only, case-insensitive, as a share of the longer name. */
function nameDistance(a: string, b: string) {
  const norm = (text: string) => text.toLowerCase().replace(/[^\p{L}\d]/gu, '')
  const x = norm(a), y = norm(b)
  let row = Array.from({ length: y.length + 1 }, (_, i) => i)
  for (let i = 1; i <= x.length; i++) {
    const next = [i]
    for (let j = 1; j <= y.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1))
    row = next
  }
  return row[y.length] / Math.max(1, x.length, y.length)
}

/** Pairs every printed row with a scanned one of the same quantity and price, the closest name first. */
function score(want: Expected, got: Result) {
  const left = got.items.filter(item => !item.unsure)
  let rows = 0, names = 0
  const missed: string[] = []
  for (const [name, quantity, unitPrice] of want.items) {
    const same = left.filter(item => item.quantity === quantity && item.unitPrice === unitPrice)
    const match = same.sort((a, b) => nameDistance(a.name, name) - nameDistance(b.name, name))[0]
    if (!match) { missed.push(`${name} ${quantity}×${unitPrice}`); continue }
    rows++
    if (nameDistance(match.name, name) <= .25) names++
    left.splice(left.indexOf(match), 1)
  }
  return {
    rows, names, extra: left.length, missed, of: want.items.length,
    total: got.total === want.total, service: got.servicePercent === want.servicePercent,
    exact: rows === want.items.length && !left.length,
  }
}

async function chromium() {
  const dir = mkdtempSync(join(tmpdir(), 'scan-receipts-'))
  const browser = spawn(process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${dir}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  const endpoint = await new Promise<string>((resolve, reject) => {
    let log = ''
    browser.stderr.on('data', chunk => {
      log += chunk
      const found = /DevTools listening on (ws:\/\/\S+)/.exec(log)
      if (found) resolve(found[1])
    })
    browser.on('exit', code => reject(new Error(`Chromium exited with ${code}:\n${log}`)))
  })
  const exited = new Promise(resolve => browser.once('exit', resolve))
  return { endpoint, close: async () => { browser.kill(); await exited; rmSync(dir, { recursive: true, force: true }) } }
}

/** A minimal DevTools protocol client for one page. */
async function openPage(endpoint: string, url: string) {
  const http = endpoint.replace(/^ws:\/\/([^/]+).*$/, 'http://$1')
  const target = await (await fetch(`${http}/json/new?${url}`, { method: 'PUT' })).json() as { webSocketDebuggerUrl: string }
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }))
  let id = 0
  const pending = new Map<number, (message: { result?: unknown; error?: { message: string } }) => void>()
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data))
    if (message.id) pending.get(message.id)?.(message)
    else if (message.method === 'Runtime.exceptionThrown') console.error(message.params.exceptionDetails.text)
  })
  const send = (method: string, params: object = {}) => new Promise<any>((resolve, reject) => {
    const key = ++id
    pending.set(key, message => { pending.delete(key); if (message.error) reject(new Error(message.error.message)); else resolve(message.result) })
    socket.send(JSON.stringify({ id: key, method, params }))
  })
  await send('Runtime.enable')
  const evaluate = async <T>(expression: string): Promise<T> => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
    return result.value
  }
  return { evaluate, close: () => socket.close() }
}

const server = await createServer({ logLevel: 'error', server: { port: 0 } })
await server.listen()
const origin = server.resolvedUrls!.local[0].replace(/\/$/, '')
const browser = await chromium()
try {
  const page = await openPage(browser.endpoint, `${origin}/receipts/expected.json`)
  // Waits for the page, so the modules below load from the dev server.
  for (let i = 0; i < 100 && await page.evaluate<string>(`location.origin === ${JSON.stringify(origin)} && document.readyState`) !== 'complete'; i++) await new Promise(resolve => setTimeout(resolve, 100))
  const totals = { rows: 0, of: 0, names: 0, extra: 0, exact: 0, total: 0, service: 0, ms: 0 }
  const report: Record<string, unknown> = {}
  for (const photo of photos) {
    const scan = await page.evaluate<Scan>(`(async () => {
      const { recognizeReceipt } = await import('/src/lib/ocr.ts')
      const { bestReading, parseReceipt, settled } = await import('/src/lib/receipt.ts')
      const file = await (await fetch(${JSON.stringify(`/receipts/${photo}`)})).blob()
      const started = performance.now()
      const area = ${JSON.stringify(expected[photo].area.map(([x, y]) => ({ x, y })))}
      const texts = await recognizeReceipt(file, area, () => {}, new AbortController().signal, ${all ? '() => false' : 'settled'})
      const { text, result } = bestReading(texts)
      return { ms: performance.now() - started, text, result, readings: texts.map(text => ({ text, result: parseReceipt(text) })) }
    })()`)
    const want = expected[photo], got = score(want, scan.result)
    report[photo] = { ...got, ms: Math.round(scan.ms), result: scan.result, text: scan.text, readings: scan.readings.map(reading => reading.text) }
    totals.rows += got.rows; totals.of += got.of; totals.names += got.names; totals.extra += got.extra
    totals.exact += +got.exact; totals.total += +got.total; totals.service += +got.service; totals.ms += scan.ms
    console.log(`${got.exact ? '✓' : '✗'} ${photo.padEnd(26)} rows ${got.rows}/${got.of}  names ${got.names}/${got.of}  extra ${got.extra}  total ${got.total ? 'ok' : `${scan.result.total}≠${want.total}`}  service ${got.service ? 'ok' : `${scan.result.servicePercent}≠${want.servicePercent}`}  ${(scan.ms / 1000).toFixed(1)}s  ${scan.readings.length} reads`)
    for (const row of got.missed) console.log(`    missed ${row}`)
    for (const item of scan.result.items) if (!want.items.some(([, quantity, unitPrice]) => quantity === item.quantity && unitPrice === item.unitPrice)) console.log(`    got    ${item.name} ${item.quantity}×${item.unitPrice}${item.unsure ? ' (unsure)' : ''}`)
    if (all) scan.readings.forEach((reading, i) => {
      const each = score(want, reading.result)
      console.log(`    read ${i}: rows ${each.rows}/${each.of} names ${each.names} extra ${each.extra} total ${reading.result.total}`)
    })
    if (showText) console.log(scan.text.replace(/^/gm, '    | '))
  }
  console.log(`\nrows ${totals.rows}/${totals.of}  names ${totals.names}/${totals.of}  extra ${totals.extra}  exact ${totals.exact}/${photos.length}  totals ${totals.total}/${photos.length}  service ${totals.service}/${photos.length}  ${(totals.ms / 1000).toFixed(0)}s`)
  writeFileSync('receipts/results.json', JSON.stringify(report, null, 2))
  page.close()
} finally {
  await browser.close()
  await server.close()
}
