// Mines three Korean lexicons — josa (particles), number-decoy words, and
// colloquial-typo pairs — from open-korean-text and a mecab-ko-dic mirror,
// and writes them as GENERATED TypeScript files under src/lib/chat-parse/ko/.
//
// Both upstream projects are Apache-2.0 — see NOTICE for attribution.
//
// Sources (pinned to a commit SHA for reproducibility — re-pin deliberately,
// don't float on a branch head):
//   - open-korean-text (https://github.com/open-korean-text/open-korean-text)
//     src/main/resources/org/openkoreantext/processor/util/josa/josa.txt
//     src/main/resources/org/openkoreantext/processor/util/typos/typos.txt
//   - mecab-ko-dic mirror (https://github.com/jaepil/mecab-ko-dic — a
//     GitHub mirror of the CSV dictionary sources originally hosted on
//     Bitbucket; api.github.com/search/repositories confirmed Apache-2.0)
//     seed/J.csv (조사/particles), seed/NNG.csv (일반명사), seed/MAG.csv (일반부사)
//
// Run: node scripts/lang/mine-korean-lexicons.mjs
//
// Network is required. If any fetch fails, the script throws and exits
// non-zero rather than emitting an empty or partial lexicon.

import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT_DIR = path.join(__dirname, '../../src/lib/chat-parse/ko')

const OKT_SHA = '74cc4ae7d3dab232747cd5ddb723e4b73c476e4f'
const MECAB_SHA = 'df15a487444d88565ea18f8250330276497cc9b9'

const OKT_JOSA_URL = `https://raw.githubusercontent.com/open-korean-text/open-korean-text/${OKT_SHA}/src/main/resources/org/openkoreantext/processor/util/josa/josa.txt`
const OKT_TYPOS_URL = `https://raw.githubusercontent.com/open-korean-text/open-korean-text/${OKT_SHA}/src/main/resources/org/openkoreantext/processor/util/typos/typos.txt`
const MECAB_BASE = `https://raw.githubusercontent.com/jaepil/mecab-ko-dic/${MECAB_SHA}/seed`
const MECAB_J_URL = `${MECAB_BASE}/J.csv`
const MECAB_NNG_URL = `${MECAB_BASE}/NNG.csv`
const MECAB_MAG_URL = `${MECAB_BASE}/MAG.csv`

async function fetchText(url) {
  let res
  try {
    res = await fetch(url)
  } catch (err) {
    throw new Error(`network unavailable fetching ${url}: ${err.message}`)
  }
  if (!res.ok) {
    throw new Error(`FAILED to fetch ${url}: HTTP ${res.status}`)
  }
  const text = await res.text()
  if (!text.trim()) {
    throw new Error(`FAILED: ${url} returned an empty body`)
  }
  return text
}

