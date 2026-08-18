#!/usr/bin/env node
// WCAG 2.1 contrast gate for the design-token palette in src/app/globals.css.
//
// Standalone, no dependencies. Parses the `:root { ... }` (light) block, the
// `.dark, :root[data-theme='dark'] { ... }` (dark) block, and the
// `@media (prefers-color-scheme: dark) { :root:not([data-theme]) { ... } }`
// mirror block with a brace-matching scan, resolves each `--token:
// #rrggbb;` declaration, computes WCAG relative-luminance contrast ratios
// for a fixed pair table, and exits 1 listing every failing pair (with its
// ratio) across BOTH themes — plus any NAME or VALUE drift between the
// `.dark` block and its `prefers-color-scheme` mirror, which the pair table
// alone can never see (the mirror is hand-duplicated, not derived from
// `.dark` at build time).
//
// globals.css has TWO `:root { ... }` blocks (design tokens, then the
// separate `--art-*` backdrop palette) and correspondingly two of each dark
// variant. Block selection below is NOT "first match wins" — it picks the
// one block (per marker) that actually declares `--background`, and throws
// loudly if that isn't exactly one block, so a future reorder or a third
// block fails the run instead of silently gating the wrong tokens.
//
// Pair table + floors: docs/superpowers/plans/2026-08-09-pitch-design-overhaul.md
// §Task 3, Step 1. Palette sourcing: docs/PITCH_TEARDOWN.md.
//
// Usage: node scripts/design/contrast-check.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const cssPath = path.join(__dirname, '../../src/app/globals.css')
const css = readFileSync(cssPath, 'utf8')

// --- CSS block extraction ----------------------------------------------

/** Finds every `<header>{ ... }` occurrence matching `headerRegex` (a
 * RegExp anchored at line start) and returns each one's balanced-brace
 * contents. */
function findAllBlocks(source, headerRegex) {
  const flags = headerRegex.flags.includes('g')
    ? headerRegex.flags
    : `${headerRegex.flags}g`
  const re = new RegExp(headerRegex.source, flags)
  const blocks = []
  let m
  while ((m = re.exec(source))) {
    const braceStart = source.indexOf('{', m.index)
    let depth = 0
    for (let i = braceStart; i < source.length; i++) {
      if (source[i] === '{') depth++
      else if (source[i] === '}') {
        depth--
        if (depth === 0) {
          blocks.push(source.slice(braceStart + 1, i))
          break
        }
      }
    }
  }
  return blocks
}

/** Of every block matching `headerRegex`, returns the ONE that declares
 * `--background` (the design-token blocks; the `--art-*` blocks never do).
 * Throws loudly if that isn't exactly one match — ambiguity is a bug in
 * this script's markers, not something to guess past. */
function findTokenBlock(source, headerRegex, label) {
  const blocks = findAllBlocks(source, headerRegex)
  const candidates = blocks.filter((b) => /--background\s*:/.test(b))
  if (candidates.length !== 1) {
    throw new Error(
      `${label}: expected exactly one block declaring --background, found ${candidates.length} (of ${blocks.length} blocks matching ${headerRegex}) in globals.css`,
    )
  }
  return candidates[0]
}

function parseVars(block) {
  const vars = {}
  const re = /--([a-z0-9-]+)\s*:\s*([^;]+);/gi
  let m
  while ((m = re.exec(block))) {
    vars[m[1]] = m[2].trim()
  }
  return vars
}

const lightBlock = findTokenBlock(css, /^:root \{/m, 'light block')
const darkBlock = findTokenBlock(
  css,
  /^\.dark,\n:root\[data-theme='dark'\] \{/m,
  'dark block',
)
const mirrorBlock = findTokenBlock(
  css,
  /^  :root:not\(\[data-theme\]\) \{/m,
  'prefers-color-scheme mirror block',
)

const light = parseVars(lightBlock)
const dark = parseVars(darkBlock)
const mirror = parseVars(mirrorBlock)

// --- WCAG relative luminance / contrast ---------------------------------

function hexToRgb(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) throw new Error(`not a 6-digit hex color: ${hex}`)
  const int = parseInt(m[1], 16)
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 }
}

function toLinear(c) {
  const cs = c / 255
  return cs <= 0.04045 ? cs / 12.92 : ((cs + 0.055) / 1.055) ** 2.4
}

function relLuminance({ r, g, b }) {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)
}

