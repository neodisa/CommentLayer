/*!
 * Mark specific comments as resolved in Supabase — AFTER a human approved the fix.
 * Never resolves everything blindly: you must name the comments explicitly.
 *
 *   SUPABASE_URL=… SUPABASE_KEY=… \
 *   node scripts/resolve-comments.mjs <projectId> <seqOrId> [<seqOrId> ...] [--dry] [--reason "..."]
 *
 *     projectId   required, e.g. my-app
 *     seqOrId     one or more comment identifiers: a #seq number (e.g. 7) or a full uuid
 *     --dry       read-only: show which rows WOULD be resolved, write nothing
 *     --reason    resolve_reason to store (default: "resolved via /comments (approved fix)")
 *
 * Exit codes: 0 ok · 2 bad usage · 1 runtime/HTTP error.
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_KEY;
if (!url || !key) { console.error('Set SUPABASE_URL and SUPABASE_KEY'); process.exit(2); }

const argv = process.argv.slice(2);
const dry = argv.includes('--dry');
let reason = 'resolved via /comments (approved fix)';
const reasonIdx = argv.indexOf('--reason');
if (reasonIdx !== -1) reason = argv[reasonIdx + 1] || reason;

// positional args = projectId + identifiers, minus flags and their values
const positional = argv.filter((a, i) => {
  if (a === '--dry') return false;
  if (a === '--reason') return false;
  if (reasonIdx !== -1 && i === reasonIdx + 1) return false;
  return !a.startsWith('--');
});
const project = positional[0];
const ids = positional.slice(1);
if (!project || ids.length === 0) {
  console.error('Usage: resolve-comments.mjs <projectId> <seqOrId> [<seqOrId> ...] [--dry] [--reason "..."]');
  console.error('Refusing to run: you must name at least one comment (#seq or uuid) to resolve.');
  process.exit(2);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sb = createClient(url, key);

let failures = 0;
for (const ident of ids) {
  const byUuid = UUID_RE.test(ident);
  // Find the target row first, scoped to the project so a stray seq can't hit another app.
  let sel = sb.from('comments').select('id, text, status, meta').eq('project_id', project);
  sel = byUuid ? sel.eq('id', ident) : sel.eq('meta->>seq', String(ident));
  const { data: matches, error: selErr } = await sel;
  if (selErr) { console.error(`✗ ${ident}: lookup failed — ${selErr.message}`); failures++; continue; }
  if (!matches || matches.length === 0) {
    console.error(`✗ ${ident}: no comment in project "${project}" (wrong #seq/uuid or wrong project?)`);
    failures++; continue;
  }

  for (const row of matches) {
    const label = `#${row.meta?.seq ?? '?'} «${String(row.text).slice(0, 40)}»`;
    if (row.status === 'resolved') { console.log(`• ${label} — already resolved, skipping`); continue; }
    if (dry) { console.log(`[dry] would resolve ${label} (id ${row.id})`); continue; }

    const { error: updErr } = await sb.from('comments')
      .update({ status: 'resolved', resolve_reason: reason })
      .eq('id', row.id);
    if (updErr) { console.error(`✗ ${label}: update failed — ${updErr.message}`); failures++; continue; }
    console.log(`✓ resolved ${label}`);
  }
}

if (dry) console.log('\n[dry run — nothing was written]');
process.exit(failures ? 1 : 0);
