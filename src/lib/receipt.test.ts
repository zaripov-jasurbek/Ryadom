import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseAmount, parseReceipt } from './receipt.ts'

describe('receipt amounts', () => {
  it('reads thousands separators and drops tiyin', () => {
    assert.equal(parseAmount('25 000,00'), 25000)
    assert.equal(parseAmount('25.000'), 25000)
    assert.equal(parseAmount('1 250 000'), 1250000)
    assert.equal(parseAmount('45000'), 45000)
    assert.equal(parseAmount('1,5'), 1.5)
  })
})

describe('receipt parsing', () => {
  it('reads a restaurant pre-check with quantity, price and total columns', () => {
    const text = `Ресторан «Афсона»
Стол 5 Официант: Дильноза
04.10.2026 21:15
Наименование Кол-во Цена Сумма
Плов чайханский 2 45 000 90 000
Лагман 1 38 000 38 000
Чай зелёный 3 5 000 15 000
Обслуживание 10% 14 300
Итого к оплате: 157 300`
    assert.deepEqual(parseReceipt(text), {
      items: [
        { name: 'Плов чайханский', quantity: 2, unitPrice: 45000 },
        { name: 'Лагман', quantity: 1, unitPrice: 38000 },
        { name: 'Чай зелёный', quantity: 3, unitPrice: 5000 },
      ],
      // Without the service charge: the bill adds its own.
      total: 143000,
      servicePercent: 10,
    })
  })

  it('repairs digits that OCR read as letters', () => {
    const { items } = parseReceipt(`Лепешка i 6 000 6 000
Лагман 1 38 OOO 38 OOO
Самса В 3 12 000 36 000
Манты 2 2О 000 4O 000
Шурпа T 32 000 32 000`)
    assert.deepEqual(items, [
      { name: 'Лепешка', quantity: 1, unitPrice: 6000 },
      { name: 'Лагман', quantity: 1, unitPrice: 38000 },
      { name: 'Самса', quantity: 3, unitPrice: 12000 },
      { name: 'Манты', quantity: 2, unitPrice: 20000 },
      { name: 'Шурпа', quantity: 1, unitPrice: 32000 },
    ])
  })

  it('writes look-alike Latin letters in Cyrillic on a Russian receipt, and back on an Uzbek one', () => {
    const russian = parseReceipt(`Плов чайханский 2 45 000 90 000
Camca 3 12 000 36 000
Лепешкa 1 6 000 6 000
Fanta 1 10 000 10 000
Итого к оплате: 142 000`).items.map(entry => entry.name)
    assert.deepEqual(russian, ['Плов чайханский', 'Самса', 'Лепешка', 'Fanta'])
    assert.deepEqual(parseReceipt(`Choy kok 1 5 000\nTovuq kabob 2 30 000 60 000\nСок 1 9 000`).items.map(entry => entry.name), ['Choy kok', 'Tovuq kabob', 'Cok'])
  })

  it('takes the name from the line above a fiscal "2 x 25 000,00" line', () => {
    const text = `Lavash tovuqli
2 x 25 000,00 = 50 000,00
QQS 12% 5 357,14
Coca-Cola 0,5
1 x 12 000,00 = 12 000,00
Jami: 62 000,00
Naqd: 62 000,00`
    assert.deepEqual(parseReceipt(text), {
      items: [
        { name: 'Lavash tovuqli', quantity: 2, unitPrice: 25000 },
        { name: 'Coca-Cola 0,5', quantity: 1, unitPrice: 12000 },
      ],
      total: 62000,
      servicePercent: null,
    })
  })

  it('handles two-number lines, sizes in names and weights', () => {
    const { items } = parseReceipt(`1. Самса 3 12 500
Плов 2 90 000
Шашлык 45 000 90 000
Cola 0,5 12 000
Хлеб 3000
Мясо 0,4 кг x 120 000`)
    assert.deepEqual(items, [
      { name: 'Самса', quantity: 3, unitPrice: 12500 },
      { name: 'Плов', quantity: 2, unitPrice: 45000 },
      { name: 'Шашлык', quantity: 2, unitPrice: 45000 },
      { name: 'Cola 0,5', quantity: 1, unitPrice: 12000 },
      { name: 'Хлеб', quantity: 1, unitPrice: 3000 },
      { name: 'Мясо', quantity: 1, unitPrice: 48000 },
    ])
  })

  it('keeps dishes whose names start like payment words', () => {
    const { items } = parseReceipt(`Картофель фри 1 18 000
Столичный салат 1 32 000
Оплата картой 50 000`)
    assert.deepEqual(items.map(entry => entry.name), ['Картофель фри', 'Столичный салат'])
  })

  it('ignores phone numbers, dates and noise without prices', () => {
    assert.deepEqual(parseReceipt(`Тел: +998 90 123 45 67
ИНН 301234567
Добро пожаловать!
12.09.2026 19:40
~~~ ---`), { items: [], total: null, servicePercent: null })
  })
})
