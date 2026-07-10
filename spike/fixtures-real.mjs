// Adversarial / realistic fixtures mirroring real AI-builder output
// (v0 / Lovable / Claude-React): Tailwind utility soup, styled-components &
// emotion hashed classes, near-duplicate list items, simultaneous text+structure
// edits, and deep nesting. These probe the cases SPIKE-FINDINGS flagged as
// "not yet proven". Some are EXPECTED to fail — that's the point.

export const fixtures = [
  {
    name: 'R1. Tailwind button restyle (make it blue)',
    note: 'Comment "make it blue"; bg-white→bg-blue-600, text changes color. Should resolve.',
    vN: `<div class="flex justify-center p-6">
           <button data-anchor="cta" class="rounded-xl bg-white px-6 py-3 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-gray-200 hover:bg-gray-50">Get started</button>
         </div>`,
    vNext: `<div class="flex justify-center p-6">
              <button class="rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-sm ring-1 ring-blue-700 hover:bg-blue-700">Get started</button>
            </div>`,
    anchors: [{ id: 'cta', expect: 'RESOLVE' }],
  },

  {
    name: 'R2. styled-components hash rotation (content identical)',
    note: 'A rebuild rotates styled-components hashes; text & semantics identical. Must NOT resolve.',
    vN: `<section class="sc-bdVaJa kFhUMt" data-anchor="hero"><h1 class="sc-gtsrHT eLwwTf">Build faster</h1><p class="sc-dkzDqf jInValq">Ship in minutes, not months.</p></section>`,
    vNext: `<section class="sc-iAyFgw pQrStuv"><h1 class="sc-kThNol bMnOpq">Build faster</h1><p class="sc-vWxYz lKjHgf">Ship in minutes, not months.</p></section>`,
    anchors: [{ id: 'hero', expect: 'CARRY_FORWARD' }],
  },

  {
    name: 'R3. emotion css- hash rotation (content identical)',
    note: 'Emotion css-XXledger rotation, identical content. Must NOT resolve.',
    vN: `<div class="css-1a2b3c4" data-anchor="badge"><span class="css-9z8y7w6">New</span> Feature</div>`,
    vNext: `<div class="css-7f8e9d0"><span class="css-2k3l4m5">New</span> Feature</div>`,
    anchors: [{ id: 'badge', expect: 'CARRY_FORWARD' }],
  },

  {
    name: 'R4. near-duplicate pricing cards — comment on the middle one',
    note: 'Three similar cards; comment on "Pro". v2 only rewrites "Basic". Pro must carry forward.',
    vN: `<div class="grid grid-cols-3 gap-4">
           <div class="card"><h3>Basic</h3><p>$9/mo</p><p>For individuals getting started</p></div>
           <div class="card" data-anchor="pro"><h3>Pro</h3><p>$19/mo</p><p>For growing teams that need more</p></div>
           <div class="card"><h3>Team</h3><p>$49/mo</p><p>For organizations at scale</p></div>
         </div>`,
    vNext: `<div class="grid grid-cols-3 gap-4">
              <div class="card"><h3>Starter</h3><p>$0/mo</p><p>Free forever for solo hackers</p></div>
              <div class="card"><h3>Pro</h3><p>$19/mo</p><p>For growing teams that need more</p></div>
              <div class="card"><h3>Team</h3><p>$49/mo</p><p>For organizations at scale</p></div>
            </div>`,
    anchors: [{ id: 'pro', expect: 'CARRY_FORWARD' }],
  },

  {
    name: 'R5. near-duplicate cards — comment on Basic, which gets rewritten',
    note: 'Same set; comment on Basic; v2 rewrites Basic→Starter. Should resolve (it changed).',
    vN: `<div class="grid grid-cols-3 gap-4">
           <div class="card" data-anchor="basic"><h3>Basic</h3><p>$9/mo</p><p>For individuals getting started</p></div>
           <div class="card"><h3>Pro</h3><p>$19/mo</p><p>For growing teams that need more</p></div>
           <div class="card"><h3>Team</h3><p>$49/mo</p><p>For organizations at scale</p></div>
         </div>`,
    vNext: `<div class="grid grid-cols-3 gap-4">
              <div class="card"><h3>Starter</h3><p>$0/mo</p><p>Free forever for solo hackers</p></div>
              <div class="card"><h3>Pro</h3><p>$19/mo</p><p>For growing teams that need more</p></div>
              <div class="card"><h3>Team</h3><p>$49/mo</p><p>For organizations at scale</p></div>
            </div>`,
    anchors: [{ id: 'basic', expect: 'RESOLVE' }],
  },

  {
    name: 'R6. simultaneous text + structure change',
    note: 'Commented feature item: copy rewritten AND an icon span added. Should resolve.',
    vN: `<ul class="space-y-2"><li data-anchor="feat" class="flex gap-2">Unlimited projects</li></ul>`,
    vNext: `<ul class="space-y-2"><li class="flex gap-2"><svg class="h-4 w-4"></svg><span>Unlimited everything, no caps</span></li></ul>`,
    anchors: [{ id: 'feat', expect: 'RESOLVE' }],
  },

  {
    name: 'R7. deep nesting — ancestor restructured, leaf identical',
    note: 'Comment on a deeply nested label; wrappers around it are restructured but the label is byte-identical. Carry forward.',
    vN: `<main><div class="container"><div class="row"><div class="col"><label data-anchor="lbl" class="text-xs uppercase tracking-wide text-gray-500">Email address</label></div></div></div></main>`,
    vNext: `<main><section class="wrapper"><div class="grid"><div class="field"><div class="inner"><label class="text-xs uppercase tracking-wide text-gray-500">Email address</label></div></div></div></section></main>`,
    anchors: [{ id: 'lbl', expect: 'CARRY_FORWARD' }],
  },

  {
    name: 'R8. whole-page rewrite',
    note: 'Everything regenerated. All commented regions should resolve.',
    vN: `<div class="page"><h1 data-anchor="t">Acme Analytics</h1><p data-anchor="d">Dashboards for busy teams.</p></div>`,
    vNext: `<div class="landing"><header class="hero"><h2>Meet Acme</h2><span>The analytics platform builders love.</span></header></div>`,
    anchors: [{ id: 't', expect: 'RESOLVE' }, { id: 'd', expect: 'RESOLVE' }],
  },
];
