import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { RepeatIds } from './requests.ts'
import { shouldReloadForUpdate } from './update.ts'
import { joinState } from './join.ts'
import { errorMessage } from './errors.ts'

describe('ids for repeated requests', () => {
  const ids = () => { let n = 0; return new RepeatIds(() => `id${++n}`) }

  it('gives a repeat of the same action the same id until it goes through', () => {
    const requests = ids()
    const first = requests.take('items:1', [{ name: 'Плов', quantity: 2 }])
    assert.equal(requests.take('items:1', [{ name: 'Плов', quantity: 2 }]), first)
    requests.done('items:1')
    assert.notEqual(requests.take('items:1', [{ name: 'Плов', quantity: 2 }]), first)
  })

  it('gives changed arguments and other actions their own ids', () => {
    const requests = ids()
    const first = requests.take('items:1', ['Плов'])
    assert.notEqual(requests.take('items:1', ['Сок']), first)
    assert.notEqual(requests.take('items:2', ['Сок']), requests.take('items:1', ['Сок']))
  })
})

describe('reloading onto a new build', () => {
  it('reloads once a minute at most, and never offline', () => {
    assert.equal(shouldReloadForUpdate(true, null, 1_000_000), true)
    assert.equal(shouldReloadForUpdate(true, 1_000_000 - 30_000, 1_000_000), false)
    assert.equal(shouldReloadForUpdate(true, 1_000_000 - 61_000, 1_000_000), true)
    assert.equal(shouldReloadForUpdate(false, null, 1_000_000), false)
  })

  it('names a part of the app that did not load, offline or after a deploy', () => {
    for (const text of ['Failed to fetch dynamically imported module: https://x/assets/a.js', 'Importing a module script failed.', 'error loading dynamically imported module'])
      assert.equal(errorMessage(new TypeError(text), 'x'), 'Не удалось загрузить часть приложения — проверьте интернет и обновите страницу')
    assert.equal(errorMessage(new TypeError('Failed to fetch'), 'x'), 'Нет интернета — проверьте подключение и попробуйте ещё раз')
  })
})

describe('the join form', () => {
  it('holds back a taken name and a full table on a first try', () => {
    assert.match(joinState('aziz', ['Jasur', 'Aziz'], null, false).problem, /уже есть/)
    assert.equal(joinState('Bek', ['Jasur', 'Aziz'], 2, false).full, true)
    assert.deepEqual(joinState('Bek', ['Jasur'], 2, false), { problem: '', full: false })
  })

  it('lets a retry after a lost answer through, though its name and place are now its own', () => {
    assert.deepEqual(joinState('Aziz', ['Jasur', 'Aziz'], 2, true), { problem: '', full: false })
    assert.match(joinState('A', ['Jasur', 'Aziz'], 2, true).problem, /хотя бы/)
  })
})