function parseLines(text) {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

/** mecab-ko-dic CSV row: `surface,left-id,right-id,cost,pos,...`. We only
 * need the surface form (first field); it never itself contains a comma in
 * these dictionaries. */
function parseCsvSurfaces(text) {
  const out = new Set()
  for (const line of parseLines(text)) {
    const idx = line.indexOf(',')
    const surface = idx === -1 ? line : line.slice(0, idx)
    if (surface) out.add(surface)
  }
  return out
}

const PURE_HANGUL = /^[가-힣]+$/

// --- JOSA -------------------------------------------------------------

// Hand-audited allowlist: only josa relevant to name/participant binding
// (matches the closed set already curated in numbers.ts's PARTICLES — see
// that file's comment on why enumerating a genuinely closed grammatical
// class is safe). The full mined pool is ~500-900 entries, most of which
// are combinatorial forms (까지나마, 로서까지는...) nothing in this codebase
// needs to strip, so we intersect it against this allowlist rather than
// emit the whole pool.
const JOSA_ALLOWLIST = [
  '을',
  '를',
  '은',
  '는',
  '이',
  '가',
  '도',
  '만',
  '씩',
  '의',
  '에',
  '에서',
  '에게',
  '에게서',
  '한테',
  '한테서',
  '께',
  '께서',
  '으로',
  '로',
  '으로서',
  '로서',
  '으로써',
  '로써',
  '부터',
  '까지',
  '하고',
  '랑',
  '이랑',
  '과',
  '와',
  '뿐',
  '밖에',
  '보다',
  '처럼',
  '만큼',
  '조차',
  '마저',
  '마다',
  '이나',
  '나',
  '라도',
  '이라도',
]

function mineJosa(oktJosaTxt, mecabJCsv) {
  const pool = new Set([...parseLines(oktJosaTxt), ...parseCsvSurfaces(mecabJCsv)])
  const result = []
  for (const w of JOSA_ALLOWLIST) {
    if (!pool.has(w)) {
      throw new Error(
        `JOSA allowlist entry "${w}" has no provenance in mined josa.txt or mecab J.csv — ` +
          `fix the allowlist or the source URLs, do not emit an unsourced entry`,
      )
    }
    result.push(w)
  }
  // Longest first (detacher tries entries in order and must match 이랑
  // before 랑, 한테서 before 한테); ties broken by codepoint for a
  // deterministic, stable diff across re-runs.
  result.sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0))
  return result
}

// --- NUMBER_DECOYS ------------------------------------------------------

// Sino-Korean digit/unit syllables a numeral reading can start with. Per
// the brief this deliberately excludes 조 (10^12) — a 조-prefixed decoy
// class exists (조이다 must read null, not "1e12 span 조") but the mined
// character-class filter doesn't reach it; those go in DECOY_SUPPLEMENT
// below instead of widening the filter (조 alone is too noisy a prefix to
// mine automatically — most 조-initial nouns are unrelated to the numeral).
const DECOY_PREFIX_CHARS = new Set('일이삼사오육칠팔구십백천만억')

// Entries required by numbers.ts's seed DECOY_WORDS (Task 2) and by Task
// 3's mandated carry-over (parsed <digit-syllable>+<counter>+<particle>
// bug — see task-3-brief.md) that the 조-excluding filter above cannot
// reach. Supplementing here, not by hand-editing the generated file, per
// the brief's "manual-supplement list in the script" instruction.
const DECOY_SUPPLEMENT = [
  '조금', // Task 2 seed — 조(1e12 unit char) + 금, not a number
  '조각', // Task 2 seed — same 조-prefix case
  '조이', // Task 3 mandated carry-over — "조이다" must read null, not 1e12
]

// RULING (Task 3 review-fix round, supersedes the brief's "decoys = words
// that are not themselves numbers" line — Minor 8): a decoy MAY be a fully
// parseable numeral. "오만"/"천사"/"만일" (Task 2 seed) and "만원"/"천원"/
// "구원"/"천만" (this round) are all, read digit-by-digit, entirely valid
// numbers — that was never the filter. NUMBER_DECOYS is about which surface
// forms PREFER the word reading; numbers.ts's rescue logic (currency/counter
// continuations, isRejectedByDecoy/isUnitExtensionRejected) is what decides
// when the numeral reading wins anyway. A re-miner must NOT add an
// NR.csv-style "exclude anything that's also a numeral" filter — that was
// tried during Task 3's own implementation and reverted, since it excludes
// exactly the ambiguous-homograph class the seed list exists to capture. Do
// not hand-edit lexicon-decoys.ts to "fix" a rescue gap either — a mining
// filter can only decide what counts as a candidate, not what the reader
// does with the collision; a reader-side gap belongs in numbers.ts, per
// docs/SOLVED.md round 7 (the isCurrencyFusion data-layer patch this file
// used to carry — narrowly worked around 11 words instead of fixing the
// actual gap — was removed for exactly this reason).

