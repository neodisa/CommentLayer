// Version-pair fixtures simulating AI regeneration passes.
// Each anchored element (data-anchor="…", a TEST-ONLY marker the algorithm ignores)
// has an expected decision when version N regenerates into version N+1.
//
//   RESOLVE       = the commented region was regenerated -> close the comment
//   CARRY_FORWARD = the region is unchanged -> keep the comment open on the new version
//
// These deliberately probe the riskiest cases from assumptions.md (ranks 1 & 3):
// copy-only edits, style-only edits, incidental hashed-class churn, removal,
// reordering, and reparenting.

export const fixtures = [
  {
    name: '1. component regenerated, sibling untouched',
    note: 'Card A is rewritten; Card B is byte-identical. Classic partial regeneration.',
    vN: `
      <main>
        <section class="card css-aa11bb" data-anchor="cardA">
          <h2>Fast checkout</h2>
          <p>Pay in one tap with saved cards.</p>
        </section>
        <section class="card css-cc22dd" data-anchor="cardB">
          <h2>Secure by default</h2>
          <p>Every transaction is encrypted end to end.</p>
        </section>
      </main>`,
    vNext: `
      <main>
        <section class="card css-aa11bb">
          <h2>Lightning checkout</h2>
          <p>Buy instantly — no forms, no friction.</p>
        </section>
        <section class="card css-cc22dd">
          <h2>Secure by default</h2>
          <p>Every transaction is encrypted end to end.</p>
        </section>
      </main>`,
    anchors: [
      { id: 'cardA', expect: 'RESOLVE' },
      { id: 'cardB', expect: 'CARRY_FORWARD' },
    ],
  },

  {
    name: '2. copy-only change',
    note: 'Same element, same styling, only the wording changed.',
    vN: `<header><h1 data-anchor="hero">Welcome to our app</h1></header>`,
    vNext: `<header><h1>Get started in seconds</h1></header>`,
    anchors: [{ id: 'hero', expect: 'RESOLVE' }],
  },

  {
    name: '3. style-only change (meaningful)',
    note: 'Comment was "make it blue". Text identical, but a semantic utility class changed.',
    vN: `<div><button class="btn bg-gray-200" data-anchor="cta">Buy now</button></div>`,
    vNext: `<div><button class="btn bg-blue-500">Buy now</button></div>`,
    anchors: [{ id: 'cta', expect: 'RESOLVE' }],
  },

  {
    name: '4. incidental hashed-class churn (must NOT resolve)',
    note: 'A rebuild rotates CSS-in-JS hashes but the content & meaningful classes are identical.',
    vN: `<div class="card css-1a2b3c" data-anchor="pricing"><h3 class="title sc-AxjAm">Pricing</h3><p>From $9/mo</p></div>`,
    vNext: `<div class="card css-9z8y7x"><h3 class="title sc-PpQrS">Pricing</h3><p>From $9/mo</p></div>`,
    anchors: [{ id: 'pricing', expect: 'CARRY_FORWARD' }],
  },

  {
    name: '5. element removed entirely',
    note: 'The promo banner the comment pointed at is gone in the next version.',
    vN: `<div><aside class="promo" data-anchor="promo">Limited offer: 50% off annual plans</aside><p>Body copy stays.</p></div>`,
    vNext: `<div><p>Body copy stays.</p></div>`,
    anchors: [{ id: 'promo', expect: 'RESOLVE' }],
  },

  {
    name: '6. element reordered (content identical)',
    note: 'Nav item "Home" moved from first to last. Pure move, not a regeneration.',
    vN: `<nav><ul><li data-anchor="home">Home</li><li>About</li><li>Contact</li></ul></nav>`,
    vNext: `<nav><ul><li>About</li><li>Contact</li><li>Home</li></ul></nav>`,
    anchors: [{ id: 'home', expect: 'CARRY_FORWARD' }],
  },

  {
    name: '7. anchored element reparented (wrapped for layout)',
    note: 'A new wrapper div is added around the commented element; its own content is untouched.',
    vN: `<section><p class="lead" data-anchor="lead">Our mission is simple.</p></section>`,
    vNext: `<section><div class="col"><div class="row"><p class="lead">Our mission is simple.</p></div></div></section>`,
    anchors: [{ id: 'lead', expect: 'CARRY_FORWARD' }],
  },
];
