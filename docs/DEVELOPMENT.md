# Рядом — руководство для разработчиков

Mobile-first приложение для совместного разделения ресторанного чека. Клиент: Svelte 5, TypeScript и Vite. Данные, защищённые изменения, платежи и realtime: Supabase.

## Локальный запуск

```sh
npm install
npm run dev
```

Без Supabase приложение открывает локальный режим для знакомства с интерфейсом; его данные доступны только в этом браузере. Для общего чека создайте Supabase project, включите Anonymous Sign-ins в Authentication, примените миграции из `supabase/migrations`, затем укажите `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY` в `.env` (пример — `.env.example`). Клиент использует только publishable/anon key; `service_role` key добавлять нельзя.

Миграции создают нормализованные таблицы, RLS-политики и ограниченные RPC-функции. Гости открывают общую ссылку на чек и присоединяются под своим именем без отдельного приглашения.

## Реализовано

- Создание чека, добавление позиций и общая ссылка: гости сами присоединяются и вводят имя. Ссылку можно показать QR-кодом (`uqr`, генерируется в браузере).
- Скан чека: фото распознаёт Tesseract.js (русский + узбекский) прямо на устройстве, `src/lib/receipt.ts` разбирает текст на позиции, владелец проверяет и правит их перед добавлением. Worker, WASM-ядро и языковые модели (~10 МБ) Vite-плагин `tesseractAssets` в `vite.config.ts` берёт из `node_modules` и раздаёт с самого сайта по адресу `tesseract/`, без CDN. Модели после первой загрузки кэшируются в IndexedDB.
- Независимое распределение каждого экземпляра позиции; равное и произвольное распределение целыми UZS.
- Service fee с детерминированным распределением остатка округления.
- Presence и уведомления об изменениях через Supabase Realtime: база шлёт одно broadcast-сообщение на транзакцию в приватный канал чека, клиент перезагружает чек одним вызовом `get_check`.
- Платежи, ссылка-подтверждение и ручное подтверждение владельцем.
- Общая лента комментариев к чеку с автором и временем.
- Копирование сводки, сохранение изображения, печать в PDF и удаление закрытого чека.
- GitHub Pages workflow с SPA fallback `404.html`.

## Проверки

```sh
npm run check
npm test
npm run build
```

Unit tests проверяют разбор распознанного текста чека (форматы сумм, фискальные строки «2 x 25 000,00», ошибки OCR), округление по суммам, индивидуальные экземпляры одинаковых позиций, произвольные доли, service fee, нераспределённую стоимость, локальный режим и маршруты. SQL-тесты в `supabase/tests` применяют все миграции к PGlite (Postgres в WASM) с заглушками схем Supabase и проверяют RPC, права доступа, broadcast и обновление существующих данных.

## GitHub Pages

Workflow `.github/workflows/deploy.yml` публикует `main` или `master` через GitHub Actions. В настройках репозитория откройте **Settings → Pages** и выберите **GitHub Actions** в качестве источника публикации. В **Settings → Secrets and variables → Actions → Variables** добавьте `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY` (Supabase project URL и publishable/anon key). Эти значения публичны в браузерном приложении; `service_role` key сюда добавлять нельзя.

Для Supabase создайте проект и включите **Authentication → Sign In / Providers → Anonymous Sign-Ins**. Workflow `.github/workflows/supabase-migrations.yml` применяет новые миграции при изменениях в `supabase/migrations` на `main`/`master`; его также можно запустить вручную. Для подключения добавьте в **Settings → Secrets and variables → Actions** секреты `SUPABASE_ACCESS_TOKEN` (Supabase personal access token) и `SUPABASE_DB_PASSWORD` (пароль базы данных), а в **Variables** — `SUPABASE_PROJECT_REF` (ID проекта из URL панели Supabase). Если схему уже применяли вручную через SQL Editor, workflow сам это обнаружит (таблица `public.checks` есть, а в истории миграций нет `202610010001`), пометит начальную миграцию как применённую и затем применит остальные. Запустить его вручную можно в **Actions → Apply Supabase migrations**. В **Authentication → URL Configuration** добавьте URL опубликованного GitHub Pages сайта в **Site URL** и **Redirect URLs**. Для публикации сайта настройте переменные `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY`, затем запустите workflow Deploy to GitHub Pages.
