/*!
 * Export comments from Supabase as an AI-ready change-request brief.
 * No UI — run it whenever you want to hand the current comments to an AI to fix.
 *
 *   SUPABASE_URL=… SUPABASE_KEY=… node scripts/export-comments.mjs [projectId] [status]
 *     projectId  default: my-app
 *     status     open (default) | resolved | all
 *
 * Prints Markdown to stdout and also writes comments-for-ai.md + .json next to cwd.
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync } from 'node:fs';

const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_KEY;
if (!url || !key) { console.error('Set SUPABASE_URL and SUPABASE_KEY'); process.exit(2); }
const project = process.argv[2] || process.env.PROJECT_ID || 'my-app';
const status = process.argv[3] || process.env.STATUS || 'open';

const sb = createClient(url, key);
let q = sb.from('comments').select('*').eq('project_id', project).order('created_at');
if (status !== 'all') q = q.eq('status', status);
const { data, error } = await q;
if (error) { console.error(error.message); process.exit(1); }

const list = (data || []).sort((a, b) => ((a.meta?.seq || 0) - (b.meta?.seq || 0)));

// Write each comment's screenshot (base64 in meta.shot) out as a JPEG file so the
// brief can reference the actual visual of the element that was commented on.
const SHOT_DIR = 'comments-for-ai-shots';
let shotsWritten = 0;
try { mkdirSync(SHOT_DIR, { recursive: true }); } catch (e) {}
function shotFile(r) {
  const shot = r.meta?.shot;
  if (!shot || !String(shot).startsWith('data:image')) return null;
  const b64 = String(shot).split(',')[1];
  if (!b64) return null;
  const name = `${SHOT_DIR}/comment-${r.meta?.seq || r.id}.jpg`;
  try { writeFileSync(name, Buffer.from(b64, 'base64')); shotsWritten++; return name; } catch (e) { return null; }
}

function brief(rows) {
  const head = `# UI change requests (${rows.length}) — project: ${project} — status: ${status}\n\n`
    + `Each item is a comment pinned to a UI element on a live page. For each: locate the element in the\n`
    + `codebase using the tag, visible text, id/testid, DOM path and the captured HTML, then apply the\n`
    + `requested change. Keep unrelated markup intact.\n`;
  const body = rows.map((r) => {
    const fp = r.fp || {}, m = r.meta || {}, snap = r.html_snapshot || {};
    const loc = [
      fp.stableId ? `id/testid/aria: ${fp.stableId}` : null,
      fp.path && fp.path.length ? `dom-path: ${fp.path.join(' > ')}` : null,
    ].filter(Boolean).join(' · ');
    const txt = fp.text ? ` “${String(fp.text).slice(0, 80)}”` : '';
    const html = snap.outerHTML || '';
    const shot = shotFile(r);
    return `## #${m.seq || '?'} — ${r.text}\n`
      + `- page: ${m.route || m.url || '/'}\n`
      + `- requested by: ${r.author}${r.ts ? ` · ${r.ts}` : ''} · status: ${r.status}`
      + `${r.created_at ? ` · added ${r.created_at}` : ''}\n`
      + `- element: <${fp.tag || '?'}>${txt}\n`
      + (loc ? `- ${loc}\n` : '')
      + (shot ? `- screenshot at comment time: ![#${m.seq}](${shot})\n` : '')
      + (html ? '- html at comment time:\n```html\n' + html + '\n```\n' : '');
  }).join('\n');
  return head + '\n' + body;
}

const md = brief(list);
process.stdout.write(md + '\n');
try {
  writeFileSync('comments-for-ai.md', md);
  writeFileSync('comments-for-ai.json', JSON.stringify(list, null, 2));
  console.error(`\n[wrote comments-for-ai.md + .json + ${shotsWritten} screenshot(s) in ${SHOT_DIR}/ — ${list.length} ${status} comment(s)]`);
} catch (e) { /* stdout still has it */ }
