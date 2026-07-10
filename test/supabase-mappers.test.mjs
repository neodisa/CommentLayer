import assert from 'node:assert';
import { rowToComment, commentToRow } from '../src/supabase-adapter.js';

const comment = {
  id: 1, author: 'Sam', text: 'fix header', status: 'open',
  fp: { tag: 'div', text: 'header' },
  htmlSnapshot: { outerHTML: '<div>header</div>', text: 'header' },
  meta: { url: 'http://x/a', route: '/a', version: 'v1', viewport: { w: 800, h: 600 }, ts: 't' },
  bornV: 1, resolvedV: null, resolveReason: null, ts: 't',
};

// comment -> row maps snake_case + context columns
const row = commentToRow(comment, 'my-app');
assert.equal(row.project_id, 'my-app');
assert.equal(row.born_v, 1);
assert.deepEqual(row.html_snapshot, comment.htmlSnapshot);
assert.deepEqual(row.meta, comment.meta);

// row -> comment round-trips back
const back = rowToComment(row);
assert.equal(back.author, 'Sam');
assert.equal(back.bornV, 1);
assert.deepEqual(back.htmlSnapshot, comment.htmlSnapshot);
assert.deepEqual(back.meta, comment.meta);

console.log('supabase-mappers: OK');