function contrastRatio(hexA, hexB) {
  const La = relLuminance(hexToRgb(hexA))
  const Lb = relLuminance(hexToRgb(hexB))
  const [hi, lo] = La > Lb ? [La, Lb] : [Lb, La]
  return (hi + 0.05) / (lo + 0.05)
}

// --- The fixed pair table -----------------------------------------------
// [foreground token, background token, minimum ratio]
// Text pairs at 4.5:1 (WCAG AA body text); UI/focus pairs at 3.0:1;
// border visibility floors at 1.2:1 / 1.35:1 (not a WCAG number — the
// project's own hairline-visibility floor, see the --border comment below).

const PAIRS = [
  ['foreground', 'background', 4.5],
  ['muted-foreground', 'background', 4.5],
  ['muted-foreground', 'card', 4.5],
  ['primary-foreground', 'primary', 4.5],
  ['card-foreground', 'card', 4.5],
  // Task 5 (chat surface): the assistant bubble/saved-summary bubble uses
  // `--primary-soft` as its light-theme fill with plain body text on top
  // (PITCH_TEARDOWN.md ## Chat-surface mapping "Assistant bubble" —
  // `surface-tint` #EBE3FE). Existing uses of `--primary-soft` elsewhere in
  // the app are icon-only (avatar circles), never body text, so this pair
  // was never gated before.
  ['foreground', 'primary-soft', 4.5],
  // The landing subhead and sign-in line render `--muted-foreground` over
  // the same backdrop gradient (Backdrop.tsx / globals.css `.backdrop-bloom-a`)
  // whose hottest stop is `--primary-soft` — a second text colour on that
  // gradient that the `foreground`/`primary-soft` pair above does not cover.
  ['muted-foreground', 'primary-soft', 4.5],
  ['positive', 'background', 4.5],
  ['negative', 'background', 4.5],
  ['notice', 'background', 4.5],
  ['border', 'background', 1.2],
  ['border-strong', 'background', 1.35],
  ['input', 'background', 3.0],
  ['ring', 'background', 3.0],
  ['chevron', 'background', 3.0],
]

function runTheme(name, vars) {
  const failures = []
  for (const [fg, bg, min] of PAIRS) {
    const fgVal = vars[fg]
    const bgVal = vars[bg]
    if (!fgVal || !bgVal) {
      failures.push(
        `${name}: --${fg}/--${bg} — missing token(s) (fg=${fgVal}, bg=${bgVal})`,
      )
      continue
    }
    let ratio
    try {
      ratio = contrastRatio(fgVal, bgVal)
    } catch (err) {
      failures.push(`${name}: --${fg}/--${bg} — ${err.message}`)
      continue
    }
    if (ratio < min) {
      failures.push(
        `${name}: --${fg}/--${bg} = ${ratio.toFixed(2)}:1 (needs ${min}:1) [${fgVal} on ${bgVal}]`,
      )
    }
  }
  return failures
}

// --- Mirror-drift check ---------------------------------------------------
// The `prefers-color-scheme` mirror is a hand-duplicated copy of `.dark`,
// not generated from it — nothing else in the build enforces that the two
// stay identical. Assert NAME+VALUE set equality; any drift fails the gate.

function diffMirror(darkVars, mirrorVars) {
  const drift = []
  const darkNames = new Set(Object.keys(darkVars))
  const mirrorNames = new Set(Object.keys(mirrorVars))
  for (const name of darkNames) {
    if (!mirrorNames.has(name)) {
      drift.push(
        `mirror-drift: --${name} is in .dark but missing from the prefers-color-scheme mirror`,
      )
    } else if (darkVars[name] !== mirrorVars[name]) {
      drift.push(
        `mirror-drift: --${name} = ${darkVars[name]} in .dark but ${mirrorVars[name]} in the mirror`,
      )
    }
  }
  for (const name of mirrorNames) {
    if (!darkNames.has(name)) {
      drift.push(
        `mirror-drift: --${name} is in the prefers-color-scheme mirror but missing from .dark`,
      )
    }
  }
  return drift
}

const failures = [
  ...runTheme('light', light),
  ...runTheme('dark', dark),
  ...diffMirror(dark, mirror),
]

if (failures.length > 0) {
  console.error('Contrast gate FAILED:\n')
  for (const f of failures) console.error(`  - ${f}`)
  console.error(`\n${failures.length} failing pair(s)/drift(s).`)
  process.exit(1)
}

console.log(
  `Contrast gate passed: ${PAIRS.length} pairs x 2 themes, plus mirror NAME+VALUE equality, all clear.`,
)
