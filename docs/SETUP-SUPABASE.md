# Supabase setup for comment-layer

1. Создать проект на https://supabase.com (Free tier достаточно для пилота).
2. Project Settings → API: скопировать **Project URL** и **anon public** key
   (anon-ключ публичный — его можно класть в клиентский код).
3. SQL Editor → New query → вставить содержимое `../supabase/schema.sql` → Run.
4. Database → Replication / Publications: убедиться, что таблица `comments`
   входит в `supabase_realtime` (шаг уже есть в schema.sql).
5. Подключение на странице:
   ```html
   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
   <script src="dist/supabase-adapter.min.js"></script>
   <script src="dist/comment-layer.min.js"></script>
   <script>
     const store = CommentLayerSupabase({
       url: 'https://XXX.supabase.co',
       anonKey: 'PUBLIC_ANON_KEY',
       projectId: 'my-app',
     });
     store.ready.then(() => CommentLayer.init({ projectId: 'my-app', storage: store }));
   </script>
   ```
6. Проверка: открыть страницу в двух вкладках, создать коммент в одной →
   он появляется в другой (realtime). В Table Editor → `comments` видна строка
   с заполненными `html_snapshot` и `meta`.

## Несколько проектов на одном Supabase (принятая модель)

Отдельная база на каждый проект НЕ нужна. Один Supabase-проект и одна таблица
`comments` обслуживают много проектов — они разделяются колонкой `project_id`.
Чтобы подключить новый проект, **не создавай новую БД**: используй тот же `url` +
`anonKey`, просто задай уникальный `projectId`:

```js
const store = CommentLayerSupabase({ url: SAME_URL, anonKey: SAME_KEY, projectId: 'another-app' });
store.ready.then(() => CommentLayer.init({ projectId: 'another-app', storage: store, version: '1' }));
```

Комментарии проектов не смешиваются в панели (SDK фильтрует по `projectId`).

> ⚠️ Изоляция при этой модели — по соглашению, не по безопасности: политика
> `anon rw` (`using(true)`) даёт anon-ключу доступ ко всем строкам таблицы, поэтому,
> зная чужой `project_id`, теоретически можно прочитать чужие комментарии. Приемлемо
> для своих/внутренних проектов. Если понадобится жёсткая изоляция между клиентами —
> переходим на отдельный Supabase на проект ИЛИ на строгий RLS с ключом/токеном на проект.
