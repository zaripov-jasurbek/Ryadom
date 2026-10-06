import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { bestReading, isComplete, parseAmount, parseReceipt, settled } from './receipt.ts'

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

// Readings of restaurant bills, a shop app and a fiscal receipt by the current OCR: tabs mark wide gaps between columns.
const restaurant = `olo Hovuz -———- Bolo Hovuz
g\tИНН
:\tГОСТЕВОЙ СЧЕТ
@\t‚ал:\tТерасса\tСтол; 20
B\t16.09.2026 12:44\tЗаказ № 54
a\t('фициант: МИРШОД
@ — Наименование\tКол-во\tСумма
Ш — Чай чёрный с лимоном\t1\t15 000
E\txneb ЛЕПЕШКА\t2\t16 000
B\tUyn БАЛАЗА\t1\t42 000
G\tЧЕБУРЕК ГОВЯЖИЙ 4 шт\t1\t35 000
(ЛОТ САМСА С МЯСОМ\t2\t28 000
| ИЖДУВОН ЖИЗ С КАРТОФЕЛЕ\t1\t105 000
B\tМИ ЛУКОМ порц (250гр)
(Ш САМАРКАНД\t1\t55 000
(Ш ПОСУДА\t1\t2 000
Ш\t— АЧИЧУК\t1\t25 000
5\t1\t2 000
Полная сумма:\t325 000
Надбавка "15%" (+15%):\t+48 750
ИТОГО К ОПЛАТЕ:\t373 750
СПАСИБО! ЖДЕМ ВАС СНОВА!`

const brasserie = `Ш\tPASTRIE & САЕЕ —
MINOR
ara;\t08.09.2026 14:31
Офищиант:\tХасан
Счет №:\tАб8
Стол №:\t31, Дополнительный
Кол-во гостей:\t2
Наименование\tКол-во\tСумма
Самса
Самса Слоеная с Ma\t2\t22 000
сом
Кальяны
Кальян до 17:00\tab\t99 000
Кухня
Куриная грудка в г\t1\t75 000
рибном соусе
*Чикен карри Brass\t2\t120 000
'Бефстроганов Вхаз\tШ\t85 000
Сумма:\t401-000
Обслуживание : 16%\t64 160
Скидка: 10%\t40 100
425 060`

const korzinka = `16:04\t18
м — Готово
SAVDO СНЕК! № 160\t05/10/2026 15:22:15
ED 1из 2\tto'r
1. Huzurb.obaki Halls asl 33g
2donat4 990,00 = 9 980,00
Освеж. леденцы Halls оригинальный ЗЗг
Shu jumladan QQS 12%: 1 069,29
Sh.k./MXIK 7622202051234/01704001016135014
2. Ichimlik energ.Gorilla t/i
450ml
11 990,00
Напиток энергетик Gorilla ж/б 450mn
Shu jumladan QQS 12%: 1 284,64
Sh.k./MXIK 4870022003305/02202003001006014
3. Ener.ichim.Adrenaline mango
t/i 449ml
15 990,00
с вк.манго ж/б 449мл
Shu jumladan QQS 12%: 1 713,21
Sh.k./MXIK 4780022622270/02202003001091001
MK\t01047800226222702171d9XCj;C9"jf
TO'LOV UCHUN:\t37 960,00
Shu jumladan QQS\t4 067,14
To'landi (Korzinka):\t37 960,00
С\t©!`

const fiscalFirst = `STIR: 312534214\tС-№: 68891
Chek №:\t49428\t05 10.2026\tA
KASSA:\tKassa-1\t16:37\t3
Sotuvchi: Narimov To'lagan\ti
Samsa\tA\t1*5,000=5,000
sh.j qqs 0%\t9\t3
Sh.k / SKU\t110244
MXIK\t02106999999000000
Qadaq kadi\t1632942
Шакар кушилмаган\t1*12,000=12,000\t|
сакич Cools Пластинка
формадаги сакич ялпиз
таъмли, Пластик\t;
футляр 95 г.\ti
sh.j 995 0%\t0\t:
Sh.k / SKU\t4780050330017 /
MXIK\t02106999018019002
Qadaq kadi\t1329158
Печенье Юбилейное\t1*8,000=8,000
традиционное 112гр
sh.j aqs 0%\t0
Sh.k / SKU\t7622210457554 / 13106
:\tMXIK\t02106999999000000
Qadaoq kadi\t1514409
Кефир Доброе Био\t1*17,000=17,000
g\tКефир 1% 1000 гр
sh.j 995 0%\t0
Et\tSh.k / SKU\t4780104700797 / 10505
bi\tMXIK\tP2106999999000000
3\tQadaq Кой\t1514409
ЗАМ!\t42,000
g\tSHU JUMLADAN QQS\t0
Naad\t42,000
Bank kartasi turi\tShaxsiy
я\tJO'LANDI:\t42,000
р\tел\tГВ: 344038933636
@\t"Л\tVersiya: 0.2
bi\t"
||\tЧ
| |
в\tU
Г] I\tве\tГ)
=”\to
ОР
|`

