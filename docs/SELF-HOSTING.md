# Self-hosting comment-layer

comment-layer is designed to be **cloned and self-hosted** — each team runs it on their own
server with their own database. **No MCP server or any always-on service is required**: the
widget is static JS, the AI hand-off is file/script-based, and the only backend is a database
you control.

## What you run
1. **The widget bundles** (static): `dist/comment-layer.min.js` (+ `dist/supabase-adapter.min.js`
   for multi-user). Served from your app's own origin.
2. **A database** you own. Reference adapter is Supabase (self-hostable, or their cloud), but
   the storage adapter is pluggable — any Postgres-with-realtime, or just the built-in
   localStorage adapter for a single-user/offline setup.

## Set up your own instance
```bash
git clone https://github.com/neodisa/CommentLayer
cd comment-layer && npm ci && npm run build      # produces dist/*.min.js
```
1. Create your DB. For Supabase: new project → run `supabase/schema.sql` in the SQL editor.
   (Self-hosted Supabase / any Postgres works too — same schema, enable realtime on `comments`.)
2. Copy `dist/*.min.js` into your app's static assets and embed (see `INTEGRATION.md`), using
   **your** DB url + key and a unique `projectId`.
3. Deploy your app however you already do (Vercel, Netlify, Nginx, S3 — anything static-capable).

Your data stays in your database; nothing phones home.

## No MCP required (AI hand-off is file-based)
To feed comments to an AI for fixes, run `npm run export:ai -- <projectId> open` — it writes a
Markdown brief + screenshots you hand to any coding AI. This is a script you run on demand (or
on a schedule); there is no persistent MCP/agent server to operate. (An optional MCP server may
come later as an add-on, never a requirement.)

## Pulling new versions
The project version is in `package.json` and exposed at runtime as `CommentLayer.version`.

To update a self-hosted instance:
```bash
git pull                 # or: git fetch --tags && git checkout v0.3.0  to pin a version
npm ci && npm run build  # rebuild dist/
# copy the new dist/*.min.js into your app's static assets, redeploy
```
- **Pin a version** by checking out a release tag (`git checkout vX.Y.Z`) — stable, update when you choose.
- **Track latest** by staying on `main` and pulling — newest features, at your own cadence.
- Check what an instance is running in the browser console: `CommentLayer.version`.
- Releases are tagged in the repo; read the commit log / release notes before pulling to see what changed.

> Optional convenience: serve the bundles from a CDN by version tag (e.g. jsDelivr from the repo)
> so integrated apps update by changing one `<script src>` version instead of re-copying files.
> This is a distribution choice, not required for self-hosting.
