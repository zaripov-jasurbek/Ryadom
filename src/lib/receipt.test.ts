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

// Text that Tesseract returned for real receipts photographed on a phone.
describe('real receipts', () => {
  it('reads a shop receipt with "1,000*39000,00" and stops at the total', () => {
    const text = `"КМОКА"
Старший кассир 2
ПРОДАЖА Смена №197
05.10.2026
1 ДОМАШНИЕ ТАПОЧКИ (39000) —
1,000*39000,00 39000,00
17:43:02
Позиций: Е Покупок: 1
Сумма: 39000,00
Сумма скидки: 0,00
Итоговая сумма: 39000,00
Место расчетов: Магазин "KIVORA"
100135 Республика Узбикистан, г. Ташкент,
пр-кт Бунёдкор, д.52
Biz sizni har doim
ko'rishdan xursandmiz!!!`
    assert.deepEqual(parseReceipt(text), {
      items: [{ name: 'ДОМАШНИЕ ТАПОЧКИ', quantity: 1, unitPrice: 39000 }],
      total: 39000,
      servicePercent: null,
    })
  })

  it('reads weighed goods at their line total and skips article and receipt numbers', () => {
    const text = `ус:
(< SIFAT VA QULAY NARX
Касса №6 Кассир
ПРОДАЖА №00944772 XUDOYOROVA MOXIRA
Дата: 05.10.26 Время: 17:49:26
|. [59694] (Р- -R "OLMA GOLDEN” KG)
0,35 x 16675,00 = 5802,90 сум
2.[59750] "BANAN" Кб)
1,80 х 16850,00 = 30363,70 сум
ИТОГО: 36 167
Оплата
Сдача
313226708
Terminal IDE
Fiskal Belgi 182096430004`
    const { items, total } = parseReceipt(text)
    assert.deepEqual(items.map(entry => [entry.quantity, entry.unitPrice]), [[1, 5803], [1, 30364]])
    assert.match(items[0].name, /OLMA GOLDEN$/)
    assert.match(items[1].name, /^BANAN/)
    assert.equal(total, 36167)
  })

  it('joins names printed over several lines and ignores SKU, codes and weights', () => {
    const text = `С-№: 68891
05.10.2026
16:37
STIR: 312534214
Спек №: 49428
KASSA: Kassa-1
Sotuvchi: Narimov To'lagan
...
o 1+6.000=5,000
sh.j qas 0%
hi / 10244
02106999999000000
Qadaq kadi 1632942
Шакар кушилмаган 1*12,000=12,000
сакич Соо!$ Пластинка
формадаги сакич ялпиз
таъмли, Пластик
футляр 95 г.
sh.j 995 0% 0
Sh.k /SKU 4780050330017 / 1003/
MXIK 02106999018019002
Qadaoq kadi 1329158
Печенье Юбилейное 1*8,000=8,000
градиционное 112гр
sh.j aqs 0% 0
Sh.k / SKU 762221045 7554 / 13106
МЖК 021069999990000009
Qadaoq kadi 1514409
Кефир Доброе Био 1*17,000=17,000
Кефир 1% 1000 гр
sh.j aqs 0% 0
Sh.k / SKU 4780104700797 / 10505
MXIK 02106999999000000
Qadaq kodi 1514409
JAMI 42,000
SHU JUMLADAN QQS 0
Naad 42,000
Bank kartasi turi Shaxsiy
JO'LANDI: 42,000
ГМ: 16420211623245 ГВ: 344038933636
S/R: 4-2 Versiya: 0.2`
    const { items, total } = parseReceipt(text)
    assert.deepEqual(items.map(entry => [entry.quantity, entry.unitPrice]), [[1, 5000], [1, 12000], [1, 8000], [1, 17000]])
    // The name of the first one was unreadable; the line "1 x 5 000 = 5 000" is kept for the owner to name.
    assert.equal(items[0].name, '')
    assert.match(items[1].name, /^Шакар кушилмаган сакич .* Пластик$/)
    assert.equal(items[2].name, 'Печенье Юбилейное градиционное 112гр')
    assert.equal(items[3].name, 'Кефир Доброе Био Кефир 1% 1000 гр')
    assert.equal(total, 42000)
  })

  it('unchecks the one row without which the dishes add up to the total', () => {
    const { items } = parseReceipt(`OLMA GOLDEN
0,35 x 16675,00 = 5802,90 сум
BANAN
1,80 x 16850,00 = 30363,70 сум
Оби a a AAA3253,25
ИТОГО: 36 167`)
    assert.deepEqual(items.map(entry => [entry.unitPrice, Boolean(entry.unsure)]), [[5803, false], [30364, false], [3253, true]])
  })

  it('leaves rows checked when the total cannot tell which one is extra', () => {
    const { items } = parseReceipt(`Чай 1 5 000\nЧай 1 5 000\nСамса 1 6 000\nИтого: 11 000`)
    assert.ok(items.every(entry => !entry.unsure))
  })
})