const fiscalSecond = `С-№: 68891
05.10.2026
16:37
STIR: 312534214
Chek №:\t49428
KASSA:\tКа$$а-1
Sotuvchi: Narimov To'lagan
-
.„ -\t*
„
sh.j qqs 0%
Sh к / SKU\t110244
MXIK\t02106999999000000
Qadaq kadi\t1632942
Шакар кушилмаган\t1*12,000=12,000
сакич Соо!$ Пластинка
формадаги сакич ялпиз
таъмли, Пластик
футляр 95 г.
sh.j 995 0%\t0
Sh.k / SKU\t4 78005033001 7 / 1003/
MXIK\t02106999018019002
Qadaq kadi\t1329158
Печенье Юбилейное\t1*8,000=8,000
традиционное 112гр
sh.j aqs 0%\t0
Sh.k / SKU\t7622210457554 / 13106
MXIK\t02106999999000000
Qadaoq kadi\t1514409
Кефир Доброе Био
Кефир 1% 1000 гр
1*17,000=17,000
sh.j 995 0%\t0
sh.k / SKU\t4780104700797 / 10505
MXIK\t02106999999000000
Qadaq Кой\t1514409
JAMI\t42,000
SHU JUMLADAN QQS\t0
Мааса\t42 000
Bank kartasi turi\tShaxsiy
JO'LANDI:\t42,000
FM: 16420211629245\tFB: 344038933636
S/R: q-1\tVersiya: 0.2`

// A screenshot of an electronic receipt: "Narxi" is the line sum here, a wrapped name lost its second line and the
// pieces of the bag read as "7".
const shopApp = `Nomi\tSoni\tNarxi
Limonad B fresh Olma, 450ml\t1\t10,990.00
Limonad В fresh Apelsin, 450ml\t1\t10,990.00
Sharbatli ichBe Fresh mangot/i 450ml\t1\t10,990.00
Saqich Orbit Tetiklash yalpiz 136g\t2\t8,180.00
Ichimlik Flavis anor t/i 450ml\t1\t9,990.00
Uzaytirgich Tekled 5x3 dona\t1\t68,990.00
Shokoladli kruassan Le Kroshe 100g\t1\t15,990.00
но он раке! Bio\t4 К\t7\t400.00
Naqd pul\t0.00
Bank kartalari\t136,520.00
Jami to'lov\t136,520.00`

// A Korzinka fiscal receipt: an address with a house number, sizes such as "5x3", names with the price on their line
// and a Russian translation below, and the total whose "TO'LOV" OCR lost.
const korzinkaLong = `«Anglesey Food» MChJ XK
K083 Korzinka - Shahriston
Toshkent, Amir Temur shoh ko'chasi, 112-uy
STIR: 202099756\tS/N: STS-20230505-000157
KASSIR: o'z o'ziga xizmat\tPOS N 10
SAVDO CHEKI N 153\t06/10/2026 15:38:14
So'm
1. Saqich Orbit Tetiklash. yalpiz 13.6g
2dona*4 090,00 = 8 180,00
Жев. резинка Orbit Освежающая мята 13,6г
Shu jumladan QQS 12%: 876,43
Sh.k./MXIK\t42069942/02106999018092023
2. Uzaytirgich Tekled 5x3 dona\t68 990,00
Удлинитель Tekled 5x3 шт
Shu jumladan QQS 12%: 7 391,79
3. Shokoladli kruassan Le Kroshe 100g
15 990,00
Круассан с шоколадом Le Kroshe 100г
Shu jumladan QQS 12%: 1 713,21
4. Logotipli paket Bio poelitilen 4 k gacha
400,00
Пакет с логотипом Био-поэлитилен до 4кг
Shu jumladan QQS 12%: 42,86
5. Limonad B fresh Olma, 450ml\t10 990,00
Лимонад B fresh Яблоко, 450мл
Shu jumladan QQS 12%: 1 177,50
MK\t010478007266055O217kO-fhL>dHN):
6. Limonad B fresh Apelsin, 450ml\t10 990,00
Лимонад B fresh Апельсин, 450мл
Shu jumladan QQS 12%: 1 177,50
7. Sharbatli ich.Be Fresh mango.t/i 450ml
10 990,00
Напиток сок. Be Fresh манго ж/б 450мл
Shu jumladan QQS 12%: 1 177,50
8. Ichimlik Flavis anor t/i 450ml\t9 990,00
Напиток Flavis гранат ж/б 450мл
Shu jumladan QQS 12%: 1 070,36
UCHUN:\t136 520,00
Shu jumladan QQS\t14 627,15
To'landi (Click):\t136 520,00
To'lov shakli:\tPlastik karta
Karta turi:\tShaxsiy
Korzinka Plus kartasi bilan
1365`

