// Spike runner — zero dependencies. `node run.mjs`
// Scores the anchor/diff algorithm against the version-pair fixtures.

import { parse, elements } from './minihtml.mjs';
import { fingerprint, classify } from './anchor-diff.mjs';
import { fixtures } from './fixtures.mjs';

function findAnchored(root, id) {
  return elements(root).find((el) => el.attrs['data-anchor'] === id);
}

let total = 0, correct = 0;
let falseResolve = 0;   // predicted RESOLVE but should CARRY_FORWARD  (DROPS live feedback — worst)
let falseCarry = 0;     // predicted CARRY_FORWARD but should RESOLVE (stale open thread — mild)
const rows = [];

for (const fx of fixtures) {
  const treeN = parse(fx.vN);
  const treeNext = parse(fx.vNext);
  const candidates = elements(treeNext);

  for (const a of fx.anchors) {
    const el = findAnchored(treeN, a.id);
    if (!el) { console.error(`! anchor not found: ${fx.name} / ${a.id}`); continue; }
    const fp = fingerprint(el);
    const res = classify(fp, candidates);
    const ok = res.decision === a.expect;
    total++;
    if (ok) correct++;
    else if (res.decision === 'RESOLVE') falseResolve++;
    else falseCarry++;
    rows.push({
      fixture: fx.name,
      anchor: a.id,
      expected: a.expect,
      got: res.decision,
      ok,
      reason: res.reason,
    });
  }
}

// ---- report ----------------------------------------------------------------
const pad = (s, n) => String(s).padEnd(n);
console.log('\n=== Anchor/Diff feasibility spike ===\n');
console.log(pad('result', 8) + pad('expected', 15) + pad('got', 15) + pad('anchor', 10) + 'fixture');
console.log('-'.repeat(96));
for (const r of rows) {
  const mark = r.ok ? 'PASS' : 'FAIL';
  console.log(
    pad(mark, 8) + pad(r.expected, 15) + pad(r.got, 15) + pad(r.anchor, 10) + r.fixture
  );
  if (!r.ok) console.log(pad('', 8) + '↳ reason: ' + r.reason);
}

console.log('\n--- score ---');
console.log(`accuracy:        ${correct}/${total}  (${((correct / total) * 100).toFixed(0)}%)`);
console.log(`false RESOLVE:   ${falseResolve}   (silently dropped live feedback — the costly error)`);
console.log(`false CARRY:     ${falseCarry}   (stale open thread — the mild error)`);
console.log('');

// machine-readable line for the harness / CI
console.log('JSON ' + JSON.stringify({ total, correct, falseResolve, falseCarry }));

process.exit(correct === total ? 0 : 1);
