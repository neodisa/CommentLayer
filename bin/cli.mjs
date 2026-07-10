#!/usr/bin/env node
/*
 * comment-layer — one-command installer.
 *
 *   npx github:neodisa/CommentLayer [targetDir]     (default: ./comment-layer)
 *
 * Copies the prebuilt runtime bundles + the Supabase schema into your project and
 * prints the embed snippet + next steps. No build needed — dist/ ships in the repo.
 * Uses only Node builtins (no dependencies).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative, basename } from 'node:path';
import { mkdirSync, copyFileSync, existsSync } from 'node:fs';

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const raw = (process.argv[2] || '').replace(/[\\/]+$/, '');   // strip trailing / or \ (Windows)
const arg = raw || 'comment-layer';                           // no arg (or bare '/') → default folder
const target = resolve(process.cwd(), arg);   // relative or absolute both work
const shown = relative(process.cwd(), target) || '.';          // how we NAME the folder in output
const served = target === process.cwd() ? '' : basename(target); // URL folder ('' → site root)
const urlBase = served ? '/' + served + '/' : '/';

const FILES = [
  'dist/comment-layer.min.js',
  'dist/supabase-adapter.min.js',
  'supabase/schema.sql',
];

let copied = 0;
const missing = [];
try {
  mkdirSync(target, { recursive: true });
  for (const f of FILES) {
    const src = join(pkgRoot, f);
    if (existsSync(src)) { copyFileSync(src, join(target, basename(f))); copied++; }
    else missing.push(f);
  }
} catch (err) {
  console.error(`\x1b[31m✖\x1b[0m comment-layer: could not copy into ${target}`);
  console.error(`  ${err.code ? err.code + ': ' : ''}${err.message}`);
  console.error('  Check that the path is a writable directory (not an existing file) and try again.');
  process.exit(1);
}

const b = (s) => `\x1b[1m${s}\x1b[0m`;   // bold
const d = (s) => `\x1b[2m${s}\x1b[0m`;   // dim

console.log(`
\x1b[32m✔\x1b[0m ${b('comment-layer')} — copied ${copied} file(s) into ${b(shown + '/')}
  ${d('•')} comment-layer.min.js      ${d('the review widget')}
  ${d('•')} supabase-adapter.min.js   ${d('multi-user storage adapter')}
  ${d('•')} schema.sql                ${d('run this in your Supabase SQL editor')}
${missing.length ? `\n${d('(skipped, not found: ' + missing.join(', ') + ' — run "npm run build" in the repo first)')}\n` : ''}
${b('Next:')}
  ${b('1.')} Create a free Supabase project → open the SQL editor → run ${b(shown + '/schema.sql')}.
  ${b('2.')} Copy your Project URL + publishable (anon) key from Settings → API.
  ${b('3.')} Serve the two ${b('*.min.js')} files and add before </body>
     ${d('(adjust ' + urlBase + ' to the URL your app serves them at):')}

     ${d('<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>')}
     ${d('<script src="' + urlBase + 'supabase-adapter.min.js"></script>')}
     ${d('<script src="' + urlBase + 'comment-layer.min.js"></script>')}
     ${d('<script>')}
     ${d("  const store = CommentLayerSupabase({ url: 'https://YOUR.supabase.co',")}
     ${d("    anonKey: 'sb_publishable_…', projectId: 'my-app' });")}
     ${d('  store.ready.then(() => CommentLayer.init({ projectId: "my-app", storage: store }));')}
     ${d('</script>')}

  ${d('Zero-backend try: skip steps 1–2, just CommentLayer.init({ projectId: "my-app" }) (localStorage).')}
  ${d('Full guide & docs: https://github.com/neodisa/CommentLayer')}
`);
