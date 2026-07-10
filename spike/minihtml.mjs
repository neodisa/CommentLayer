// Tiny dependency-free HTML parser for the spike.
// Good enough for the controlled, well-formed fixtures used here.
// Produces a uniform node shape that both this Node runner and a browser
// DOM adapter can target, so the anchor/diff algorithm stays parser-agnostic.

const VOID = new Set(['br', 'img', 'input', 'hr', 'meta', 'link']);

// node: { type:'element'|'text', tag, attrs:{}, children:[], text, parent }

export function parse(html) {
  const root = { type: 'element', tag: '#root', attrs: {}, children: [], parent: null };
  let cur = root;
  let i = 0;
  const n = html.length;

  while (i < n) {
    if (html[i] === '<') {
      // comment
      if (html.startsWith('<!--', i)) {
        const end = html.indexOf('-->', i);
        i = end === -1 ? n : end + 3;
        continue;
      }
      // closing tag
      if (html[i + 1] === '/') {
        const end = html.indexOf('>', i);
        const tag = html.slice(i + 2, end).trim().toLowerCase();
        // pop up to the matching open tag
        let node = cur;
        while (node && node.tag !== tag) node = node.parent;
        if (node && node.parent) cur = node.parent;
        i = end + 1;
        continue;
      }
      // opening tag
      const end = html.indexOf('>', i);
      let raw = html.slice(i + 1, end).trim();
      const selfClose = raw.endsWith('/');
      if (selfClose) raw = raw.slice(0, -1).trim();
      const { tag, attrs } = parseTag(raw);
      const el = { type: 'element', tag, attrs, children: [], parent: cur, text: '' };
      cur.children.push(el);
      if (!selfClose && !VOID.has(tag)) cur = el;
      i = end + 1;
    } else {
      // text node
      const next = html.indexOf('<', i);
      const end = next === -1 ? n : next;
      const text = html.slice(i, end);
      if (text.trim().length) {
        cur.children.push({ type: 'text', text, children: [], parent: cur });
      }
      i = end;
    }
  }
  return root;
}

function parseTag(raw) {
  const sp = raw.search(/\s/);
  if (sp === -1) return { tag: raw.toLowerCase(), attrs: {} };
  const tag = raw.slice(0, sp).toLowerCase();
  const attrStr = raw.slice(sp + 1);
  const attrs = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*("([^"]*)"|'([^']*)'|(\S+)))?/g;
  let m;
  while ((m = re.exec(attrStr))) {
    const name = m[1].toLowerCase();
    const val = m[3] ?? m[4] ?? m[5] ?? '';
    attrs[name] = val;
  }
  return { tag, attrs };
}

// Collect all element descendants (depth-first).
export function elements(node, out = []) {
  for (const c of node.children) {
    if (c.type === 'element') {
      out.push(c);
      elements(c, out);
    }
  }
  return out;
}

// Concatenated, normalized text of a node's whole subtree.
export function subtreeText(node) {
  let s = '';
  const walk = (x) => {
    if (x.type === 'text') s += x.text + ' ';
    for (const c of x.children) walk(c);
  };
  walk(node);
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}
