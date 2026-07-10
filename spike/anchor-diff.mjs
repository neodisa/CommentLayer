// Core spike algorithm — parser-agnostic.
// Operates on the uniform node shape from minihtml.mjs (or a browser-DOM adapter).
//
// Two jobs:
//   1. fingerprint(el)  -> a stable-ish descriptor captured when a comment is placed.
//   2. classify(fp, treeNext) -> decide, in version N+1, whether the commented
//      region was REGENERATED (auto-resolve) or is UNCHANGED (carry the comment forward).
//
// Design bias (from assumptions.md, rank 2): a false auto-resolve silently drops
// live feedback and destroys trust, while a false carry-forward just leaves a
// slightly-stale open thread. So we ONLY resolve when we are confident the region
// changed. When in doubt -> carry forward.

import { subtreeText } from './minihtml.mjs';

// ---- helpers ---------------------------------------------------------------

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

// A class/id token that looks machine-generated (CSS-in-JS, hashed modules,
// build hashes) carries no semantic meaning and must NOT count as a real change.
function isHashy(token) {
  if (/^(css-|sc-|jsx-|emotion-|_)/i.test(token)) return true;       // styled/emotion/css-modules prefixes
  if (/^[a-z]{1,3}[0-9a-f]{5,}$/i.test(token)) return true;          // e.g. e1a2b3c4
  if (/^[0-9a-f]{6,}$/i.test(token)) return true;                     // pure hex hash
  if (token.length >= 6 && !/[aeiou]/i.test(token)) return true;      // vowelless gibberish
  // mixed-case with no '-' separator => almost certainly a CSS-in-JS generated
  // class (styled-components `kFhUMt`, emotion suffixes). Real utility/BEM
  // classes are lower-case-with-dashes, so this won't touch them.
  if (/[a-z]/.test(token) && /[A-Z]/.test(token) && !token.includes('-') && token.length <= 12) return true;
  return false;
}

function stableClasses(attrs) {
  const cls = (attrs.class || '').split(/\s+/).filter(Boolean);
  return cls.filter((t) => !isHashy(t)).sort();
}

// Structural signature of the subtree: tag skeleton only (ignores text, classes).
// Detects "the shape of this region changed".
function structSig(el) {
  let s = '';
  const walk = (x, d) => {
    if (x.type === 'element') {
      s += x.tag + '(' + d + ')';
      for (const c of x.children) walk(c, d + 1);
    }
  };
  for (const c of el.children) walk(c, 1);
  return hash(s);
}

// Style signature: stable (non-hashed) classes across the subtree, in document
// order. Detects "the styling of this region changed" while ignoring hashed churn.
function styleSig(el) {
  let s = stableClasses(el.attrs).join('.');
  const walk = (x) => {
    if (x.type === 'element') {
      s += '|' + stableClasses(x.attrs).join('.');
      for (const c of x.children) walk(c);
    }
  };
  for (const c of el.children) walk(c);
  return hash(s);
}

function stableId(attrs) {
  if (attrs['data-testid']) return 'testid:' + attrs['data-testid'];
  if (attrs['id'] && !isHashy(attrs['id'])) return 'id:' + attrs['id'];
  if (attrs['aria-label']) return 'aria:' + attrs['aria-label'].toLowerCase();
  return null;
}

// Path of tag names from the root down to this element (structural locator that
// survives class churn). Index = position among same-tag siblings.
function tagPath(el) {
  const path = [];
  let node = el;
  while (node && node.parent) {
    const sibs = node.parent.children.filter(
      (c) => c.type === 'element' && c.tag === node.tag
    );
    const idx = sibs.indexOf(node);
    path.unshift(node.tag + '[' + idx + ']');
    node = node.parent;
  }
  return path;
}

// ---- public API ------------------------------------------------------------

export function fingerprint(el) {
  return {
    tag: el.tag,
    stableId: stableId(el.attrs),
    text: subtreeText(el),
    textHash: hash(subtreeText(el)),
    structHash: structSig(el),
    styleHash: styleSig(el),
    path: tagPath(el),
  };
}

function pathSimilarity(a, b) {
  // compare from the leaf upward
  const ra = [...a].reverse();
  const rb = [...b].reverse();
  let match = 0;
  for (let i = 0; i < Math.min(ra.length, rb.length); i++) {
    if (ra[i] === rb[i]) match++;
    else break;
  }
  return match / Math.max(ra.length, rb.length);
}

function textSimilarity(a, b) {
  if (!a && !b) return 1;
  const wa = new Set(a.split(' ').filter(Boolean));
  const wb = new Set(b.split(' ').filter(Boolean));
  if (!wa.size && !wb.size) return 1;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  return inter / (wa.size + wb.size - inter);
}

// Find the element in the next version that best corresponds to the anchored one.
export function findMatch(fp, candidates) {
  // 1. stable id wins outright
  if (fp.stableId) {
    const byId = candidates.filter((c) => stableId(c.attrs) === fp.stableId);
    if (byId.length === 1) return { el: byId[0], score: 1, via: 'stableId' };
    if (byId.length > 1) {
      // disambiguate by text
      let best = null, bestS = -1;
      for (const c of byId) {
        const s = textSimilarity(fp.text, subtreeText(c));
        if (s > bestS) { bestS = s; best = c; }
      }
      return { el: best, score: 0.9, via: 'stableId+text' };
    }
  }
  // 2. score same-tag candidates by path + text
  // Text identity is a far stronger "this is the same element, possibly moved"
  // signal than position, so it dominates the score. Path only breaks ties when
  // text is ambiguous (e.g. several siblings with the same/blank text).
  let best = null, bestScore = -1, via = 'none';
  for (const c of candidates) {
    if (c.tag !== fp.tag) continue;
    const ps = pathSimilarity(fp.path, tagPath(c));
    const ts = textSimilarity(fp.text, subtreeText(c));
    const score = 0.25 * ps + 0.75 * ts;
    if (score > bestScore) { bestScore = score; best = c; via = `path=${ps.toFixed(2)},text=${ts.toFixed(2)}`; }
  }
  return { el: best, score: bestScore, via };
}

const MATCH_THRESHOLD = 0.35; // below this we treat the region as gone

// Decision for one anchored comment against version N+1.
export function classify(fp, candidates) {
  const m = findMatch(fp, candidates);

  if (!m.el || m.score < MATCH_THRESHOLD) {
    return { decision: 'RESOLVE', reason: 'region removed / replaced', match: m };
  }

  const next = fingerprint(m.el);
  const textChanged = next.textHash !== fp.textHash;
  const structChanged = next.structHash !== fp.structHash;
  const styleChanged = next.styleHash !== fp.styleHash;

  if (textChanged || structChanged || styleChanged) {
    const reasons = [];
    if (textChanged) reasons.push('text');
    if (structChanged) reasons.push('structure');
    if (styleChanged) reasons.push('style');
    return { decision: 'RESOLVE', reason: 'regenerated (' + reasons.join('+') + ')', match: m };
  }

  // matched, and content+structure+meaningful-style identical -> not regenerated
  return { decision: 'CARRY_FORWARD', reason: 'unchanged region', match: m };
}