const lineTotals = (text: string) => parseReceipt(text).items.map(entry => [entry.quantity, entry.unitPrice])

describe('real receipts in columns', () => {
  it('reads a guest bill with quantity and line sum columns, edge specks and "Надбавка" as service', () => {
    const result = parseReceipt(restaurant)
    assert.deepEqual(result.items.map(entry => [entry.quantity, entry.unitPrice]), [
      [1, 15000], [2, 8000], [1, 42000], [1, 35000], [2, 14000], [1, 105000], [1, 55000], [1, 2000], [1, 25000], [1, 2000],
    ])
    // A name printed over two lines is joined; a row whose name OCR lost stays for the owner to name.
    assert.match(result.items[5].name, /КАРТОФЕЛЕ М ?И ЛУКОМ/)
    assert.equal(result.items[9].name, '')
    assert.equal(result.total, 325000)
    assert.equal(result.servicePercent, 15)
    assert.ok(isComplete(result))
  })

  it('keeps "2 ⇥ 120 000" apart, skips menu sections, and adds a discount back to the total', () => {
    const result = parseReceipt(brasserie)
    assert.deepEqual(result.items.map(entry => [entry.quantity, entry.unitPrice]), [[2, 11000], [1, 99000], [1, 75000], [2, 60000], [1, 85000]])
    assert.match(result.items[0].name, /^Самса Слоеная с М. сом$/)
    assert.match(result.items[1].name, /^Кальян до 17:00/)
    assert.equal(result.items[2].name, 'Куриная грудка в рибном соусе')
    // "Сумма: 401-000" is the subtotal; 425 060 = 401 000 + 16% service − 10% discount.
    assert.equal(result.total, 401000)
    assert.equal(result.servicePercent, 16)
  })

  it('takes names from above the price and leaves out the Russian translation below', () => {
    const result = parseReceipt(korzinka)
    assert.deepEqual(result.items, [
      { name: 'Huzurb.obaki Halls asl 33g', quantity: 2, unitPrice: 4990 },
      { name: 'Ichimlik energ.Gorilla t/i 450ml', quantity: 1, unitPrice: 11990 },
      { name: 'Ener.ichim.Adrenaline mango t/i 449ml', quantity: 1, unitPrice: 15990 },
    ])
    assert.equal(result.total, 37960)
  })

  it('picks the reading that adds up, borrowing the total another reading found', () => {
    // The first reading has every dish but misread "JAMI"; the second lost "Samsa" but has the total.
    assert.equal(parseReceipt(fiscalFirst).total, null)
    const { text, result } = bestReading([fiscalSecond, fiscalFirst])
    assert.equal(text, fiscalFirst)
    assert.deepEqual(result.items.map(entry => entry.unitPrice), [5000, 12000, 8000, 17000])
    assert.equal(result.total, 42000)
    assert.ok(isComplete(result))
  })

  it('skips the bank card line, keeps sizes in names and fixes the one quantity the total disagrees with', () => {
    const result = parseReceipt(shopApp)
    assert.deepEqual(result.items.map(entry => [entry.quantity, entry.unitPrice]), [
      [1, 10990], [1, 10990], [1, 10990], [2, 4090], [1, 9990], [1, 68990], [1, 15990], [1, 400],
    ])
    assert.equal(result.items[5].name, 'Uzaytirgich Tekled 5x3')
    assert.equal(result.total, 136520)
    assert.ok(isComplete(result))
  })

  it('reads a long fiscal receipt without the address, translations or sizes as pieces', () => {
    const result = parseReceipt(korzinkaLong)
    assert.deepEqual(result.items, [
      { name: 'Saqich Orbit Tetiklash. yalpiz 13.6g', quantity: 2, unitPrice: 4090 },
      { name: 'Uzaytirgich Tekled 5x3', quantity: 1, unitPrice: 68990 },
      { name: 'Shokoladli kruassan Le Kroshe 100g', quantity: 1, unitPrice: 15990 },
      { name: 'Logotipli paket Bio poelitilen 4 k gacha', quantity: 1, unitPrice: 400 },
      { name: 'Limonad B fresh Olma, 450ml', quantity: 1, unitPrice: 10990 },
      { name: 'Limonad B fresh Apelsin, 450ml', quantity: 1, unitPrice: 10990 },
      { name: 'Sharbatli ich.Be Fresh mango.t/i 450ml', quantity: 1, unitPrice: 10990 },
      { name: 'Ichimlik Flavis anor t/i 450ml', quantity: 1, unitPrice: 9990 },
    ])
    assert.equal(result.total, 136520)
  })

  it('takes the price from the tax line under it when OCR misread the price and the total agrees', () => {
    const misread = korzinkaLong.replace('15 990,00', '5 990,00')
    const price = (text: string) => parseReceipt(text).items.find(entry => entry.name.startsWith('Shokoladli'))!.unitPrice
    assert.equal(price(misread), 15990)
    assert.ok(isComplete(parseReceipt(misread)))
    // Without the total nothing tells which one is right, and a cut-off tax is no evidence.
    assert.equal(price(misread.replace('UCHUN:\t136 520,00\n', '')), 5990)
    assert.equal(price(misread.replace('1 713,21', '1 713')), 5990)
  })

  it('stops reading again once a reading adds up, or three readings agree', () => {
    assert.equal(settled([]), false)
    assert.equal(settled([shopApp]), true)
    const partial = 'Плов\t1\t45 000\nЧай\t1\t5 000'
    assert.equal(settled([partial, partial]), false)
    assert.equal(settled([partial, 'Плов\t1\t45 000', partial]), false)
    assert.equal(settled([partial, partial, partial]), true)
    assert.equal(settled(['ИНН 301234567', 'ИНН 301234567', 'ИНН 301234567']), false)
  })

  it('keeps the column apart in a line with no OCR tabs but two spaces', () => {
    assert.deepEqual(lineTotals('*Чикен карри  2  120 000\nИтог: 120 000'), [[2, 60000]])
  })
})

