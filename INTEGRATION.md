# Integrate comment-layer into a web project — instructions for an AI

You are adding **comment-layer** to a web app. It's a drop-in, framework-agnostic
review widget: reviewers click any element on the live page and leave a pinned
comment; comments persist in Supabase and update live across reviewers. Your job is
to embed it correctly. Follow these steps exactly; do not invent APIs.

## 0. What you're installing
- Source: `github.com/neodisa/CommentLayer`.
- Two prebuilt bundles you will serve from the app's own origin:
  - `dist/comment-layer.min.js` — the widget (IIFE → `window.CommentLayer`, UI isolated in Shadow DOM).
  - `dist/supabase-adapter.min.js` — multi-user storage (IIFE → `window.CommentLayerSupabase`).
- Backend: a shared Supabase project (Postgres table `comments`), separated per app by a `projectId` string.

## 1. Get the bundles into the project
Pick ONE:
- **npm (preferred):** `npm install github:neodisa/CommentLayer`, then copy
  `node_modules/comment-layer/dist/comment-layer.min.js` and
  `node_modules/comment-layer/dist/supabase-adapter.min.js` into the app's static
  assets so they're served at the site origin (e.g. `public/comment-layer/` for
  Vite/Next/Angular/CRA, `static/` for Hugo, etc.).
- **Manual:** copy those two files from the repo's `dist/` into the same static dir.

Serve them from the **same origin** as the page (not from a random http URL) — an
HTTPS page will block an HTTP script (mixed content). `@supabase/supabase-js` is
loaded from a HTTPS CDN, which is fine.

## 2. Supabase
Create a Supabase project (the free tier is fine) and run this once in its SQL editor:
```sql
create table if not exists comments (
  id text primary key, project_id text not null, author text not null, text text not null,
  status text not null default 'open', fp jsonb not null, html_snapshot jsonb, meta jsonb,
  born_v int, resolved_v int, resolve_reason text, ts text, created_at timestamptz default now()
);
create index if not exists comments_project_idx on comments(project_id);
alter table comments enable row level security;
drop policy if exists "anon rw" on comments;
create policy "anon rw" on comments for all using (true) with check (true);
alter publication supabase_realtime add table comments;
```
> `id` must be `text` (the SDK assigns UUIDs). `anon rw` = anyone with the key can
> read/write all rows; fine for internal review, tighten with auth before public use.

## 3. Embed
Add near the end of `<body>` in the app's HTML entry (e.g. `index.html`). Replace
`YOUR-UNIQUE-PROJECT-ID` with a slug unique to THIS app (comments are namespaced by it):

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="/comment-layer/supabase-adapter.min.js"></script>
<script src="/comment-layer/comment-layer.min.js"></script>
<script>
  (function () {
    var PROJECT = 'YOUR-UNIQUE-PROJECT-ID';
    var store = window.CommentLayerSupabase({
      url: 'https://YOUR-PROJECT.supabase.co',
      anonKey: 'sb_publishable_…',   // publishable/anon key — safe in client code
      projectId: PROJECT,
    });

    // IMPORTANT: SPAs (React/Vue/Angular/Svelte) paint asynchronously. If you init
    // before the app has rendered, comments can't anchor to elements. Wait until the
    // app's real content is in the DOM, then init. Adjust READY_SELECTOR to something
    // that only exists once your app has rendered (a header, main container, etc.).
    var READY_SELECTOR = 'header, main, #app > *, #root > *';
    var tries = 0;
    (function whenReady() {
      if (document.querySelector(READY_SELECTOR) || tries > 50) {
        store.ready.then(function () {
          window.CommentLayer.init({ projectId: PROJECT, storage: store });
        });
      } else { tries++; setTimeout(whenReady, 200); }
    })();
  })();
</script>
```

- **Static site / MPA (no SPA framework):** you can skip the readiness poll and just
  call the `store.ready.then(...)` init inside a `DOMContentLoaded` listener.
- Only include this on builds where review is wanted (staging/preview), or gate it
  behind a flag — every visitor who loads it sees & can edit all comments for that
  `projectId`.

## 4. Optional: auto-resolve on new deploys
A comment is a change request; when its element changes it can auto-resolve. If you
want that tied to releases, add `<meta name="build-version" content="...">`, pass
`version: <that value>` to `init`, and when a NEW version loads call
`window.CommentLayer.regenerated()` once (only after the app has rendered — same
readiness rule). Skip this if you don't need version-aware auto-resolve.

## 5. Verify
1. Load the page; a "💬 Add Comment" button appears bottom-right.
2. Click it → panel opens and the page shifts left; click any element → type → save.
3. Reload → the comment is still there (loaded from Supabase).
4. Open a second browser/tab → the comment appears there live (realtime).
5. In Supabase Table Editor → `comments`, a row exists with your `projectId`,
   `html_snapshot`, `meta`, and a `meta.shot` screenshot.

## API reference (already available on `window.CommentLayer` after init)
- `init({ projectId, storage, target?, user?, version?, autoDetectRegeneration? })`
- `regenerated()` → `{resolved, carried}` — run the version-aware auto-resolve
- `open()`, `getComments()`, `resolveComment(id)`, `reopenComment(id)`, `removeComment(id)`
- Each comment stores: text, author, status, element fingerprint (`fp`: tag, text,
  DOM path, id/testid), `html_snapshot.outerHTML`, `meta` (route, url, version,
  viewport, ts (local time), seq, `shot` = JPEG screenshot of the element).

## Feeding comments to an AI to fix them
The repo has `scripts/export-comments.mjs`. Run
`SUPABASE_URL=… SUPABASE_KEY=… node scripts/export-comments.mjs <projectId> open`
to get a Markdown change-request brief (text + page + element locator + HTML +
screenshot files) you can hand to a coding AI. Do NOT build a UI button for this.
