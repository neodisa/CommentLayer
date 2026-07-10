/*!
 * Weekly comment SUMMARY across all projects.
 * Prints, per project: project name, summary date, comment counts. Also writes
 * every comment's screenshot to a file and lists the paths under "SCREENSHOTS:"
 * so the caller can display the images.
 *
 *   SUPABASE_URL=… SUPABASE_KEY=… node scripts/summary-comments.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync } from 'node:fs';

const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_KEY;
if (!url || !key) { console.error('Set SUPABASE_URL and SUPABASE_KEY'); process.exit(2); }

const sb = createClient(url, key);
const { data, error } = await sb.from('comments').select('*').order('project_id').order('created_at');
if (error) { console.error(error.message); process.exit(1); }
const rows = data || [];

// Summary date — today, local time, DD.MM.YYYY.
const today = (() => {
  try {
    const p = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
      .formatToParts(new Date());
    const g = (t) => (p.find((x) => x.type === t) || {}).value;
    return `${g('day')}.${g('month')}.${g('year')}`;
  } catch { return new Date().toISOString().slice(0, 10); }
})();

// Group by project.
const byProject = new Map();
for (const r of rows) {
  const k = r.project_id || '(no project)';
  if (!byProject.has(k)) byProject.set(k, []);
  byProject.get(k).push(r);
}

const SHOT_ROOT = 'comment-summary-shots';
try { mkdirSync(SHOT_ROOT, { recursive: true }); } catch (e) {}
const shotFiles = [];

let md = `# Comments summary — ${today}\n\n`;
if (!byProject.size) md += '_No comments._\n';

for (const [project, list] of byProject) {
  const open = list.filter((r) => r.status === 'open').length;
  const resolved = list.filter((r) => r.status === 'resolved').length;
  md += `## Project: ${project} — ${list.length} comment(s) (${open} open, ${resolved} resolved)\n`;
  try { mkdirSync(`${SHOT_ROOT}/${project}`, { recursive: true }); } catch (e) {}
  for (const r of list) {
    const seq = r.meta?.seq || r.id;
    const shot = r.meta?.shot;
    let line = `- #${seq} «${r.text}» — ${r.author}${r.ts ? ` · ${r.ts}` : ''} · ${r.status}`;
    if (shot && String(shot).startsWith('data:image')) {
      const b64 = String(shot).split(',')[1];
      if (b64) {
        const file = `${SHOT_ROOT}/${project}/comment-${seq}.jpg`;
        try { writeFileSync(file, Buffer.from(b64, 'base64')); shotFiles.push(file); line += ` · 📷 ${file}`; } catch (e) {}
      }
    }
    md += line + '\n';
  }
  md += '\n';
}

process.stdout.write(md);
writeFileSync('comment-summary.md', md);
// Machine-readable list of screenshot files for the caller to display.
process.stdout.write('\nSCREENSHOTS:\n' + shotFiles.map((f) => process.cwd() + '/' + f).join('\n') + '\n');
console.error(`\n[summary: ${byProject.size} project(s), ${rows.length} comment(s), ${shotFiles.length} screenshot(s)]`);