describe('receipt columns and totals', () => {
  it('reads "Кол-во ⇥ Цена" as the price of one piece', () => {
    assert.deepEqual(lineTotals('Наименование\tКол-во\tЦена\nСамса\t2\t11 000\nЧай\t2\t5 000'), [[2, 11000], [2, 5000]])
  })

  it('reads the last column as a line sum by default, and as a unit price when only that adds up to the total', () => {
    assert.deepEqual(lineTotals('Самса\t2\t22 000\nЧай\t2\t10 000\nИтого: 32 000'), [[2, 11000], [2, 5000]])
    assert.deepEqual(lineTotals('Самса\t2\t11 000\nЧай\t2\t5 000\nИтого: 32 000'), [[2, 11000], [2, 5000]])
  })

  it('does not take service printed after the total out of it', () => {
    assert.deepEqual(parseReceipt('Плов\t1\t100 000\nИтого: 100 000\nОбслуживание 10%: 10 000'), {
      items: [{ name: 'Плов', quantity: 1, unitPrice: 100000 }], total: 100000, servicePercent: 10,
    })
  })

  it('takes the service percent printed without an amount out of the total', () => {
    const result = parseReceipt('Плов\t1\t100 000\nОбслуживание 10%\nИтого к оплате: 110 000')
    assert.equal(result.total, 100000)
    assert.equal(result.servicePercent, 10)
  })

  it('keeps dishes that start like receipt words', () => {
    assert.deepEqual(lineTotals('Открытый пирог\t1\t30 000\nКассата\t1\t25 000\nСменный гарнир\t1\t8 000'), [[1, 30000], [1, 25000], [1, 8000]])
  })

  it('takes a name over several lines above the price from its row number', () => {
    const { items } = parseReceipt(`1. Lavash tovuqli
katta
2 x 25 000,00 = 50 000,00
2. Coca-Cola
0,5 l
1 x 12 000,00 = 12 000,00
Jami: 62 000,00`)
    assert.deepEqual(items.map(entry => entry.name), ['Lavash tovuqli katta', 'Coca-Cola 0,5 l'])
  })

  it('joins a name wrapped onto the price line in lower case', () => {
    assert.deepEqual(parseReceipt('Shokoladli kruassan\t1\t15,990.00\nLogotipli paket Bio poelitilen 4 k\ngacha\t1\t400.00').items.map(entry => entry.name),
      ['Shokoladli kruassan', 'Logotipli paket Bio poelitilen 4 k gacha'])
  })

  it('reads the price before the pieces', () => {
    assert.deepEqual(lineTotals('Шашлык 45 000 x 2'), [[2, 45000]])
  })
})
