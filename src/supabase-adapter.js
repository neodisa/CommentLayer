/*!
 * Supabase storage adapter for comment-layer (real multi-user persistence).
 * ES module: `export`ed for tests/bundlers; also attaches window.CommentLayerSupabase
 * when bundled to a classic script (esbuild --format=iife). Needs @supabase/supabase-js
 * (window.supabase) loaded first. Schema: comment-layer/supabase/schema.sql
 *
 * Usage (browser):
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 *   <script src="dist/supabase-adapter.min.js"></script>
 *   <script>
 *     const store = CommentLayerSupabase({ url:'…', anonKey:'…', projectId:'my-app' });
 *     store.ready.then(() => CommentLayer.init({ projectId:'my-app', storage: store }));
 *   </script>
 */

export const rowToComment = (r) => ({
  id: r.id, author: r.author, text: r.text, status: r.status, fp: r.fp,
  htmlSnapshot: r.html_snapshot || null, meta: r.meta || null,
  bornV: r.born_v, resolvedV: r.resolved_v, resolveReason: r.resolve_reason, ts: r.ts,
});

export const commentToRow = (c, project) => ({
  id: c.id, project_id: project, author: c.author, text: c.text, status: c.status,
  fp: c.fp, html_snapshot: c.htmlSnapshot || null, meta: c.meta || null,
  born_v: c.bornV, resolved_v: c.resolvedV || null,
  resolve_reason: c.resolveReason || null, ts: c.ts || null,
});

export function CommentLayerSupabase(cfg) {
  const sb = window.supabase.createClient(cfg.url, cfg.anonKey);
  const project = cfg.projectId || 'default';
  let cache = [];
  const listeners = cfg.onChange ? [cfg.onChange] : [];
  const emit = () => { for (const fn of listeners) { try { fn(cache); } catch (e) {} } };

  async function fetchAll() {
    const { data, error } = await sb.from('comments')
      .select('*').eq('project_id', project).order('id');
    if (error) { console.warn('[comment-layer] supabase fetch failed:', error.message); return; }
    cache = (data || []).map(rowToComment);
    emit();
  }

  // No project_id filter here on purpose: with RLS + default replica identity,
  // DELETE events carry only the PK, so a project_id filter would silently drop
  // them (deletes would never propagate live). We subscribe to all changes on the
  // table and re-query project-scoped in fetchAll instead.
  sb.channel('cl-' + project)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'comments' }, fetchAll)
    .subscribe();

  const ready = fetchAll();

  return {
    ready,
    load() { return cache; },
    // Live updates: the SDK registers here; realtime postgres_changes → fetchAll → emit.
    subscribe(fn) { if (typeof fn === 'function') listeners.push(fn); },
    async save(comments) {
      const rows = comments.map((c) => commentToRow(c, project));
      let lastErr;
      for (let attempt = 0; attempt < 3; attempt++) {
        const { error } = await sb.from('comments').upsert(rows, { onConflict: 'id' });
        if (!error) { cache = comments; return; }
        lastErr = error;
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
      }
      cache = comments; // optimistic local cache; SDK keeps a durable backup and retries
      console.warn('[comment-layer] supabase save failed after retries:', lastErr && lastErr.message);
      throw new Error('supabase save failed: ' + (lastErr && lastErr.message));
    },
    // Hard-delete: upsert-based save() never removes rows, so deletion needs its own path.
    async remove(ids) {
      const { error } = await sb.from('comments').delete().in('id', ids).eq('project_id', project);
      if (error) console.warn('[comment-layer] supabase delete failed:', error.message);
      cache = cache.filter((c) => !ids.includes(c.id));
    },
  };
}

if (typeof window !== 'undefined') window.CommentLayerSupabase = CommentLayerSupabase;
