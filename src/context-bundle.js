/*!
 * context-bundle — pure assembly of the per-comment context (no DOM access).
 * The SDK reads DOM/location/viewport and passes plain values here; this keeps
 * the shape testable in Node. Screenshots are a v2 concern (not here).
 */
const MAX_OUTER_HTML = 6000; // ~6kb cap keeps rows small
const MAX_TEXT = 500;

export function truncate(str, max = MAX_OUTER_HTML) {
  if (typeof str !== 'string') return '';
  return str.length <= max ? str : str.slice(0, max) + '…[truncated]';
}

export function buildContextBundle(input) {
  const i = input || {};
  return {
    htmlSnapshot: {
      outerHTML: truncate(i.outerHTML || ''),
      text: (i.text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT),
    },
    meta: {
      url: i.url || '',
      route: i.route || '',
      version: i.version != null ? i.version : null,
      viewport: i.viewport || null,
      ts: i.ts != null ? i.ts : null,
    },
  };
}