// One-off archaic/classical dictionary words that mining legitimately finds
// (they ARE real words) but which collide with numbers.ts's existing test
// contract or with common bill-splitting usage — including them as decoys
// would silently regress far more frequent readings than they'd ever guard
// against in this app's chat text. Denylisted here, not by hand-editing the
// generated file (mirrors DECOY_SUPPLEMENT's provenance-in-the-script rule).
const DECOY_DENYLIST = [
  // 蠻夷 "barbarians" — collides with the 만+이 josa-rollback rule ("만이"
  // must read 10000n with 이 as the trailing subject particle, per
  // numbers.test.ts's ROLLS_BACK table).
  '만이',
  // 異人 "extraordinary person" — collides with "이인분" (2 servings), a
  // routine food-order phrase (numbers.test.ts asserts 이인분 -> 2n).
  '이인',
  // 伯夷 (historical figure, 백이숙제 idiom) — collides with "백이" read as
  // 102 (백=100 + 이=2 kept as the ones digit; numbers.test.ts's
  // KEEPS_DIGIT table).
  '백이',
]

function mineDecoys(nngCsv, magCsv) {
  const candidates = new Set([...parseCsvSurfaces(nngCsv), ...parseCsvSurfaces(magCsv)])
  const denylist = new Set(DECOY_DENYLIST)
  const decoys = new Set()
  for (const w of candidates) {
    if (w.length < 2) continue
    if (!PURE_HANGUL.test(w)) continue
    if (!DECOY_PREFIX_CHARS.has(w[0])) continue
    if (denylist.has(w)) continue
    decoys.add(w)
  }
  for (const w of DECOY_SUPPLEMENT) decoys.add(w)
  return decoys
}

// Every entry here MUST survive mining, on pain of a loud throw (mirrors
// mineJosa's allowlist-provenance check): the Task 2 seed (12 entries) and
// Task 3's mandated <digit-syllable>+<counter> carry-over class (7 of the
// entries named in task-3-brief.md's carried ruling — 조이 is covered
// separately, via DECOY_SUPPLEMENT, since it's 조-prefixed).
const REQUIRED_DECOYS = [
  '만두',
  '천천히',
  '오만',
  '억지',
  '조금',
  '만약',
  '만일',
  '천사',
  '만성',
  '억양',
  '조각',
  '사장',
  '이번',
  '이분',
  '조이',
  '이장',
  '사병',
  '일병',
  '오분',
]

function assertRequiredDecoys(decoys) {
  for (const w of REQUIRED_DECOYS) {
    if (!decoys.has(w)) {
      throw new Error(
        `REQUIRED_DECOYS entry "${w}" is missing from the mined NUMBER_DECOYS — ` +
          `add it to DECOY_SUPPLEMENT or fix the source URLs, do not emit a lexicon missing it`,
      )
    }
  }
}

// --- TYPO_PAIRS -----------------------------------------------------------

function mineTypos(typosTxt) {
  const map = new Map()
  for (const line of parseLines(typosTxt)) {
    const parts = line.split(' ')
    if (parts.length !== 2) continue
    const [from, to] = parts
    if (!PURE_HANGUL.test(from) || !PURE_HANGUL.test(to)) continue
    if (from === to) continue
    map.set(from, to)
  }
  return map
}

// --- output ---------------------------------------------------------------

const GENERATED_HEADER =
  '// GENERATED by scripts/lang/mine-korean-lexicons.mjs — do not hand-edit; source licenses in NOTICE.\n'

function quote(s) {
  return `'${s}'`
}

function writeJosaFile(josa) {
  const body = josa.map((w) => `  ${quote(w)},`).join('\n')
  const content =
    GENERATED_HEADER +
    `// Source: open-korean-text josa.txt ∩ mecab-ko-dic J.csv, intersected\n` +
    `// with a hand-audited allowlist of josa relevant to name/participant\n` +
    `// binding (see JOSA_ALLOWLIST in the mining script). Sorted longest-first\n` +
    `// so a detacher trying entries in order matches 이랑 before 랑, 한테서\n` +
    `// before 한테.\n\n` +
    `export const JOSA: readonly string[] = [\n${body}\n]\n`
  writeFileSync(path.join(OUT_DIR, 'lexicon-josa.ts'), content)
}

