/*!
 * comment-layer — drop-in Figma-style comments for AI-generated web UIs.
 * A comment is a change request; when its region is regenerated it auto-resolves.
 *
 * Usage:
 *   <script src="comment-layer.js"></script>
 *   <script>
 *     CommentLayer.init({ projectId: 'my-app' });   // localStorage by default
 *     // after your AI rewrites the UI:
 *     CommentLayer.regenerated();
 *   </script>
 *
 * Everything lives in a Shadow DOM so host styles never collide with the widget.
 * No build step, no framework assumptions.
 */
import { buildContextBundle } from './context-bundle.js';

(function (global) {
  'use strict';

  /* ===========================================================================
   * 1. Anchor algorithm  (validated in the spike — Node + real browser DOM)
   *    fingerprint(el) captured at comment time; classify(fp) decides after a
   *    regeneration whether the region was rewritten (RESOLVE) or is unchanged.
   *    Bias: only resolve when confident it changed (a false resolve silently
   *    drops live feedback — the costly error).
   * ========================================================================= */
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
  }
  function isHashy(t) {
    if (/^(css-|sc-|jsx-|emotion-|_)/i.test(t)) return true;
    if (/^[a-z]{1,3}[0-9a-f]{5,}$/i.test(t)) return true;
    if (/^[0-9a-f]{6,}$/i.test(t)) return true;
    if (t.length >= 6 && !/[aeiou]/i.test(t)) return true;
    // mixed-case with no '-' => CSS-in-JS generated class (styled-components,
    // emotion). Utility/BEM classes are lower-case-with-dashes, so unaffected.
    if (/[a-z]/.test(t) && /[A-Z]/.test(t) && !t.includes('-') && t.length <= 12) return true;
    return false;
  }
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const stableClasses = (el) => [...el.classList].filter((t) => !isHashy(t)).sort();

  function structSig(el) {
    let s = '';
    (function walk(x, d) { for (const c of x.children) { s += c.tagName.toLowerCase() + '(' + d + ')'; walk(c, d + 1); } })(el, 1);
    return hash(s);
  }
  function styleSig(el) {
    let s = stableClasses(el).join('.');
    (function walk(x) { for (const c of x.children) { s += '|' + stableClasses(c).join('.'); walk(c); } })(el);
    return hash(s);
  }
  function stableId(el) {
    if (el.getAttribute('data-comment-id')) return 'cid:' + el.getAttribute('data-comment-id');
    if (el.getAttribute('data-testid')) return 'testid:' + el.getAttribute('data-testid');
    if (el.id && !isHashy(el.id)) return 'id:' + el.id;
    if (el.getAttribute('aria-label')) return 'aria:' + norm(el.getAttribute('aria-label'));
    return null;
  }
  function tagPath(el, root) {
    const path = []; let n = el;
    while (n && n !== root && n.parentElement) {
      const sibs = [...n.parentElement.children].filter((c) => c.tagName === n.tagName);
      path.unshift(n.tagName.toLowerCase() + '[' + sibs.indexOf(n) + ']');
      n = n.parentElement;
    }
    return path;
  }
  function fingerprint(el, root) {
    const text = norm(el.textContent);
    return {
      tag: el.tagName.toLowerCase(), stableId: stableId(el), text, textHash: hash(text),
      structHash: structSig(el), styleHash: styleSig(el), path: tagPath(el, root),
    };
  }
  function pathSim(a, b) {
    const ra = [...a].reverse(), rb = [...b].reverse(); let m = 0;
    for (let i = 0; i < Math.min(ra.length, rb.length); i++) { if (ra[i] === rb[i]) m++; else break; }
    return m / Math.max(ra.length, rb.length, 1);
  }
  function textSim(a, b) {
    const wa = new Set(a.split(' ').filter(Boolean)), wb = new Set(b.split(' ').filter(Boolean));
    if (!wa.size && !wb.size) return 1;
    let i = 0; for (const w of wa) if (wb.has(w)) i++;
    return i / (wa.size + wb.size - i || 1);
  }
  const MATCH_THRESHOLD = 0.35;
  function findMatch(fp, root) {
    fp = fp || {};
    const fpText = fp.text || '', fpPath = fp.path || []; // tolerate partial/foreign fingerprints
    const cs = [...root.querySelectorAll('*')];
    if (fp.stableId) {
      const byId = cs.filter((c) => stableId(c) === fp.stableId);
      if (byId.length === 1) return { el: byId[0], score: 1 };
      if (byId.length > 1) {
        let b = null, bs = -1;
        for (const c of byId) { const s = textSim(fpText, norm(c.textContent)); if (s > bs) { bs = s; b = c; } }
        return { el: b, score: 0.9 };
      }
    }
    let best = null, bestScore = -1;
    for (const c of cs) {
      if (c.tagName.toLowerCase() !== fp.tag) continue;
      const score = 0.25 * pathSim(fpPath, tagPath(c, root)) + 0.75 * textSim(fpText, norm(c.textContent));
      if (score > bestScore) { bestScore = score; best = c; }
    }
    return { el: best, score: bestScore };
  }
  function classify(fp, root) {
    const m = findMatch(fp, root);
    if (!m.el || m.score < MATCH_THRESHOLD) return { decision: 'RESOLVE', reason: 'region removed / replaced', el: null };
    const nx = fingerprint(m.el, root);
    const tch = nx.textHash !== fp.textHash, sch = nx.structHash !== fp.structHash, ych = nx.styleHash !== fp.styleHash;
    if (tch || sch || ych) {
      const r = []; if (tch) r.push('text'); if (sch) r.push('structure'); if (ych) r.push('style');
      return { decision: 'RESOLVE', reason: 'regenerated (' + r.join('+') + ')', el: m.el };
    }
    return { decision: 'CARRY_FORWARD', reason: 'unchanged region', el: m.el };
  }

  /* ===========================================================================
   * 2. Storage adapters. Default = localStorage (zero-config). Pass your own
   *    (e.g. the Supabase adapter) via init({ storage: adapter }).
   *    Adapter contract:  load(): Comment[]   save(comments): void
   * ========================================================================= */
  function LocalStorageAdapter(projectId) {
    const key = 'comment-layer:' + projectId;
    return {
      load() { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; } },
      save(comments) { localStorage.setItem(key, JSON.stringify(comments)); },
    };
  }

  /* ===========================================================================
   * 3. Identity (lightweight — a name, stored locally). Real auth is a later
   *    concern handled by the Supabase adapter.
   * ========================================================================= */
  function getUser(preset) {
    if (preset && preset.name) return preset;
    let name = localStorage.getItem('comment-layer:user');
    if (!name) {
      name = (prompt('Your name (for comments):', '') || 'Anonymous').trim() || 'Anonymous';
      localStorage.setItem('comment-layer:user', name);
    }
    return { name };
  }

  /* ===========================================================================
   * 4. The widget (Shadow DOM). Pins overlay the host page; a side panel lists
   *    open comments and history.
   * ========================================================================= */
  // Thin-line inline SVG icons (no external font/CDN). icon(name, size) → markup string.
  const ICONS = {
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    eye: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/>',
    eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 6.15A10.8 10.8 0 0112 6c6.4 0 10 6 10 6a17.6 17.6 0 01-3.4 3.95M6.5 6.55A17.4 17.4 0 002 12s3.6 6.5 10 6.5a10.7 10.7 0 004.2-.85"/>',
    sort: '<path d="M7 4v14M4 15l3 3 3-3M17 20V6M14 9l3-3 3 3"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M14 5l4 4"/>',
    check: '<path d="M4 12.5l5 5L20 6"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    reopen: '<path d="M4 12a8 8 0 108-8 8 8 0 00-6.6 3.5M4 4v3.5h3.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    comment: '<path d="M21 12a8 8 0 01-11.5 7.2L4 20l1.2-4.3A8 8 0 1121 12z"/>',
    element: '<rect x="4.5" y="4.5" width="15" height="15" rx="3.5"/>',
    text: '<path d="M5 6h14M12 6v12M9 19h6"/>',
    multi: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>',
    area: '<path d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4"/>',
    arrow: '<path d="M7 17L17 7M17 7H9M17 7v8"/>',
  };
  function icon(n, s) {
    return '<svg class="ic" width="' + (s || 16) + '" height="' + (s || 16) + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[n] || '') + '</svg>';
  }

  const STYLE = `
    :host{all:initial}
    *{box-sizing:border-box;font-family:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
    .root{position:fixed;inset:0;pointer-events:none;z-index:2147483000;
      --s1:#15181D;--s2:#1B1F26;--s3:#232830;--line:#2A2F38;--line2:#39414C;
      --hi:#F4F6F9;--mid:#A2A9B2;--lo:#6E7681;--white:#fff;--onwhite:#14171C;
      --open:#FBBC55;--openbg:rgba(251,188,85,.13);--ok:#6AD09D;--okbg:rgba(106,208,157,.13);
      --bad:#F37373;--badbg:rgba(243,115,115,.13);--r:12px;--rsm:8px;color:var(--hi)}
    .root svg{display:block}
    .pin{position:fixed;transform:translate(-50%,-50%);min-width:26px;height:26px;padding:0 6px;border-radius:9px;
      background:var(--onwhite);color:var(--white);font-weight:800;font-size:11.5px;font-variant-numeric:tabular-nums;
      display:grid;place-items:center;box-shadow:0 4px 14px rgba(0,0,0,.5),0 0 0 2px rgba(244,246,249,.92);
      pointer-events:auto;cursor:pointer;transition:transform .14s ease}
    .pin:hover{transform:translate(-50%,-50%) scale(1.12)}
    .modes{position:fixed;left:50%;bottom:4px;transform:translateX(-50%);opacity:0;pointer-events:none;
      display:flex;gap:3px;align-items:center;background:var(--s1);border:1px solid var(--line2);border-radius:12px;padding:4px;
      z-index:2147483250;box-shadow:0 24px 60px rgba(0,0,0,.6);transition:opacity .2s ease,bottom .2s ease}
    .modes.shift{left:calc(50% - 186px)}
    .modes.show{opacity:1;bottom:20px;pointer-events:auto}
    .modes .mode{font:600 12px/1 inherit;border-radius:8px;padding:8px 12px;cursor:pointer;display:inline-flex;align-items:center;gap:7px;
      border:0;background:transparent;color:var(--mid);transition:background .12s,color .12s}
    .modes .mode svg{width:15px;height:15px}
    .modes .mode:hover{background:var(--s3);color:var(--hi)}
    .modes .mode.active{background:var(--white);color:var(--onwhite)}
    .mcompose{position:fixed;right:20px;bottom:80px;width:300px;display:none;flex-direction:column;
      background:var(--s1);border:1px solid var(--line2);border-radius:var(--r);padding:12px;pointer-events:auto;
      z-index:2147483250;box-shadow:0 24px 60px rgba(0,0,0,.6);transition:right .2s ease}
    .mcompose.show{display:flex}
    .mcompose.shift{right:378px}
    .mchead{font-size:12px;color:var(--mid);margin-bottom:8px;display:flex;align-items:center;gap:6px}
    .mchead svg{width:14px;height:14px}
    .mchead b{color:var(--hi);font-variant-numeric:tabular-nums}
    .mcta{width:100%;height:70px;resize:none;background:var(--s2);color:var(--hi);border:1px solid var(--line);border-radius:var(--rsm);padding:9px 10px;font:14px/1.5 inherit;outline:none}
    .mcta::placeholder{color:var(--lo)}
    .mcta:focus{border-color:var(--line2)}
    .mcompose .row{display:flex;gap:8px;margin-top:10px;justify-content:flex-end}
    .mcompose .row button{font:600 13px/1 inherit;border-radius:var(--rsm);padding:9px 13px;cursor:pointer;border:1px solid var(--line2);background:transparent;color:var(--mid);display:inline-flex;align-items:center;gap:7px}
    .mcompose .row button:hover{background:var(--s3);color:var(--hi)}
    .mcompose .row button svg{width:14px;height:14px}
    .mcompose .row .primary{background:var(--white);border-color:var(--white);color:var(--onwhite)}
    .mcompose .row .primary:hover{background:#e7eaef}
    .clarea{position:fixed;border:2px dashed var(--open);background:var(--openbg);z-index:2147483000;pointer-events:none;border-radius:6px}
    .mtag{font-size:10.5px;font-weight:600;color:var(--mid);background:var(--s3);border:1px solid var(--line);border-radius:999px;padding:2px 8px;display:inline-flex;align-items:center;gap:4px}
    .mtag svg{width:12px;height:12px}
    .handle{position:fixed;right:0;top:50%;transform:translateY(-50%);z-index:2147483200;pointer-events:auto;cursor:pointer;
      display:flex;flex-direction:column;align-items:center;gap:9px;border:0;border-radius:16px 0 0 16px;
      background:var(--white);color:var(--onwhite);padding:16px 11px;
      box-shadow:-8px 0 28px rgba(0,0,0,.45);transition:right .2s ease,transform .2s ease,background .12s,padding .12s}
    .handle:hover{transform:translateY(-50%) translateX(-4px);padding-left:15px}
    .handle:active{transform:translateY(-50%) translateX(-1px)}
    .handle.shift{right:372px}
    .handle svg{width:18px;height:18px}
    .handle .hlabel{writing-mode:vertical-rl;transform:rotate(180deg);font:600 12px/1 inherit;letter-spacing:.03em}
    .handle.active{background:var(--open)}
    .handle.active:hover{background:#f6c877}
    .cbadge{display:inline-grid;place-items:center;min-width:18px;height:18px;padding:0 5px;
      border-radius:999px;background:var(--onwhite);color:var(--white);font-size:11px;font-weight:700;font-variant-numeric:tabular-nums}
    .handle.active .cbadge{background:rgba(20,23,28,.22);color:var(--onwhite)}
    .pins.hide{display:none}
    .panel{position:fixed;top:0;right:0;width:372px;height:100%;background:var(--s1);border-left:1px solid var(--line);
      pointer-events:auto;display:flex;flex-direction:column;transform:translateX(100%);transition:transform .2s ease;z-index:2147483150}
    .panel.show{transform:none}
    .head{padding:16px 14px 14px 18px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:10px}
    .head .ttl{font-size:15px;font-weight:600;letter-spacing:-.01em}
    .count{font-size:12px;font-weight:600;color:var(--mid);background:var(--s3);border-radius:999px;padding:2px 9px;font-variant-numeric:tabular-nums}
    .head .eye{margin-left:auto}
    .iconbtn{width:34px;height:34px;border-radius:9px;display:grid;place-items:center;cursor:pointer;background:transparent;border:1px solid transparent;color:var(--mid);transition:background .12s,color .12s;padding:0}
    .iconbtn:hover{background:var(--s3);color:var(--hi)}
    .iconbtn svg{width:17px;height:17px}
    .toolbar{display:flex;gap:8px;align-items:center;padding:12px 14px 4px}
    .searchwrap{flex:1;display:flex;align-items:center;gap:8px;background:var(--s2);border:1px solid var(--line);border-radius:var(--rsm);padding:0 10px;transition:border-color .12s}
    .searchwrap:focus-within{border-color:var(--line2)}
    .searchwrap .si{color:var(--lo);display:flex}
    .searchwrap .si svg{width:16px;height:16px}
    .search{flex:1;background:none;border:0;outline:none;color:var(--hi);font:14px inherit;padding:9px 0}
    .search::placeholder{color:var(--lo)}
    .searchx{background:none;border:0;color:var(--mid);cursor:pointer;padding:0 2px;display:flex}
    .searchx[hidden]{display:none}
    .searchx svg{width:15px;height:15px}
    .searchx:hover{color:var(--hi)}
    .sort{cursor:pointer;font:600 12px/1 inherit;white-space:nowrap;border:1px solid var(--line2);background:transparent;color:var(--mid);border-radius:var(--rsm);padding:9px 11px}
    .sort:hover{background:var(--s3);color:var(--hi)}
    .tabs{display:flex;gap:2px;background:var(--s2);border:1px solid var(--line);border-radius:10px;padding:3px;margin:12px 14px 6px}
    .tab{flex:1;cursor:pointer;font:600 12px/1 inherit;padding:8px 6px;border-radius:7px;border:0;background:transparent;color:var(--mid);transition:color .12s}
    .tab:hover{color:var(--hi)}
    .tab.active{background:var(--white);color:var(--onwhite);box-shadow:0 1px 2px rgba(0,0,0,.4)}
    .tab.active:hover{color:var(--onwhite)}
    .list{overflow:auto;padding:10px 14px 20px;flex:1}
    .sect{color:var(--lo);font-size:11px;text-transform:uppercase;letter-spacing:.08em;margin:8px 4px 4px}
    .empty{color:var(--mid);font-size:12.5px;line-height:1.5;padding:10px 4px}
    .c{position:relative;border:1px solid var(--line);border-radius:var(--r);padding:12px 13px;margin-bottom:10px;background:var(--s2);
      cursor:pointer;transition:border-color .12s,background .12s,box-shadow .12s}
    .c:hover{border-color:var(--line2);background:#1e232b;box-shadow:0 0 0 1px rgba(255,255,255,.03)}
    .jump{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:7px;color:var(--lo);cursor:pointer;transition:background .12s,color .12s}
    .jump:hover{background:var(--s3);color:var(--hi)}
    .jump svg{width:15px;height:15px}
    [data-tip]{position:relative}
    [data-tip]::after{content:attr(data-tip);position:absolute;bottom:calc(100% + 7px);left:50%;transform:translateX(-50%) translateY(3px);
      background:#0B0D10;color:var(--hi);border:1px solid var(--line2);border-radius:7px;padding:5px 9px;font:600 11px/1.1 inherit;white-space:nowrap;
      opacity:0;pointer-events:none;transition:opacity .12s ease,transform .12s ease;z-index:2147483300;box-shadow:0 8px 22px rgba(0,0,0,.5)}
    [data-tip]:hover::after{opacity:1;transform:translateX(-50%) translateY(0)}
    .jump[data-tip]::after,.head [data-tip]::after{bottom:auto;top:calc(100% + 6px);left:auto;right:0;transform:translateY(-3px)}
    .jump[data-tip]:hover::after,.head [data-tip]:hover::after{transform:translateY(0)}
    .c .shot{display:block;margin-top:10px;max-width:100%;border:1px solid var(--line);border-radius:9px;cursor:zoom-in}
    .c .otherpage{display:inline-flex;align-items:center;gap:5px;margin-top:8px;font-size:11.5px;color:var(--open)}
    .c .otherpage svg{width:13px;height:13px}
    .c .top{display:flex;align-items:center;gap:8px;margin-bottom:8px}
    .seq{min-width:22px;height:20px;padding:0 6px;border-radius:6px;background:var(--white);color:var(--onwhite);font:800 10.5px/1 inherit;display:grid;place-items:center;flex:none;font-variant-numeric:tabular-nums}
    .c .who{font-weight:600;font-size:13px;color:var(--hi)}
    .badge{margin-left:auto;font-size:11px;font-weight:600;padding:3px 9px;border-radius:999px;display:inline-flex;align-items:center;gap:5px}
    .badge .d{width:6px;height:6px;border-radius:50%}
    .badge.open{background:var(--openbg);color:var(--open)}
    .badge.open .d{background:var(--open)}
    .badge.resolved{background:var(--okbg);color:var(--ok)}
    .badge.resolved .d{background:var(--ok)}
    .c .body{font-size:13.5px;line-height:1.5;color:#dbe0e7}
    .c .meta{color:var(--lo);font-size:11.5px;margin-top:9px;font-variant-numeric:tabular-nums}
    .c .when{color:var(--lo);font-size:11.5px;margin-top:4px;display:flex;align-items:center;gap:5px}
    .c .when svg{width:12px;height:12px}
    .c .acts{display:flex;gap:6px;margin-top:11px}
    .c .acts button{width:30px;height:30px;border-radius:7px;cursor:pointer;border:1px solid transparent;background:transparent;color:var(--mid);display:grid;place-items:center;padding:0;transition:background .12s,border-color .12s,color .12s}
    .c .acts button svg{width:15px;height:15px}
    .c .acts button:hover{background:var(--s3);color:var(--hi)}
    .c .acts .ghost{border-color:var(--line2)}
    .c .acts .primary{background:var(--white);border-color:var(--white);color:var(--onwhite)}
    .c .acts .primary:hover{background:#e7eaef}
    .c .acts .danger:hover{background:var(--badbg);color:var(--bad);border-color:transparent}
    .csel{font-size:12.5px;line-height:1.45;color:var(--mid);border-left:2px solid var(--open);background:rgba(251,188,85,.08);border-radius:0 6px 6px 0;padding:6px 10px;font-style:italic}
    .c .csel{margin-top:8px}
    .compose .csel{margin-bottom:10px}
    .clmark{background:rgba(251,188,85,.32);color:var(--hi);border-radius:2px;padding:0 1px}
    .editform textarea.editta{width:100%;height:72px;resize:vertical;background:var(--s2);color:var(--hi);border:1px solid var(--line);border-radius:var(--rsm);padding:9px 10px;font:14px/1.5 inherit;margin-bottom:8px;outline:none}
    .editform textarea.editta:focus{border-color:var(--line2)}
    .c.hist{opacity:.72}
    .c.hist:hover{opacity:1}
    @keyframes cl-flash{0%{box-shadow:0 0 0 2px var(--white),0 0 20px rgba(255,255,255,.35);border-color:var(--white)}100%{box-shadow:none}}
    .c.flash{animation:cl-flash 1.3s ease}
    .compose{position:fixed;width:290px;background:var(--s1);border:1px solid var(--line2);border-radius:var(--r);padding:12px;
      box-shadow:0 24px 60px rgba(0,0,0,.6);pointer-events:auto;z-index:2147483100}
    .compose textarea{width:100%;height:70px;resize:none;background:var(--s2);color:var(--hi);border:1px solid var(--line);border-radius:var(--rsm);padding:9px 10px;font:14px/1.5 inherit;outline:none}
    .compose textarea::placeholder{color:var(--lo)}
    .compose textarea:focus{border-color:var(--line2)}
    .compose .row{display:flex;gap:8px;margin-top:10px;justify-content:flex-end}
    .compose button{font:600 13px/1 inherit;border-radius:var(--rsm);padding:9px 13px;cursor:pointer;border:1px solid var(--line2);background:transparent;color:var(--mid);display:inline-flex;align-items:center;gap:7px}
    .compose button:hover{background:var(--s3);color:var(--hi)}
    .compose button svg{width:14px;height:14px}
    .compose button.primary{background:var(--white);border-color:var(--white);color:var(--onwhite)}
    .compose button.primary:hover{background:#e7eaef}
    .cllb{position:fixed;inset:0;background:rgba(6,7,9,.86);z-index:2147483400;display:flex;align-items:center;justify-content:center;padding:32px;pointer-events:auto;cursor:zoom-out}
    .cllb img{max-width:92vw;max-height:92vh;border-radius:10px;border:1px solid var(--line2);box-shadow:0 30px 90px rgba(0,0,0,.7)}
    .pfoot{display:flex;align-items:center;gap:7px;padding:9px 14px;border-top:1px solid var(--line);font-size:11.5px;color:var(--lo);flex:none}
    .pfoot kbd{font:700 10px/1 inherit;background:var(--s2);border:1px solid var(--line2);border-bottom-width:2px;border-radius:5px;padding:3px 6px;color:var(--mid)}
    .pinpop{position:fixed;max-width:260px;background:var(--s1);border:1px solid var(--line2);border-radius:10px;padding:10px 12px;box-shadow:0 16px 44px rgba(0,0,0,.6);z-index:2147483260;pointer-events:none;opacity:0;transform:translateY(3px);transition:opacity .12s ease,transform .12s ease}
    .pinpop.show{opacity:1;transform:translateY(0)}
    .pinpop .pptop{display:flex;align-items:center;gap:8px;margin-bottom:6px}
    .pinpop .who{font-weight:600;font-size:13px;color:var(--hi)}
    .pinpop .ppbody{font-size:13px;line-height:1.45;color:#dbe0e7;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}

    /* Controls that only exist on touch / narrow screens are hidden by default. */
    .listbtn{display:none}
    .modes .mstop{display:none}

    /* ---- Mobile / narrow screens (≤640px) ----------------------------------
       The right-edge pull-tab becomes a bottom-right pill in the thumb zone, the
       review panel becomes a full-screen overlay, and the composers dock to the
       bottom. Desktop layout is untouched. */
    @media (max-width:640px){
      .panel{width:100%;height:100%;border-left:0}
      .pfoot{display:none}                              /* “C to comment” hint — no key on touch */

      .handle{top:auto;bottom:calc(18px + env(safe-area-inset-bottom));right:16px;transform:none;
        flex-direction:row;gap:8px;border-radius:999px;padding:13px 18px;box-shadow:0 8px 26px rgba(0,0,0,.5)}
      .handle:hover{transform:none;padding-left:18px}
      .handle:active{transform:scale(.95)}
      .handle.shift{right:16px}                         /* ignore desktop side-shift */
      .handle svg{width:20px;height:20px}
      .handle .hlabel{writing-mode:horizontal-tb;transform:none;font-size:13px;letter-spacing:.01em}

      .listbtn{display:inline-grid;place-items:center;position:fixed;right:16px;
        bottom:calc(76px + env(safe-area-inset-bottom));width:46px;height:46px;border-radius:999px;
        border:1px solid var(--line2);background:var(--s1);color:var(--hi);cursor:pointer;pointer-events:auto;
        z-index:2147483200;box-shadow:0 8px 22px rgba(0,0,0,.5)}
      .listbtn svg{width:19px;height:19px}
      .listbtn .lbadge{position:absolute;top:-5px;right:-5px}

      .arming .handle,.arming .listbtn{display:none}    /* while commenting, the mode bar takes over */
      .panelopen .handle,.panelopen .listbtn{opacity:0;pointer-events:none}

      .modes{left:12px;right:12px;transform:none;bottom:calc(12px + env(safe-area-inset-bottom))}
      .modes.show{bottom:calc(12px + env(safe-area-inset-bottom))}
      .modes.shift{left:12px}
      .modes .mode{flex:1;justify-content:center;padding:12px 6px;font-size:12.5px}
      .modes .mode[data-mode="area"]{display:none}      /* drag-select doesn't map to touch */
      .modes .mstop{display:inline-flex;flex:0 0 auto}

      /* Composers dock above the bottom mode bar (which is always visible while
         commenting), so their action buttons never hide behind it. */
      .mcompose{left:12px;right:12px;width:auto;bottom:calc(80px + env(safe-area-inset-bottom))}
      .mcompose.shift{right:12px}
      .mcta{font-size:16px}                             /* ≥16px avoids iOS auto-zoom */

      .compose{left:12px !important;right:12px !important;width:auto !important;
        top:auto !important;bottom:calc(80px + env(safe-area-inset-bottom)) !important}
      .compose textarea{font-size:16px}

      .search{font-size:16px}
      .pin{min-width:30px;height:30px}                  /* larger tap target */
    }
  `;

  /* ===========================================================================
   * 5. Controller
   * ========================================================================= */
  const CommentLayer = {
    version: '1.1.0',   // bump on release; exposed so hosts/self-hosters can check what they run
    _inited: false,
    init(opts = {}) {
      if (this._inited) return this;
      this.opts = opts;
      this.projectId = opts.projectId || 'default';
      this.target = (typeof opts.target === 'string' ? document.querySelector(opts.target) : opts.target) || document.body;
      this.store = opts.storage && typeof opts.storage === 'object' ? opts.storage : LocalStorageAdapter(this.projectId);
      this.user = opts.user || null;
      this.appVersion = opts.version != null ? opts.version : null;
      this.comments = this.store.load();
      this._backupKey = 'comment-layer:backup:' + this.projectId;
      this._recoverBackup();          // resurrect anything a failed write left behind
      this._backfillSeq();            // give legacy comments a stable number too
      // Monotonic display numbering: remember the highest seq ever issued (per project,
      // in localStorage) so deleting a comment never frees its number for reuse.
      this._seqHighKey = 'comment-layer:seqmax:' + this.projectId;
      this._seqHigh = this.comments.reduce((m, c) => Math.max(m, (c.meta && c.meta.seq) || 0), 0);
      try { this._seqHigh = Math.max(this._seqHigh, parseInt(localStorage.getItem(this._seqHighKey) || '0', 10) || 0); } catch (e) {}
      this.commentMode = false;
      this.pending = null;
      this._buildUI();
      this._relocate();
      this._render();
      if (opts.autoDetectRegeneration) this._watch();
      // Live updates: re-render when the backing store reports external changes
      // (e.g. another reviewer added a comment) — no page reload needed.
      if (this.store.subscribe) this.store.subscribe((comments) => this._onExternalChange(comments));
      window.addEventListener('scroll', () => this._placePins(), true);
      window.addEventListener('resize', () => this._placePins());
      this._inited = true;
      return this;
    },

    // Merge an authoritative set from the store with any local-only (unsynced)
    // comments, then re-render. Never drops a local comment the server lacks yet.
    _onExternalChange(external) {
      if (!Array.isArray(external)) return;
      const byId = new Map(external.map((c) => [c.id, c]));
      // Keep a local comment the server lacks ONLY if it's still unsynced (pending).
      // A synced comment now absent was deleted elsewhere → let it go (live delete).
      for (const local of this.comments) if (!byId.has(local.id) && local._pending) byId.set(local.id, local);
      this.comments = [...byId.values()];
      this._seqHigh = this.comments.reduce((m, c) => Math.max(m, (c.meta && c.meta.seq) || 0), this._seqHigh || 0);
      this._relocate();
      this._render();
    },

    _buildUI() {
      const host = document.createElement('div');
      host.setAttribute('data-comment-layer', '');
      this._host = host;
      document.body.appendChild(host);
      const sh = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style'); style.textContent = STYLE; sh.appendChild(style);
      const root = document.createElement('div'); root.className = 'root'; sh.appendChild(root);
      root.innerHTML = `
        <div class="pins"></div>
        <div class="pinpop"></div>
        <div class="modes">
          <button class="mode active" data-mode="element" title="Comment on one element">${icon('element')}Element</button>
          <button class="mode" data-mode="text" title="Select text and comment on it">${icon('text')}Text</button>
          <button class="mode" data-mode="multi" title="Pick several elements for one comment">${icon('multi')}Multi</button>
          <button class="mode" data-mode="area" title="Drag a region to comment on">${icon('area')}Area</button>
          <button class="mode mstop" title="Stop commenting">${icon('x', 15)}Done</button>
        </div>
        <div class="mcompose">
          <div class="mchead">${icon('multi', 14)}Comment on <b class="mccount">0</b> element(s)</div>
          <textarea class="mcta" placeholder="Leave a change request…"></textarea>
          <div class="row"><button class="mccancel">Clear</button><button class="primary mcsave">${icon('check')}Comment</button></div>
        </div>
        <button class="handle" title="Comment — open the panel">
          <span class="hicon">${icon('comment', 18)}</span>
          <span class="hlabel lbl">Comment</span>
          <span class="cbadge" hidden></span>
        </button>
        <button class="listbtn" title="Open comments" aria-label="Open comments">${icon('comment', 18)}<span class="lbadge cbadge" hidden></span></button>
        <div class="panel">
          <div class="head">
            <span class="ttl">Comments</span><span class="count">0</span>
            <button class="eye iconbtn" data-tip="Hide pins" aria-label="Hide pins">${icon('eyeOff')}</button>
            <button class="x iconbtn" data-tip="Close panel" aria-label="Close panel">${icon('x')}</button>
          </div>
          <div class="toolbar">
            <div class="searchwrap"><span class="si">${icon('search')}</span><input class="search" type="text" placeholder="Search comments…"><button class="searchx" hidden title="Clear">${icon('x', 15)}</button></div>
            <button class="sort" title="Sort by date">↓ Newest</button>
          </div>
          <div class="tabs"><button class="tab tabOpen active" data-tab="open">Open</button><button class="tab tabClosed" data-tab="resolved">Closed</button></div>
          <div class="list"></div>
          <div class="pfoot"><kbd>C</kbd> to comment</div>
        </div>`;
      this._sh = root;
      this._pins = root.querySelector('.pins');
      this._pinpop = root.querySelector('.pinpop');
      this._panel = root.querySelector('.panel');
      this._list = root.querySelector('.list');
      this._fab = root.querySelector('.handle');       // right-edge pull tab (opens panel + arms commenting)
      this._toggleBtn = this._fab;
      this._cbadge = root.querySelector('.cbadge');
      this._listbtn = root.querySelector('.listbtn');  // mobile-only: opens the review panel
      this._lbadge = root.querySelector('.lbadge');    // open-count badge on the mobile list button
      this._lbl = root.querySelector('.lbl');
      this._total = root.querySelector('.count');
      this._tab = 'open';
      this._tabOpen = root.querySelector('.tabOpen');
      this._tabClosed = root.querySelector('.tabClosed');
      root.querySelectorAll('.tab').forEach((t) => {
        t.onclick = () => { this._tab = t.getAttribute('data-tab'); this._render(); };
      });
      // Search + sort toolbar.
      this._query = '';
      this._sort = 'new'; // 'new' = newest first (by seq), 'old' = oldest first
      const search = root.querySelector('.search');
      const searchx = root.querySelector('.searchx');
      search.oninput = () => { this._query = search.value.trim().toLowerCase(); searchx.hidden = !search.value; this._render(); };
      searchx.onclick = () => { search.value = ''; this._query = ''; searchx.hidden = true; this._render(); search.focus(); };
      this._sortBtn = root.querySelector('.sort');
      this._sortBtn.onclick = () => {
        // cycle: newest → oldest → recently closed
        const was = this._sort;
        this._sort = this._sort === 'new' ? 'old' : this._sort === 'old' ? 'closed' : 'new';
        this._sortBtn.textContent = this._sort === 'new' ? '↓ Newest' : this._sort === 'old' ? '↑ Oldest' : '↺ Recent';
        // "recently closed" applies to the Closed list — show it, then put the tab
        // back where it was once the cycle moves off 'closed'.
        if (this._sort === 'closed') { this._tabWas = this._tab; this._tab = 'resolved'; }
        else if (was === 'closed') { this._tab = this._tabWas || 'open'; this._tabWas = null; }
        this._render();
      };
      this._pinsHidden = false;
      this._eye = root.querySelector('.eye');
      this._eye.onclick = () => this._togglePins();

      // Annotation modes: element (default) | text | multi | area, + animation pause.
      this._mode = 'element';
      this._multiSel = [];
      this._modesBar = root.querySelector('.modes');
      this._mcompose = root.querySelector('.mcompose');
      this._mcta = root.querySelector('.mcta');
      this._mccount = root.querySelector('.mccount');
      root.querySelectorAll('.mode:not(.mstop)').forEach((b) => {
        b.onclick = () => {
          this._clearMulti(); this._clearArea(); this._setHover(false); // drop any element outline
          this._mode = b.getAttribute('data-mode');
          root.querySelectorAll('.mode:not(.mstop)').forEach((x) => x.classList.toggle('active', x === b));
          this._mcompose.classList.toggle('show', this._mode === 'multi'); // multi uses a modal
          this._armComment(true); // picking a mode readies commenting
        };
      });
      // Mobile mode bar carries a "Done" button (the pull-tab is hidden while commenting).
      root.querySelector('.mstop').onclick = () => this._armComment(false);
      root.querySelector('.mcsave').onclick = () => this._finishMulti();
      root.querySelector('.mccancel').onclick = () => this._clearMulti();
      this._mcta.onkeydown = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); this._finishMulti(); } };
      // The pull tab toggles comment mode. Turning it ON also opens the panel (for
      // context); comment mode and the panel are otherwise independent — closing the
      // panel does NOT stop commenting.
      this._toggleBtn.onclick = () => this._toggleComment();
      // Mobile: a dedicated button opens/closes the full-screen review panel, so the
      // pull-tab is free to just toggle comment mode without covering the page.
      this._listbtn.onclick = () => (this._panel.classList.contains('show') ? this._closePanel() : this._openPanel());
      root.querySelector('.x').onclick = () => this._closePanel();

      // Delegated actions on comment cards (resolve / reopen / delete),
      // and clicking the card body focuses + flashes its element on the page.
      this._editingId = null;
      this._list.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-cl-act]');
        if (btn) {
          const id = btn.getAttribute('data-cl-id');
          const act = btn.getAttribute('data-cl-act');
          if (act === 'resolve') this.resolveComment(id);
          else if (act === 'reopen') this.reopenComment(id);
          else if (act === 'delete') this.removeComment(id);
          else if (act === 'edit') { this._editingId = id; this._render(); }
          else if (act === 'edit-cancel') { this._editingId = null; this._render(); }
          else if (act === 'edit-save') {
            const ta = btn.closest('.c').querySelector('.editta');
            const v = ta && ta.value.trim();
            const c = this.comments.find((x) => x.id === id);
            if (c && v) { c.text = v; c._pending = true; }
            this._editingId = null; this._persist(); this._render();
          }
          return;
        }
        // Click a card's screenshot → open it full-screen (lightbox), not navigate.
        const img = e.target.closest('img.shot');
        if (img) { e.stopPropagation(); this._openLightbox(img.getAttribute('src')); return; }
        // Don't navigate while typing in an editor; ignore clicks inside edit forms.
        if (this._editingId || e.target.closest('.editform')) return;
        const card = e.target.closest('.c');
        if (card && card.id) this._focusElement(card.id.slice(1)); // 'c<id>' → <id>
      });

      // capture clicks on the host page while in comment mode (stays armed so
      // you can drop several comments in a row until you click Stop / close)
      this._clickHandler = (e) => {
        if (!this.commentMode) return;
        if (this._host.contains(e.target)) return; // ignore widget chrome
        const el = e.target;
        if (!this.target.contains(el)) return;
        e.preventDefault(); e.stopPropagation();
        if (this._mode === 'multi') { this._toggleMulti(el); return; }
        if (this._mode === 'area' || this._mode === 'text') return; // handled by drag / mouseup
        const sel = (this._lastSel && el.textContent && el.textContent.includes(this._lastSel)) ? this._lastSel : '';
        this._openCompose(el, sel, sel ? { mode: 'text' } : null);
        this._lastSel = '';
      };
      document.addEventListener('click', this._clickHandler, true);

      // Text mode: a selection finishes on mouseup.
      this._upHandler = (e) => {
        if (!this.commentMode || this._mode !== 'text' || this._host.contains(e.target)) return;
        const s = window.getSelection && window.getSelection();
        const txt = s && s.toString().trim();
        if (!txt) return;
        const anchor = (s.anchorNode && s.anchorNode.nodeType === 3 ? s.anchorNode.parentElement : s.anchorNode) || e.target;
        if (!this.target.contains(anchor)) return;
        this._openCompose(anchor, txt, { mode: 'text' });
      };
      document.addEventListener('mouseup', this._upHandler, true);

      // Area mode: drag a rectangle → comment on the region.
      this._area = null; this._areaBox = null;
      this._areaDown = (e) => {
        if (!this.commentMode || this._mode !== 'area' || this._host.contains(e.target) || !this.target.contains(e.target)) return;
        e.preventDefault();
        this._area = { x0: e.clientX, y0: e.clientY };
        this._areaBox = document.createElement('div'); this._areaBox.className = 'clarea';
        this._pins.appendChild(this._areaBox);
      };
      this._areaMove = (e) => {
        if (!this._area || !this._areaBox) return;
        const x = Math.min(e.clientX, this._area.x0), y = Math.min(e.clientY, this._area.y0);
        const w = Math.abs(e.clientX - this._area.x0), h = Math.abs(e.clientY - this._area.y0);
        Object.assign(this._areaBox.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
      };
      this._areaUp = (e) => {
        if (!this._area) return;
        const x = Math.min(e.clientX, this._area.x0), y = Math.min(e.clientY, this._area.y0);
        const w = Math.abs(e.clientX - this._area.x0), h = Math.abs(e.clientY - this._area.y0);
        this._clearArea();
        if (w < 8 || h < 8) return; // ignore stray clicks
        const el = this._elementAt(x + w / 2, y + h / 2);
        if (el) this._openCompose(el, '', { mode: 'area', rect: { x, y, w, h } });
      };
      document.addEventListener('mousedown', this._areaDown, true);
      document.addEventListener('mousemove', this._areaMove, true);
      document.addEventListener('mouseup', this._areaUp, true);

      // lightweight hover highlight in comment mode
      this._hoverEl = null;
      this._moveHandler = (e) => {
        if (!this.commentMode) return;
        if (this._hoverEl) { this._hoverEl.classList.remove('cl-hl'); this._hoverEl = null; }
        // Only outline elements when you're actually picking elements. In text /
        // area modes the outline is confusing (you're selecting text / a region).
        if (this._mode !== 'element' && this._mode !== 'multi') return;
        const el = e.target;
        if (el && this.target.contains(el) && !this._host.contains(el)) { el.classList.add('cl-hl'); this._hoverEl = el; }
      };
      document.addEventListener('mousemove', this._moveHandler, true);

      // Remember the last non-empty text selection so a click can turn it into a
      // text-range comment (the click itself usually collapses the selection).
      this._lastSel = '';
      this._selHandler = () => {
        const s = window.getSelection && window.getSelection();
        const t = s && s.toString().trim();
        if (t) this._lastSel = t;
      };
      document.addEventListener('selectionchange', this._selHandler);

      // Keyboard shortcuts: C = comment mode, P = panel, H = hide pins, Esc = cancel/close.
      this._keyHandler = (e) => {
        const a = document.activeElement;
        const typing = !!(a && (a === this._host || /^(input|textarea|select)$/i.test(a.tagName || '') || a.isContentEditable));
        if (e.key === 'Escape') {
          const lb = this._sh.querySelector('.cllb');
          if (lb) { lb.remove(); return; }
          const compose = this._sh.querySelector('.compose');
          if (compose) { compose.remove(); return; }
          if (this._editingId) { this._editingId = null; this._render(); return; }
          // Peel back one layer at a time: leave comment mode first (also clears any
          // multi/area selection — _armComment(false) does that), THEN close the panel.
          // Works with the panel closed too, since comment mode is panel-independent.
          if (this.commentMode) { this._armComment(false); return; }
          if (this._panel.classList.contains('show')) this._closePanel();
          return;
        }
        if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
        const k = e.key.toLowerCase();
        if (k === 'c') { this._toggleComment(); }
        else if (k === 'p') { this._panel.classList.contains('show') ? this._closePanel() : this._openPanel(); }
        else if (k === 'h') { this._togglePins(); }
      };
      // Bind on `window` (not `document`) in the capture phase: window capture runs
      // before any document- or target-level handler, so a host page that intercepts
      // keydown on document (or in the bubble phase) can't swallow the shortcut. This
      // is why `C` failed on some host apps. One target only — no double-firing.
      window.addEventListener('keydown', this._keyHandler, true);

      // host-page styles (light DOM): hover highlight + page shift when panel open
      const hl = document.createElement('style');
      hl.textContent = '.cl-hl{outline:2px solid #FBBC55 !important;outline-offset:2px;cursor:crosshair !important}'
        + '.cl-msel{outline:2px solid #FBBC55 !important;outline-offset:2px;box-shadow:0 0 0 4px rgba(251,188,85,.22) !important}'
        + 'body.cl-shift{margin-right:372px !important;transition:margin-right .2s ease}'
        + '@keyframes cl-el-flash{0%{outline:3px solid #FBBC55;outline-offset:2px;box-shadow:0 0 0 4px rgba(251,188,85,.4)}100%{outline:3px solid transparent;box-shadow:none}}'
        + '.cl-el-flash{animation:cl-el-flash 1.5s ease}';
      document.head.appendChild(hl);
    },

    // Panel open/close also shifts the host page (margin) so the panel sits
    // beside content instead of covering it, and moves the FAB clear of the panel.
    _openPanel() {
      this._panel.classList.add('show');
      this._sh.classList.add('panelopen'); // mobile: full-screen overlay → hide the floating controls behind it
      // On mobile the panel is a full-screen overlay, so the page must NOT be pushed
      // aside (that would shove content off a phone screen). Only shift on desktop.
      if (!this._isMobile()) {
        document.body.classList.add('cl-shift');
        this._fab.classList.add('shift');
        if (this._mcompose) this._mcompose.classList.add('shift');
        if (this._modesBar) this._modesBar.classList.add('shift'); // center the bottom mode bar in the area left of the panel
      }
      setTimeout(() => this._placePins(), 220); // reflow finished → reposition pins
    },
    _closePanel() {
      this._panel.classList.remove('show');
      this._sh.classList.remove('panelopen');
      document.body.classList.remove('cl-shift');
      this._fab.classList.remove('shift');
      if (this._mcompose) this._mcompose.classList.remove('shift'); // keep 'show': an armed multi-selection must stay saveable with the panel closed
      if (this._modesBar) this._modesBar.classList.remove('shift'); // mode bar re-centers on the full viewport
      // NOTE: closing the panel does NOT disarm — you can keep commenting with it closed.
      setTimeout(() => this._placePins(), 220);
    },
    // Narrow / touch layout: matches the CSS breakpoint so JS behavior stays in sync.
    _isMobile() { return typeof matchMedia === 'function' && matchMedia('(max-width:640px)').matches; },
    _armComment(on) {
      this.commentMode = on;
      this._toggleBtn.classList.toggle('active', on);
      this._sh.classList.toggle('arming', on); // mobile: swap the pull-tab for the bottom mode bar
      if (this._lbl) this._lbl.textContent = on ? 'Stop' : 'Comment'; // vertical tab label; icon + badge stay
      if (this._modesBar) this._modesBar.classList.toggle('show', on); // bar shows only while actively commenting
      if (!on) { this._clearMulti(); this._clearArea(); if (this._mcompose) this._mcompose.classList.remove('show'); }
      this._setHover(on);
    },
    // Toggle comment mode independently of the panel. On desktop, turning it on also
    // opens the side panel for context; on mobile the panel is a full-screen overlay,
    // so we leave it closed (you need to see the page to tap elements — the list
    // button opens the panel to review). Turning it off never touches the panel.
    _toggleComment() {
      if (this.commentMode) { this._armComment(false); }
      else {
        if (!this._isMobile() && !this._panel.classList.contains('show')) this._openPanel();
        this._armComment(true);
      }
    },

    // ---- annotation modes ----
    _toggleMulti(el) {
      const i = this._multiSel.indexOf(el);
      if (i >= 0) { this._multiSel.splice(i, 1); el.classList.remove('cl-msel'); }
      else { this._multiSel.push(el); el.classList.add('cl-msel'); }
      if (this._mccount) this._mccount.textContent = this._multiSel.length;
    },
    _clearMulti() {
      (this._multiSel || []).forEach((el) => el.classList.remove('cl-msel'));
      this._multiSel = [];
      if (this._mccount) this._mccount.textContent = '0';
      if (this._mcta) this._mcta.value = '';
    },
    // Multi: comment from the bottom-right modal on all picked elements.
    _finishMulti() {
      const text = this._mcta ? this._mcta.value.trim() : '';
      if (!this._multiSel.length || !text) { if (this._mcta) this._mcta.focus(); return; }
      const els = this._multiSel.slice();
      const fps = els.map((el) => fingerprint(el, this.target));
      const rect = unionRect(els);   // screenshot the whole selection, not just the anchor
      this._clearMulti();
      this._addComment(els[0], text, '', { mode: 'multi', fps, count: els.length, rect });
    },
    _clearArea() { if (this._areaBox) { this._areaBox.remove(); this._areaBox = null; } this._area = null; },
    _elementAt(x, y) {
      const el = document.elementFromPoint(x, y);
      return (el && this.target.contains(el) && !this._host.contains(el)) ? el : null;
    },

    _setHover(on) { if (!on && this._hoverEl) { this._hoverEl.classList.remove('cl-hl'); this._hoverEl = null; } },
    _togglePins() {
      this._pinsHidden = !this._pinsHidden;
      this._pins.classList.toggle('hide', this._pinsHidden);
      if (this._eye) {
        this._eye.innerHTML = this._pinsHidden ? icon('eye') : icon('eyeOff');
        const t = this._pinsHidden ? 'Show pins' : 'Hide pins';
        this._eye.setAttribute('data-tip', t); this._eye.setAttribute('aria-label', t);
      }
    },

    _openCompose(el, sel, extra) {
      const existing = this._sh.querySelector('.compose'); if (existing) existing.remove();
      const r = el.getBoundingClientRect();
      const box = document.createElement('div');
      box.className = 'compose';
      const rightBound = window.innerWidth - 260 - (this._panel.classList.contains('show') ? 340 : 0);
      box.style.left = Math.max(8, Math.min(r.left, rightBound)) + 'px';
      const m = extra && extra.mode;
      // What is being commented on — shown in every mode (like the text quote), so the target is always clear.
      const desc = (e) => { const t = e.tagName.toLowerCase(); const tx = (e.textContent || '').replace(/\s+/g, ' ').trim(); return '&lt;' + t + '&gt;' + (tx ? ' · “' + esc(tx.slice(0, 50)) + '”' : ''); };
      const note = m === 'multi' ? `${icon('multi', 13)} ${extra.count} elements`
        : m === 'area' ? `${icon('area', 13)} area · ${desc(el)}`
        : sel ? `on: “${esc(sel.slice(0, 120))}”`
        : `on ${desc(el)}`;
      box.innerHTML = `<div class="csel">${note}</div><textarea placeholder="Leave a change request…"></textarea>
        <div class="row"><button class="cancel">Cancel</button><button class="primary save">Comment</button></div>`;
      this._sh.appendChild(box);
      // Vertical placement: below the element, but flip above / clamp so it never runs off-screen.
      const boxH = box.offsetHeight || 170, vpad = 12;
      let top = r.bottom + 8;
      if (top + boxH > window.innerHeight - vpad) {
        const above = r.top - boxH - 8;
        top = above >= vpad ? above : Math.max(vpad, window.innerHeight - boxH - vpad);
      }
      box.style.top = top + 'px';
      const ta = box.querySelector('textarea'); ta.focus();
      box.querySelector('.cancel').onclick = () => box.remove();
      box.querySelector('.save').onclick = () => {
        const text = ta.value.trim(); if (!text) return;
        this._addComment(el, text, sel, extra); box.remove();
      };
    },

    _addComment(el, text, sel, extra) {
      const user = getUser(this.user);
      const ctx = buildContextBundle({
        outerHTML: el.outerHTML,
        text: el.textContent,
        url: location.href,
        route: location.pathname + location.hash,
        version: this.appVersion,
        viewport: { w: window.innerWidth, h: window.innerHeight },
        ts: nowStamp(),
      });
      ctx.meta.seq = this._nextSeq();   // stable display number, assigned once
      if (sel) ctx.meta.sel = sel;               // the exact text the reviewer selected
      if (extra && extra.mode) ctx.meta.mode = extra.mode;      // element|text|multi|area
      if (extra && extra.fps) ctx.meta.fps = extra.fps;         // multi: fingerprints of all picked elements
      if (extra && extra.rect) ctx.meta.rect = extra.rect;      // area: drawn region
      if (extra && extra.count) ctx.meta.count = extra.count;
      this.comments.push({
        id: genId(), author: user.name, text, status: 'open',
        fp: fingerprint(el, this.target),
        htmlSnapshot: ctx.htmlSnapshot, meta: ctx.meta,
        bornV: this._version(), ts: nowStamp(),
        _pending: true,   // unsynced until _persist confirms — protects it from live-merge drop
      });
      this._persist(); this._relocate(); this._render();   // don't force the panel open — allow commenting with it closed

      // Capture a small screenshot so the "before" is visible later. For area /
      // multi we shoot the whole annotated region (extra.rect); for element / text
      // we shoot the element itself. Async + fail-soft.
      const newId = this.comments[this.comments.length - 1].id;
      const shotTarget = (extra && extra.rect) ? extra.rect : el;
      this._captureShot(shotTarget).then((shot) => {
        if (!shot) return;
        const c = this.comments.find((x) => x.id === newId);
        if (!c) return;
        c.meta = c.meta || {}; c.meta.shot = shot;
        this._persist(); this._render();
      });
    },

    // target = an element (element/text modes) OR a viewport rect {x,y,w,h}
    // (area/multi modes → shoot the whole annotated region).
    async _captureShot(target) {
      try {
        const h2c = await loadShotLib();
        const base = { backgroundColor: '#ffffff', scale: 1, useCORS: true, logging: false };
        let canvas;
        if (target && target.nodeType === 1) {
          target.classList.remove('cl-hl');            // don't bake the hover outline into the shot
          canvas = await h2c(target, base);
        } else if (target && typeof target.w === 'number') {
          const r = target;
          canvas = await h2c(document.body, Object.assign({
            x: r.x + (window.scrollX || 0), y: r.y + (window.scrollY || 0),
            width: Math.max(1, r.w), height: Math.max(1, r.h),
            windowWidth: document.documentElement.scrollWidth,
            windowHeight: document.documentElement.scrollHeight,
          }, base));
        } else { return null; }
        const maxW = 360, k = Math.min(1, maxW / (canvas.width || maxW)) || 1;
        const out = document.createElement('canvas');
        out.width = Math.max(1, Math.round(canvas.width * k));
        out.height = Math.max(1, Math.round(canvas.height * k));
        out.getContext('2d').drawImage(canvas, 0, 0, out.width, out.height);
        return out.toDataURL('image/jpeg', 0.6);      // small; stored inline in the comment meta
      } catch (e) { return null; }
    },

    // The core loop: call after the UI is regenerated.
    regenerated() {
      this._bumpVersion();                       // the new version is now current
      let resolved = 0, carried = 0;
      for (const c of this.comments) {
        if (c.status !== 'open') continue;
        const res = classify(c.fp, this.target);
        if (res.decision === 'RESOLVE') {
          c.status = 'resolved'; c.resolveReason = res.reason; c.resolvedV = this._version(); c.meta = c.meta || {}; c.meta.resolvedAt = Date.now(); resolved++;
        } else {
          c._el = res.el; c.fp = fingerprint(res.el, this.target); carried++; // re-baseline to displayed version
        }
      }
      this._persist(); this._render(); this._placePins();
      return { resolved, carried };
    },

    _watch() {
      let t; const obs = new MutationObserver(() => { clearTimeout(t); t = setTimeout(() => this.regenerated(), 400); });
      obs.observe(this.target, { childList: true, subtree: true, characterData: true });
      this._obs = obs;
    },

    _relocate() { // find each open comment's current element in the live DOM
      for (const c of this.comments) {
        if (c.status !== 'open') { c._el = null; continue; }
        try { const m = findMatch(c.fp, this.target); c._el = (m.el && m.score >= MATCH_THRESHOLD) ? m.el : null; }
        catch (e) { c._el = null; } // one malformed comment must never break the panel
      }
    },

    _placePins() {
      this._pins.innerHTML = '';
      this._hidePinPop();
      for (const c of this.comments) {
        if (c.status !== 'open' || !c._el) continue;
        const r = c._el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        const p = document.createElement('div');
        p.className = 'pin'; p.textContent = this._seqOf(c);
        p.style.left = (r.left + 10) + 'px'; p.style.top = (r.top + 10) + 'px';
        p.onclick = () => this._focusCard(c.id);
        p.onmouseenter = () => this._showPinPop(p, c);   // hover → preview the comment beside the pin
        p.onmouseleave = () => this._hidePinPop();
        this._pins.appendChild(p);
      }
    },

    // Hover preview: a small card with the comment shown next to its pin.
    _showPinPop(pin, c) {
      const pop = this._pinpop; if (!pop) return;
      const badge = c.status === 'open'
        ? '<span class="badge open"><span class="d"></span>open</span>'
        : '<span class="badge resolved"><span class="d"></span>resolved</span>';
      pop.innerHTML = `<div class="pptop"><span class="seq">${this._seqOf(c)}</span><span class="who">${esc(c.author)}</span>${badge}</div><div class="ppbody">${esc(c.text)}</div>`;
      pop.classList.add('show');
      const r = pin.getBoundingClientRect(), gap = 10, pad = 10;
      const pw = pop.offsetWidth, ph = pop.offsetHeight;
      let left = r.right + gap;
      if (left + pw > window.innerWidth - pad) left = r.left - pw - gap;   // flip to the left near the edge
      left = Math.max(pad, left);
      let top = r.top + r.height / 2 - ph / 2;
      top = Math.max(pad, Math.min(top, window.innerHeight - ph - pad));
      pop.style.left = left + 'px'; pop.style.top = top + 'px';
    },
    _hidePinPop() { if (this._pinpop) this._pinpop.classList.remove('show'); },

    // Clicking a pin opens the panel, scrolls to its card and flashes it.
    _focusCard(id) {
      this._openPanel();
      const el = this._sh.querySelector('#c' + id);
      if (!el) return;
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); // restart anim
      setTimeout(() => el.classList.remove('flash'), 1400);
    },

    // Reverse of _focusCard: clicking a card scrolls the page to its element and
    // flashes that element (host DOM). Only works for a comment matched to a live element.
    _focusElement(id) {
      const c = this.comments.find((x) => x.id === id); if (!c) return;
      // Comment made on another page → navigate there (multi-page apps). The widget
      // re-inits on that page and its pin/element will be present.
      const route = location.pathname + location.hash;
      if (c.meta && c.meta.route && c.meta.route !== route && c.meta.url) { location.href = c.meta.url; return; }
      let el = c._el;
      if (!el) { const m = findMatch(c.fp, this.target); el = (m.el && m.score >= MATCH_THRESHOLD) ? m.el : null; c._el = el; }
      if (!el) return;
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.remove('cl-el-flash'); void el.offsetWidth; el.classList.add('cl-el-flash');
      setTimeout(() => el.classList.remove('cl-el-flash'), 1500);
    },

    // Full-screen preview of a comment's screenshot; click anywhere (or Esc) to close.
    _openLightbox(src) {
      if (!src) return;
      const lb = document.createElement('div'); lb.className = 'cllb';
      const img = document.createElement('img'); img.src = src; img.alt = 'comment snapshot';
      lb.appendChild(img); lb.onclick = () => lb.remove();
      this._sh.appendChild(lb);
    },

    _render() {
      // Sort: creation order (new/old), or by close-recency (closed = most recently resolved first).
      // Close time lives in meta.resolvedAt (jsonb → persists through Supabase); tolerate the
      // old top-level field and comments with no recorded close time (fall back to newest-created).
      const closedAt = (c) => (c.meta && c.meta.resolvedAt) || c.resolvedAt || 0;
      const bySort = this._sort === 'closed'
        ? (a, b) => (closedAt(b) - closedAt(a)) || (this._seqOf(b) - this._seqOf(a))
        : (a, b) => (this._seqOf(a) - this._seqOf(b)) * (this._sort === 'old' ? 1 : -1);
      const open = this.comments.filter((c) => c.status === 'open').sort(bySort);
      const hist = this.comments.filter((c) => c.status === 'resolved').sort(bySort);
      // Badge on the FAB: open comments on THIS page (by route; legacy w/o route count as here).
      const route = location.pathname + location.hash;
      const hereOpen = open.filter((c) => !c.meta || !c.meta.route || c.meta.route === route).length;
      if (this._cbadge) { this._cbadge.textContent = hereOpen; this._cbadge.hidden = hereOpen === 0; }
      if (this._lbadge) { this._lbadge.textContent = hereOpen; this._lbadge.hidden = hereOpen === 0; }
      if (this._total) this._total.textContent = this.comments.length;
      // Tabs: show only the active set (Open | Closed), not both stacked. Counts are totals.
      const tab = this._tab || 'open';
      if (this._tabOpen) { this._tabOpen.textContent = `Open (${open.length})`; this._tabOpen.classList.toggle('active', tab === 'open'); }
      if (this._tabClosed) { this._tabClosed.textContent = `Closed (${hist.length})`; this._tabClosed.classList.toggle('active', tab === 'resolved'); }
      let list = tab === 'resolved' ? hist : open;
      // Search filter (text / author / selected phrase), within the active tab.
      const q = this._query;
      if (q) list = list.filter((c) => (`${c.text} ${c.author} ${(c.meta && c.meta.sel) || ''}`).toLowerCase().includes(q));
      const empty = q ? 'No comments match your search.'
        : (tab === 'resolved' ? 'No closed comments yet.'
          : 'No open comments yet. Pull the “Comment” tab, then click any element on the page.');
      this._list.innerHTML = list.length ? list.map((c) => this._card(c, tab === 'resolved')).join('') : `<div class="empty">${empty}</div>`;
      this._placePins();
    },
    _card(c, isHist) {
      // Inline edit mode for this card.
      if (c.id === this._editingId) {
        return `<div class="c editing" id="c${c.id}">
          <div class="top"><span class="seq">${this._seqOf(c)}</span><span class="who">${esc(c.author)}</span></div>
          <div class="editform">
            <textarea class="editta">${esc(c.text)}</textarea>
            <div class="acts"><button class="primary" data-cl-act="edit-save" data-cl-id="${c.id}" data-tip="Save" aria-label="Save">${icon('check')}</button><button class="ghost" data-cl-act="edit-cancel" data-cl-id="${c.id}" data-tip="Cancel" aria-label="Cancel">${icon('x')}</button></div>
          </div></div>`;
      }
      const badge = c.status === 'open'
        ? '<span class="badge open"><span class="d"></span>open</span>'
        : '<span class="badge resolved"><span class="d"></span>resolved</span>';
      const mm = c.meta && c.meta.mode;
      const mtag = mm && mm !== 'element'
        ? `<span class="mtag">${mm === 'multi' ? icon('multi', 12) + (c.meta.count || '') : mm === 'area' ? icon('area', 12) + 'area' : icon('text', 12) + 'text'}</span>` : '';
      // Technical anchor info (pinned tag / version / fp / html snapshot) stays in the stored
      // comment for AI export & debugging, but is intentionally NOT shown to the reviewer.
      const when = `<div class="when">${icon('clock', 12)}${c.ts ? esc(c.ts) : 'time unknown'}</div>`;
      const acts = c.status === 'open'
        ? `<button class="ghost" data-cl-act="resolve" data-cl-id="${c.id}" data-tip="Resolve" aria-label="Resolve comment">${icon('check')}</button>`
        : `<button class="ghost" data-cl-act="reopen" data-cl-id="${c.id}" data-tip="Reopen" aria-label="Reopen comment">${icon('reopen')}</button>`;
      const route = location.pathname + location.hash;
      const elsewhere = !!(c.meta && c.meta.route && c.meta.route !== route);
      const sel = c.meta && c.meta.sel ? `<div class="csel">on: “${markMatch(String(c.meta.sel).slice(0, 120), this._query)}”</div>` : '';
      const shot = c.meta && c.meta.shot ? `<img class="shot" src="${c.meta.shot}" alt="snapshot at comment time">` : '';
      const other = elsewhere ? `<div class="otherpage">${icon('arrow', 13)}on another page — open</div>` : '';
      // Jump-to-element affordance, moved into the card header as an icon-only arrow.
      const jump = c.status === 'open' ? `<span class="jump" data-tip="${elsewhere ? 'Open page' : 'Go to element'}" aria-label="${elsewhere ? 'Open page' : 'Go to element'}">${icon('arrow', 15)}</span>` : '';
      return `<div class="c ${isHist ? 'hist' : ''}" id="c${c.id}">
        <div class="top"><span class="seq">${this._seqOf(c)}</span><span class="who">${markMatch(c.author, this._query)}</span>${mtag}${badge}${jump}</div>
        <div class="body">${markMatch(c.text, this._query)}</div>${sel}${when}${other}${shot}
        <div class="acts"><button data-cl-act="edit" data-cl-id="${c.id}" data-tip="Edit" aria-label="Edit">${icon('edit')}</button>${acts}<button class="danger" data-cl-act="delete" data-cl-id="${c.id}" data-tip="Delete" aria-label="Delete">${icon('trash')}</button></div></div>`;
    },

    // Durability: nothing a reviewer typed should ever be lost. We mirror to
    // localStorage synchronously (survives a crash or a failed network write),
    // then write the primary store; only after the primary confirms do we clear
    // the "pending" marks. _recoverBackup() re-pushes anything still pending.
    async _persist() {
      const plain = this.comments.map(stripRuntime);
      try { localStorage.setItem(this._backupKey, JSON.stringify(plain.map((c) => ({ ...c, _pending: true })))); } catch (e) {}
      try {
        const res = this.store.save(plain);
        if (res && typeof res.then === 'function') await res;   // Supabase adapter throws on failure
        this.comments.forEach((c) => { c._pending = false; });  // confirmed synced
        try { localStorage.setItem(this._backupKey, JSON.stringify(this.comments.map(stripRuntime))); } catch (e) {}
      } catch (e) {
        console.warn('[comment-layer] primary store save failed; comments kept in local backup for retry', e && e.message);
      }
    },
    _recoverBackup() {
      let backup = [];
      try { backup = JSON.parse(localStorage.getItem(this._backupKey) || '[]'); } catch (e) { return; }
      if (!Array.isArray(backup)) return;
      const have = new Set(this.comments.map((c) => c.id));
      // Only truly-unsynced comments (still _pending) that the primary store is
      // missing — a comment that synced then got deleted by someone else is NOT
      // pending, so it is correctly left deleted rather than resurrected.
      const missing = backup.filter((c) => c && c.id && c._pending && !have.has(c.id))
        .map(({ _pending, ...c }) => ({ ...c, _pending: true })); // stay pending until re-sync confirms
      if (missing.length) {
        this.comments = this.comments.concat(missing);
        this._persist();
        console.warn('[comment-layer] recovered ' + missing.length + ' unsynced comment(s) from local backup');
      }
    },
    _version() { return this._ver || (this._ver = 1); },
    // Stable display number, assigned once at creation and persisted in meta.seq
    // so deleting one comment never renumbers the others. Legacy comments without
    // a stored seq fall back to their position.
    _seqOf(c) { return (c.meta && c.meta.seq) || (this.comments.indexOf(c) + 1); },
    _nextSeq() {
      const maxExisting = this.comments.reduce((m, c) => Math.max(m, (c.meta && c.meta.seq) || 0), 0);
      const next = Math.max(this._seqHigh || 0, maxExisting) + 1;   // never reuse a deleted number
      this._seqHigh = next;
      try { localStorage.setItem(this._seqHighKey, String(next)); } catch (e) {}
      return next;
    },
    // Assign a stable number to any comment that predates meta.seq, so numbers
    // are unique and never shift. Persisted once, then a no-op on later loads.
    _backfillSeq() {
      let max = this.comments.reduce((m, c) => Math.max(m, (c.meta && c.meta.seq) || 0), 0);
      let changed = false;
      for (const c of this.comments) {
        if (!(c.meta && c.meta.seq)) { c.meta = c.meta || {}; c.meta.seq = ++max; changed = true; }
      }
      if (changed) this._persist();
    },
    _bumpVersion() { this._ver = this._version() + 1; },

    // Manual status controls (complement the automatic version-aware resolve).
    resolveComment(id) {
      const c = this.comments.find((x) => x.id === id); if (!c || c.status === 'resolved') return;
      c.status = 'resolved'; c.resolvedV = this._version(); c.resolveReason = 'resolved manually'; c.meta = c.meta || {}; c.meta.resolvedAt = Date.now(); c._el = null;
      this._persist(); this._render(); this._placePins();
    },
    reopenComment(id) {
      const c = this.comments.find((x) => x.id === id); if (!c || c.status === 'open') return;
      c.status = 'open'; c.resolvedV = null; c.resolveReason = null;
      if (c.meta) delete c.meta.resolvedAt;   // close-time no longer applies (it drives the "recently closed" sort)
      delete c.resolvedAt;                    // legacy top-level field, same reason
      const m = findMatch(c.fp, this.target);
      c._el = (m.el && m.score >= MATCH_THRESHOLD) ? m.el : null;
      this._persist(); this._render(); this._placePins();
    },
    removeComment(id) {
      const c = this.comments.find((x) => x.id === id); if (!c) return;
      if (typeof confirm === 'function' && !confirm('Delete this comment permanently?')) return;
      if (this.store.remove) this.store.remove([id]);          // hard-delete in backing store
      this.comments = this.comments.filter((x) => x.id !== id);
      this._persist(); this._render(); this._placePins();
    },

    // public helpers
    open() { this._openPanel(); },
    toggle() { this._panel.classList.contains('show') ? this._closePanel() : this._openPanel(); },
    getComments() { return this.comments.map(stripRuntime); },
    reset() { this.comments = []; this._ver = 1; this._persist(); this._render(); this._placePins(); },
  };

  function stripRuntime(c) { const { _el, _pending, ...rest } = c; return rest; }
  // Union bounding box (viewport coords) of several elements — used to screenshot a multi-selection.
  function unionRect(els) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const el of els) {
      const r = el.getBoundingClientRect();
      x1 = Math.min(x1, r.left); y1 = Math.min(y1, r.top);
      x2 = Math.max(x2, r.right); y2 = Math.max(y2, r.bottom);
    }
    return isFinite(x1) ? { x: x1, y: y1, w: x2 - x1, h: y2 - y1 } : null;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m])); }
  // Escape for HTML, then wrap case-insensitive matches of the search query in <mark> (amber highlighter).
  function markMatch(text, q) {
    const s = esc(text == null ? '' : text);
    if (!q) return s;
    const eq = esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try { return s.replace(new RegExp('(' + eq + ')', 'ig'), '<mark class="clmark">$1</mark>'); } catch (e) { return s; }
  }
  // Local time in the reviewer's own timezone. Format: DD.MM.YYYY HH:MM.
  function nowStamp() {
    try {
      const parts = new Intl.DateTimeFormat('en-GB', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false,
      }).formatToParts(new Date());
      const g = (t) => (parts.find((x) => x.type === t) || {}).value || '';
      return `${g('day')}.${g('month')}.${g('year')} ${g('hour')}:${g('minute')}`;
    } catch { return ''; }
  }
  // Globally-unique comment id. Client-assigned sequential ids collide across
  // reviewers (two clients both start at 1) → upsert(onConflict:id) overwrites.
  // A UUID is unique without server coordination, so multi-reviewer save is safe.
  // Lazy-load html2canvas from CDN only when a screenshot is first captured, so the
  // core bundle stays dependency-free. Fails soft: no lib → no screenshot, comment still works.
  let _shotLibPromise = null;
  function loadShotLib() {
    if (typeof window !== 'undefined' && window.html2canvas) return Promise.resolve(window.html2canvas);
    if (_shotLibPromise) return _shotLibPromise;
    _shotLibPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
      s.onload = () => resolve(window.html2canvas);
      s.onerror = () => reject(new Error('html2canvas load failed'));
      document.head.appendChild(s);
    });
    return _shotLibPromise;
  }
  function genId() {
    try { if (globalThis.crypto && globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID(); } catch (e) {}
    return 'c-' + nowStamp().replace(/\D/g, '') + '-' + Math.random().toString(36).slice(2, 10);
  }

  // expose the algorithm too, for adapters / tests
  CommentLayer._algo = { fingerprint, classify, findMatch };
  global.CommentLayer = CommentLayer;
})(window);
