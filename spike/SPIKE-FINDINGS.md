# Spike: diff + anchoring feasibility

**Date:** 2026-07-01
**Question:** Can a diff between version N and N+1 of rendered output reliably decide
which commented regions were regenerated (→ auto-resolve) vs unchanged (→ carry the
comment forward), and can a comment anchor survive DOM churn between versions?

This validates the two highest-risk assumptions from
`.design-engineer-plugin/design/foundation/assumptions.md` (rank 1: diff precision;
rank 3: anchoring survives DOM instability) **before** investing in product/design.

## What was built

A zero-dependency Node harness (`node run.mjs`):

- `minihtml.mjs` — tiny HTML→tree parser (so the algorithm runs on a real-ish tree).
- `anchor-diff.mjs` — the core: `fingerprint(el)` captured at comment time, and
  `classify(fp, nextVersion)` deciding RESOLVE vs CARRY_FORWARD.
- `fixtures.mjs` — 7 version-pairs simulating real regeneration passes.
- `run.mjs` — scores decisions against expected outcomes.

### How the algorithm decides

1. **Anchor fingerprint** at comment time: tag, normalized subtree text + hash,
   structural signature (tag skeleton), style signature (**stable** classes only —
   hashed CSS-in-JS / module hashes are filtered out), a stable id
   (`data-testid`/`id`/`aria-label`) if present, and a tag-path locator.
2. **Re-find** the element in version N+1: stable id wins outright; otherwise score
   same-tag candidates by **text similarity (0.75) + path similarity (0.25)** — text
   dominates so a moved element is still recognized as the same element.
3. **Classify**: no confident match → RESOLVE (region removed/replaced). Matched but
   text **or** structure **or** meaningful-style changed → RESOLVE (regenerated).
   Matched and all three identical → CARRY_FORWARD.

### Design bias (deliberate)

A false RESOLVE silently drops live feedback and destroys trust; a false CARRY_FORWARD
just leaves a slightly-stale open thread. So the algorithm **only resolves when
confident the region changed** — when in doubt it carries forward.

## Results

```
accuracy:      8/8 (100%)
false RESOLVE: 0   (the costly error — dropping live feedback)
false CARRY:   0   (the mild error — stale open thread)
```

| Scenario | Expected | Got |
|---|---|---|
| Component regenerated, sibling untouched | RESOLVE + CARRY | ✓ |
| Copy-only change | RESOLVE | ✓ |
| Style-only change (meaningful class) | RESOLVE | ✓ |
| Incidental hashed-class churn | CARRY_FORWARD | ✓ |
| Element removed entirely | RESOLVE | ✓ |
| Element reordered (content identical) | CARRY_FORWARD | ✓ |
| Element reparented (wrapped for layout) | CARRY_FORWARD | ✓ |

The one initial failure (reorder matched a neighbor by position) was fixed by making
text identity dominate the match score over DOM position.

## What this proves — and what it does NOT

**Proves:** the core mechanism is sound. Hashed-class churn, reordering, and
reparenting — the three things that break naive selector-based tools — are handled,
and the trust-preserving bias (zero false-resolves) holds on these cases.

**Does NOT yet prove (honest limits):**

- Fixtures are clean and controlled. Real AI regenerations are messier (whole-page
  rewrites, changed nesting + changed text together, lists with near-duplicate items).
- No real framework runtime tested yet (React/Vue reconciliation, Tailwind JIT,
  CSS-in-JS at scale). The `minihtml` parser is not a browser.
- "Meaningful style change" relies on a heuristic for hashed-vs-stable class tokens
  that will need tuning against real toolchains.
- Pixel/visual diffing (vs DOM diffing) not explored — may be needed for canvas/img.

## Recommended next steps

1. Port the same algorithm into a **real browser DOM** harness (it was written
   parser-agnostic for exactly this) and re-run against output from v0 / Lovable /
   a Claude-generated React app with staged edits.
2. Add adversarial fixtures: near-duplicate list items, simultaneous text+structure
   change, deeply nested regenerations.
3. Decide the anchoring primitive for the real SDK: injected `data-comment-id`
   attributes (most robust, needs cooperation) vs pure structural fingerprint
   (zero-cooperation, what this spike uses).

## Update — realistic / adversarial stress test (`node run-real.mjs`)

A second suite (`fixtures-real.mjs`, 9 anchors) mirrors real AI-builder output:
Tailwind utility soup, styled-components & emotion hashed classes, near-duplicate
pricing cards, simultaneous text+structure edits, deep nesting, whole-page rewrite.

**First run found a real, costly bug:** styled-components hash rotation
(`kFhUMt`→`pQrStuv`, content identical) produced a **false RESOLVE** — the
vowelless-gibberish heuristic kept mixed-case CSS-in-JS hashes (they contain vowels)
as "stable" classes, so rotating them looked like a style change.

**Fix:** treat a mixed-case token with no `-` separator (≤12 chars) as hashy —
utility/BEM classes are lower-case-with-dashes, so they're untouched, while
styled-components/emotion generated classes are caught.

After the fix: **real suite 9/9, original suite 8/8, 0 false-resolves**, confirmed in
the SDK in a real browser (styled-components rotation → CARRY_FORWARD; Tailwind
`bg-white`→`bg-blue-600` restyle → RESOLVE). Near-duplicate pricing cards correctly
keep a comment on "Pro" while "Basic" is rewritten elsewhere; deep reparenting carries
forward; whole-page rewrite resolves all.

Still untested: live framework runtimes (React reconciliation under heavy churn),
genuinely huge pages, and CSS-Modules camelCase local names (now treated as hashy —
acceptable, biases toward the mild error).

## Verdict

The riskiest technical assumption clears a usable bar on representative AND adversarial
cases (17/17 after the styled-components fix, 0 false-resolves). Green light to continue
product/design work; the next checkpoint is live framework output at scale before
committing to the SDK's anchoring primitive.
