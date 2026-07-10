// Stress runner against realistic AI-builder output. `node run-real.mjs`
import { parse, elements } from './minihtml.mjs';
import { fingerprint, classify } from './anchor-diff.mjs';
import { fixtures } from './fixtures-real.mjs';

const findAnchored = (root, id) => elements(root).find((el) => el.attrs['data-anchor'] === id);

let total = 0, correct = 0, falseResolve = 0, falseCarry = 0;
const rows = [];

for (const fx of fixtures) {
  const treeN = parse(fx.vN), treeNext = parse(fx.vNext);
  const cands = elements(treeNext);
  for (const a of fx.anchors) {
    const el = findAnchored(treeN, a.id);
    const res = classify(fingerprint(el), cands);
    const ok = res.decision === a.expect;
    total++; if (ok) correct++; else if (res.decision === 'RESOLVE') falseResolve++; else falseCarry++;
    rows.push({ fixture: fx.name, anchor: a.id, expected: a.expect, got: res.decision, ok, reason: res.reason });
  }
}

const pad = (s, n) => String(s).padEnd(n);
console.log('\n=== Realistic / adversarial stress test ===\n');
console.log(pad('result', 8) + pad('expected', 15) + pad('got', 15) + pad('anchor', 8) + 'fixture');
console.log('-'.repeat(100));
for (const r of rows) {
  console.log(pad(r.ok ? 'PASS' : 'FAIL', 8) + pad(r.expected, 15) + pad(r.got, 15) + pad(r.anchor, 8) + r.fixture);
  if (!r.ok) console.log(pad('', 8) + '↳ ' + r.reason);
}
console.log('\n--- score ---');
console.log(`accuracy:        ${correct}/${total}  (${((correct / total) * 100).toFixed(0)}%)`);
console.log(`false RESOLVE:   ${falseResolve}   (dropped live feedback)`);
console.log(`false CARRY:     ${falseCarry}   (stale open thread)`);
console.log('JSON ' + JSON.stringify({ total, correct, falseResolve, falseCarry }));
process.exit(correct === total ? 0 : 1);
