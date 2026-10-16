# Changelog

## [2.8.3](https://github.com/zaripov-jasurbek/Ryadom/compare/v2.8.2...v2.8.3) (2026-10-16)


### Исправления

* **scan:** revert keeping digits inside dish names ([ce60f88](https://github.com/zaripov-jasurbek/Ryadom/commit/ce60f88bff146dd70d0a373bcb719dbf38ccefb6))

## [2.8.2](https://github.com/zaripov-jasurbek/Ryadom/compare/v2.8.1...v2.8.2) (2026-10-16)


### Исправления

* **scan:** keep digits inside dish names before the quantity column ([0dd8e47](https://github.com/zaripov-jasurbek/Ryadom/commit/0dd8e47bd8520628a97cdc3465feb056c4f0d656))

## [2.8.1](https://github.com/zaripov-jasurbek/Ryadom/compare/v2.8.0...v2.8.1) (2026-10-16)


### Исправления

* превью у ссылок на чек — адрес ?c= вместо /check/ ([#46](https://github.com/zaripov-jasurbek/Ryadom/issues/46)) ([6b0e48d](https://github.com/zaripov-jasurbek/Ryadom/commit/6b0e48d5e3ba95d5d992d39ae82a923156e0cbfd))

## [2.8.0](https://github.com/zaripov-jasurbek/Ryadom/compare/v2.7.0...v2.8.0) (2026-10-16)


### Новое

* превью ссылки в Telegram и других мессенджерах ([#44](https://github.com/zaripov-jasurbek/Ryadom/issues/44)) ([3145b7a](https://github.com/zaripov-jasurbek/Ryadom/commit/3145b7a5a87965834a8b2861daa498e1d1079d89))


### Исправления

* **db:** id повторного запроса привязан к чеку ([#42](https://github.com/zaripov-jasurbek/Ryadom/issues/42)) ([c41aa20](https://github.com/zaripov-jasurbek/Ryadom/commit/c41aa205418dbbdf006e14dfb8a81e6196442679))

## [2.7.0](https://github.com/zaripov-jasurbek/Ryadom/compare/v2.6.0...v2.7.0) (2026-10-15)


### Новое

* **check:** понятнее цена, мой аватар, детали, адаптивные имена, чип «На всех», новая картинка ([#39](https://github.com/zaripov-jasurbek/Ryadom/issues/39)) ([ebec17a](https://github.com/zaripov-jasurbek/Ryadom/commit/ebec17ac9b8e8975ca1972024470332f7bbc6f15))

## [2.6.0](https://github.com/zaripov-jasurbek/Ryadom/compare/v2.5.0...v2.6.0) (2026-10-15)


### Новое

* **fix:** Имена гостей обязательны, повторные запросы без дублей, стабильность ([#37](https://github.com/zaripov-jasurbek/Ryadom/issues/37)) ([9b5a2ae](https://github.com/zaripov-jasurbek/Ryadom/commit/9b5a2aecc4cef4d43378d5585213be97ccb65b06))

## [2.5.0](https://github.com/zaripov-jasurbek/Ryadom/compare/v2.4.0...v2.5.0) (2026-10-14)


### Новое

* имя при входе, лимит гостей, подсветка своего имени ([#35](https://github.com/zaripov-jasurbek/Ryadom/issues/35)) ([5ff0029](https://github.com/zaripov-jasurbek/Ryadom/commit/5ff0029609d9d37a9818f364ed22e294daf0bf52))

## [2.4.0](https://github.com/zaripov-jasurbek/Ryadom/compare/v2.3.2...v2.4.0) (2026-10-13)


### Новое

* **scan:** подробно показываем, что делает сканер; вибрация на Android ([#31](https://github.com/zaripov-jasurbek/Ryadom/issues/31)) ([093e06f](https://github.com/zaripov-jasurbek/Ryadom/commit/093e06fbe1545a15931e20bd82e0c7aed9d605fa))


### Исправления

* **realtime:** гость появляется в чеке сразу, канал переподписывается после сбоя ([#32](https://github.com/zaripov-jasurbek/Ryadom/issues/32)) ([7bb4ab9](https://github.com/zaripov-jasurbek/Ryadom/commit/7bb4ab9b24a1cf9d3af14495451c3dcf7d2b3222))

## [2.3.2](https://github.com/zaripov-jasurbek/Ryadom/compare/v2.3.1...v2.3.2) (2026-10-12)


### Исправления

* **bill:** a quick second tap on a serving is no longer lost ([04ee11b](https://github.com/zaripov-jasurbek/Ryadom/commit/04ee11b5aa7e38935e08640caae989df2be1be3d))

## [2.3.1](https://github.com/zaripov-jasurbek/Ryadom/compare/v2.3.0...v2.3.1) (2026-10-12)


### Исправления

* haptics on iOS 26 and Android without web-haptics ([#28](https://github.com/zaripov-jasurbek/Ryadom/issues/28)) ([05d26c9](https://github.com/zaripov-jasurbek/Ryadom/commit/05d26c9e198af66b90086543339180ce0487bd71))

## [2.3.0](https://github.com/zaripov-jasurbek/Ryadom/compare/v2.2.0...v2.3.0) (2026-10-11)


### Новое

* **pwa:** шаги установки на Android, если Chrome не предложил сам ([1f633ca](https://github.com/zaripov-jasurbek/Ryadom/commit/1f633ca72bf17ea2df6b6c18d10111133eb0f83b))
* **ui:** длинное название позиции переносится на новые строки ([9dcdf35](https://github.com/zaripov-jasurbek/Ryadom/commit/9dcdf3517a0ff3292f1f0ed1aba5008154303de6))


### Исправления

* **scan:** на Android новый чек предлагает камеру ([c7e45e9](https://github.com/zaripov-jasurbek/Ryadom/commit/c7e45e91a5f23d2b27b6faacb0a23951a019e6e2))
* **ui:** зоны касания 44px, контраст, видимый фокус и SVG-иконки ([2a8e817](https://github.com/zaripov-jasurbek/Ryadom/commit/2a8e817f3c2061534470f4eb7b7c5f432d4fd29b))
* **ui:** установка в шапке, понятный прогресс скана, причина отказа «Готово» ([caa5641](https://github.com/zaripov-jasurbek/Ryadom/commit/caa564191a09b2cef83e36ad7a1e47de399b687e))

## [2.2.0](https://github.com/zaripov-jasurbek/Ryadom/compare/v2.1.0...v2.2.0) (2026-10-08)


### Новое

* две серые галочки для подтверждения оплаты ([#25](https://github.com/zaripov-jasurbek/Ryadom/issues/25)) ([018c336](https://github.com/zaripov-jasurbek/Ryadom/commit/018c336ec5fc80e07307f02dbb69587f97dc0bf7))

## [2.1.0](https://github.com/zaripov-jasurbek/Ryadom/compare/v2.0.0...v2.1.0) (2026-10-08)


### Новое

* **scan:** удобная рамка и несколько фото одного чека ([#23](https://github.com/zaripov-jasurbek/Ryadom/issues/23)) ([2e8409d](https://github.com/zaripov-jasurbek/Ryadom/commit/2e8409de50804f20894d9dfbea1073aaaa736825))

## [2.0.0](https://github.com/zaripov-jasurbek/Ryadom/compare/v1.2.0...v2.0.0) (2026-10-08)


### ⚠ BREAKING CHANGES

* оплата галочками ✓ / ✓✓ вместо поля суммы ([#18](https://github.com/zaripov-jasurbek/Ryadom/issues/18))

### Новое

* оплата галочками ✓ / ✓✓ вместо поля суммы ([#18](https://github.com/zaripov-jasurbek/Ryadom/issues/18)) ([8117ce1](https://github.com/zaripov-jasurbek/Ryadom/commit/8117ce151bcc6ea9e801eb9d6ea237a7321819f4))

## [1.2.0](https://github.com/zaripov-jasurbek/Ryadom/compare/v1.1.0...v1.2.0) (2026-10-08)


### Новое

* **items:** аватарки вместо никнеймов, группировка по общей порции ([#15](https://github.com/zaripov-jasurbek/Ryadom/issues/15)) ([feec5b0](https://github.com/zaripov-jasurbek/Ryadom/commit/feec5b07cd71bd7c324cea26da2901ad59066ac2))

## [1.1.0](https://github.com/zaripov-jasurbek/Ryadom/compare/v1.0.0...v1.1.0) (2026-10-08)


### Новое

* одна таблица позиций для создания, скана и редактирования ([#13](https://github.com/zaripov-jasurbek/Ryadom/issues/13)) ([1359cb2](https://github.com/zaripov-jasurbek/Ryadom/commit/1359cb29cd9cda63af115eb2b11172243d4a3971))

## [1.0.0](https://github.com/zaripov-jasurbek/Ryadom/compare/v0.3.0...v1.0.0) (2026-10-07)


### ⚠ BREAKING CHANGES

* поля ввода без рамок и чистка неиспользуемого кода ([#11](https://github.com/zaripov-jasurbek/Ryadom/issues/11))

### Новое

* поля ввода без рамок и чистка неиспользуемого кода ([#11](https://github.com/zaripov-jasurbek/Ryadom/issues/11)) ([93e1954](https://github.com/zaripov-jasurbek/Ryadom/commit/93e195499ff8213443c95e265cf672d1a507f040))

## [0.3.0](https://github.com/zaripov-jasurbek/Ryadom/compare/v0.2.0...v0.3.0) (2026-10-07)


### Новое

* Design/receipt style ([#10](https://github.com/zaripov-jasurbek/Ryadom/issues/10)) ([7a99393](https://github.com/zaripov-jasurbek/Ryadom/commit/7a99393ffbef81a2d0c07fb3e11e3bcf849c45b2))
* expected guests and «на всех» for late arrivals ([#8](https://github.com/zaripov-jasurbek/Ryadom/issues/8)) ([7b0c454](https://github.com/zaripov-jasurbek/Ryadom/commit/7b0c454486191b132fde1afc6111decd56638d0f))

## [0.2.0](https://github.com/zaripov-jasurbek/Ryadom/compare/v0.1.0...v0.2.0) (2026-10-07)


### Новое

* release versions automatically and show the version in the app ([c83577e](https://github.com/zaripov-jasurbek/Ryadom/commit/c83577eef993338c333082c0de3840f1b86b9f86))
