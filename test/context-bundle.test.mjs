import assert from 'node:assert';
import { buildContextBundle, truncate } from '../src/context-bundle.js';

// truncate caps long strings and marks them
{
  const long = 'x'.repeat(7000);
  const out = truncate(long, 6000);
  assert.ok(out.length < 6100, 'truncated length near cap');
  assert.ok(out.endsWith('…[truncated]'), 'truncation marker present');
}
// short strings pass through untouched
{
  assert.equal(truncate('<div/>', 6000), '<div/>');
}
// bundle assembles htmlSnapshot + meta and normalizes text
{
  const b = buildContextBundle({
    outerHTML: '<div>hi</div>', text: '  hello   world  ',
    url: 'http://x/a', route: '/a', version: 'v3',
    viewport: { w: 100, h: 200 }, ts: '2026-07-01 10:00',
  });
  assert.equal(b.htmlSnapshot.outerHTML, '<div>hi</div>');
  assert.equal(b.htmlSnapshot.text, 'hello world');
  assert.equal(b.meta.url, 'http://x/a');
  assert.equal(b.meta.route, '/a');
  assert.equal(b.meta.version, 'v3');
  assert.deepEqual(b.meta.viewport, { w: 100, h: 200 });
  assert.equal(b.meta.ts, '2026-07-01 10:00');
}
// missing input is safe
{
  const b = buildContextBundle();
  assert.equal(b.htmlSnapshot.outerHTML, '');
  assert.equal(b.htmlSnapshot.text, '');
  assert.equal(b.meta.version, null);
}
console.log('context-bundle: OK');
