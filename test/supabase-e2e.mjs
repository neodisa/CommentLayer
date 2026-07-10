/*!
 * Supabase END-TO-END test (runs against a LIVE project, not mocked).
 * Reuses the real adapter mappers so we test the exact serialization shipped.
 *
 *   SUPABASE_URL=… SUPABASE_KEY=… node test/supabase-e2e.mjs
 *
 * Isolated under a unique project_id; cleans up its own rows at the end.
 */
import { createClient } from '@supabase/supabase-js';
import { rowToComment, commentToRow } from '../src/supabase-adapter.js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_KEY;
if (!url || !key) { console.error('Set SUPABASE_URL and SUPABASE_KEY'); process.exit(2); }

const sb = createClient(url, key);
const PROJECT = 'e2e-' + Date.now(); // isolate this run
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  \x1b[32m✓\x1b[0m ' + m); };
const bad = (m) => { fail++; console.log('  \x1b[31m✗ ' + m + '\x1b[0m'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Mirror the SDK's genId(): globally-unique string id, no server coordination.
const genId = () => (globalThis.crypto?.randomUUID?.())
  || ('c-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10));

// A realistic comment as the SDK would build it (with context bundle).
const sampleComment = (over = {}) => ({
  id: genId(), author: 'Sergey', text: 'move this button', status: 'open',
  fp: { tag: 'button', textHash: 'abc123', path: 'div>button' },
  htmlSnapshot: { outerHTML: '<button class="btn">Save</button>', text: 'Save' },
  meta: { url: 'https://app/x', route: '/x', version: 'v1', viewport: '1280x800', ts: 'now' },
  bornV: 1, resolvedV: null, resolveReason: null, ts: String(Date.now()),
  ...over,
});

async function cleanup() {
  await sb.from('comments').delete().eq('project_id', PROJECT);
}

async function main() {
  console.log(`\nSupabase e2e — project_id=${PROJECT}\n`);

  // 1. Table exists / reachable
  console.log('1) Connectivity & schema');
  {
    const { error } = await sb.from('comments').select('id').limit(1);
    if (error) {
      bad(`table "comments" not reachable: ${error.message}`);
      console.log('\n  → Did you run supabase/schema.sql in the SQL editor? Aborting.\n');
      process.exit(1);
    }
    ok('table "comments" exists and is selectable with the anon/publishable key');
  }

  // 2. Insert + round-trip of html_snapshot/meta jsonb columns
  console.log('2) Insert + JSONB round-trip (html_snapshot, meta)');
  {
    const row = commentToRow(sampleComment(), PROJECT); // client-assigned uuid id
    const { data, error } = await sb.from('comments').insert(row).select().single();
    if (error) { bad('insert failed: ' + error.message); }
    else {
      const back = rowToComment(data);
      const snapOk = back.htmlSnapshot?.outerHTML === '<button class="btn">Save</button>'
        && back.htmlSnapshot?.text === 'Save';
      const metaOk = back.meta?.route === '/x' && back.meta?.version === 'v1'
        && back.meta?.viewport === '1280x800';
      snapOk ? ok('html_snapshot survived round-trip (outerHTML + text)') : bad('html_snapshot corrupted: ' + JSON.stringify(back.htmlSnapshot));
      metaOk ? ok('meta survived round-trip (route/version/viewport)') : bad('meta corrupted: ' + JSON.stringify(back.meta));
      (back.text === 'move this button' && back.author === 'Sergey' && back.status === 'open')
        ? ok('scalar fields (author/text/status) intact') : bad('scalar fields corrupted');
    }
  }

  // 3. Realtime: subscribe, insert from a second client, expect callback
  console.log('3) Realtime postgres_changes');
  {
    const listener = createClient(url, key);
    let got = false;
    const ch = listener.channel('cl-' + PROJECT)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'comments', filter: 'project_id=eq.' + PROJECT },
        () => { got = true; });
    const subscribed = await new Promise((res) => {
      ch.subscribe((status) => { if (status === 'SUBSCRIBED') res(true); if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') res(false); });
      setTimeout(() => res(false), 8000);
    });
    if (!subscribed) bad('could not subscribe to realtime channel (is Realtime enabled / table in publication?)');
    else {
      ok('subscribed to realtime channel');
      const r = commentToRow(sampleComment({ text: 'realtime ping' }), PROJECT);
      await sb.from('comments').insert(r);
      // First subscribe on a cold project can take several seconds to warm up.
      for (let i = 0; i < 75 && !got; i++) await sleep(200); // up to 15s
      got ? ok('realtime event received by second client') : bad('no realtime event within 15s — multi-reviewer live updates will not work');
    }
    await listener.removeChannel(ch);
  }

  // 4. Update / upsert path used by adapter.save()
  console.log('4) Upsert path (adapter save)');
  {
    // fetch an existing row id, flip status to resolved via upsert
    const { data: rows } = await sb.from('comments').select('*').eq('project_id', PROJECT).limit(1);
    if (!rows?.length) bad('no row to upsert');
    else {
      const c = rowToComment(rows[0]);
      c.status = 'resolved'; c.resolvedV = 2; c.resolveReason = 'regenerated';
      const upRow = commentToRow(c, PROJECT);
      const { error } = await sb.from('comments').upsert([upRow], { onConflict: 'id' });
      if (error) bad('upsert failed: ' + error.message);
      else {
        const { data: after } = await sb.from('comments').select('*').eq('id', rows[0].id).single();
        after?.status === 'resolved' && after?.resolve_reason === 'regenerated'
          ? ok('upsert updated status→resolved + resolve_reason') : bad('upsert did not persist changes');
      }
    }
  }

  // 5. Multi-client concurrency — the core multi-reviewer scenario.
  // With uuid ids (the fix), two reviewers who both start with empty caches
  // create distinct ids, so both comments must survive (no overwrite).
  console.log('5) Two reviewers, empty caches — both comments must survive');
  {
    const a = commentToRow(sampleComment({ text: 'reviewer A comment' }), PROJECT);
    const b = commentToRow(sampleComment({ text: 'reviewer B comment' }), PROJECT);
    (a.id !== b.id) ? ok('two independent clients produced distinct ids') : bad('id collision: genId() returned the same id twice');
    await sb.from('comments').upsert([a], { onConflict: 'id' });
    await sb.from('comments').upsert([b], { onConflict: 'id' });
    const { data } = await sb.from('comments').select('text')
      .in('id', [a.id, b.id]);
    const texts = (data || []).map((r) => r.text).sort();
    (texts.length === 2 && texts[0] === 'reviewer A comment' && texts[1] === 'reviewer B comment')
      ? ok('both reviewers’ comments persisted — no overwrite')
      : bad('lost a comment: survivors=' + JSON.stringify(texts));
  }

  console.log(`\nResult: ${pass} passed, ${fail} failed`);
  await cleanup();
  console.log(`Cleaned up test rows for ${PROJECT}.\n`);
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => { console.error('FATAL', e); await cleanup(); process.exit(1); });
