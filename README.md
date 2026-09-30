# Рядом

Mobile-first приложение для совместного разделения ресторанного чека. Клиент: Svelte 5, TypeScript, Tailwind CSS и Vite. Данные, защищённые изменения, платежи и realtime: Supabase.

## Локальный запуск

```sh
npm install
npm run dev
```

Без Supabase приложение открывает локальный режим для знакомства с интерфейсом; его данные доступны только в этом браузере. Для общего чека создайте Supabase project, включите Anonymous Sign-ins в Authentication, примените миграцию `supabase/migrations/202610010001_initial_schema.sql`, затем укажите `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY` в `.env` (пример — `.env.example`). Клиент использует только publishable/anon key; `service_role` key добавлять нельзя.

Миграция создаёт нормализованные таблицы, RLS-политики и ограниченные RPC-функции. Участники привязываются к анонимной Supabase-сессии; персональные приглашения используют случайный токен, хранящийся в базе только в виде хеша. Неподтверждённые участники не могут занять зарезервированное имя без персональной ссылки.

## Реализовано

- Создание чека, добавление участников и позиций, общая ссылка и QR-код.
- Независимое распределение каждого экземпляра позиции; равное и произвольное распределение целыми UZS.
- Service fee с детерминированным распределением остатка округления.
- Presence и Postgres Changes через Supabase Realtime.
- Платежи, ссылка-подтверждение и ручное подтверждение владельцем.
- Общие и привязанные к позиции комментарии.
- Копирование сводки, сохранение изображения, печать в PDF и удаление закрытого чека.
- GitHub Pages workflow с SPA fallback `404.html`.

## Проверки

```sh
npm run check
npm test
npm run build
```

Unit tests проверяют округление по сумам, индивидуальные экземпляры одинаковых позиций, произвольные доли, service fee и нераспределённую стоимость.

## GitHub Pages

Workflow `.github/workflows/deploy.yml` публикует `main` или `master` через GitHub Actions. В настройках репозитория откройте **Settings → Pages** и выберите **GitHub Actions** в качестве источника публикации. В **Settings → Secrets and variables → Actions → Variables** добавьте `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY` (Supabase project URL и publishable/anon key). Эти значения публичны в браузерном приложении; `service_role` key сюда добавлять нельзя.

Для Supabase создайте проект, включите **Authentication → Sign In / Providers → Anonymous Sign-Ins**, затем примените все файлы `supabase/migrations` по порядку через SQL Editor или Supabase CLI. В частности, вторая миграция добавляет недостающий доступ к RPC произвольного распределения позиций. В **Authentication → URL Configuration** добавьте URL опубликованного GitHub Pages сайта в **Site URL** и **Redirect URLs**. После настройки variables запустите workflow вручную через **Actions → Deploy to GitHub Pages → Run workflow** либо отправьте коммит в `main`/`master`.