function writeDecoysFile(decoys) {
  const sorted = [...decoys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const body = sorted.map((w) => `  ${quote(w)},`).join('\n')
  const content =
    GENERATED_HEADER +
    `// Source: mecab-ko-dic NNG.csv (일반명사) + MAG.csv (일반부사), filtered to\n` +
    `// pure-hangul words of length >= 2 starting with a sino-Korean digit/unit\n` +
    `// syllable (일이삼사오육칠팔구십백천만억). Plus a small manual supplement\n` +
    `// for words a 조-excluding filter can't reach (see DECOY_SUPPLEMENT in the\n` +
    `// mining script).\n` +
    `//\n` +
    `// RULING (supersedes an earlier draft of this filter's own description —\n` +
    `// see the mining script's comment above mineDecoys): a decoy word may be a\n` +
    `// FULLY PARSEABLE NUMBER ("오만"/"만원"/"천만" all read as valid digit\n` +
    `// sequences) — that was never the filter. This set is which surface forms\n` +
    `// PREFER the word reading; numbers.ts's rescue logic decides when the\n` +
    `// numeral reading wins anyway. Do not add an "exclude anything that's\n` +
    `// also parseable as a number" filter here.\n\n` +
    `export const NUMBER_DECOYS: ReadonlySet<string> = new Set([\n${body}\n])\n`
  writeFileSync(path.join(OUT_DIR, 'lexicon-decoys.ts'), content)
}

function writeTyposFile(typos) {
  const sorted = [...typos.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const body = sorted.map(([from, to]) => `  [${quote(from)}, ${quote(to)}],`).join('\n')
  const content =
    GENERATED_HEADER +
    `// Source: open-korean-text typos.txt, filtered to pairs where both the\n` +
    `// colloquial and standard forms are pure hangul.\n\n` +
    `export const TYPO_PAIRS: ReadonlyMap<string, string> = new Map([\n${body}\n])\n`
  writeFileSync(path.join(OUT_DIR, 'lexicon-typos.ts'), content)
}

async function main() {
  console.log('Fetching open-korean-text josa.txt...')
  const oktJosa = await fetchText(OKT_JOSA_URL)
  console.log('Fetching open-korean-text typos.txt...')
  const oktTypos = await fetchText(OKT_TYPOS_URL)
  console.log('Fetching mecab-ko-dic J.csv...')
  const mecabJ = await fetchText(MECAB_J_URL)
  console.log('Fetching mecab-ko-dic NNG.csv...')
  const mecabNng = await fetchText(MECAB_NNG_URL)
  console.log('Fetching mecab-ko-dic MAG.csv...')
  const mecabMag = await fetchText(MECAB_MAG_URL)

  const josa = mineJosa(oktJosa, mecabJ)
  const decoys = mineDecoys(mecabNng, mecabMag)
  const typos = mineTypos(oktTypos)

  if (josa.length === 0) throw new Error('mined JOSA is empty — refusing to emit an empty lexicon')
  if (decoys.size === 0) {
    throw new Error('mined NUMBER_DECOYS is empty — refusing to emit an empty lexicon')
  }
  if (typos.size === 0) {
    throw new Error('mined TYPO_PAIRS is empty — refusing to emit an empty lexicon')
  }
  assertRequiredDecoys(decoys)

  writeJosaFile(josa)
  writeDecoysFile(decoys)
  writeTyposFile(typos)

  console.log(`JOSA: ${josa.length} entries`)
  console.log(`NUMBER_DECOYS: ${decoys.size} entries`)
  console.log(`TYPO_PAIRS: ${typos.size} entries`)
}

main().catch((err) => {
  console.error('Mining FAILED:', err.message)
  process.exit(1)
})
