// Samples negative-control sentences from three open conversational corpora
// and writes them as fuzz fixtures under test-fixtures/goat/, consumed by
// src/lib/chat-parse/goat-corpus.test.ts.
//
// WHAT THESE ARE FOR: movie reviews and chitchat are, by construction, not
// expense entries. So every row is a NEGATIVE control — `parse()` must find
// no amount and `classify()` must not route it to EXPENSE_ENTRY/EDIT_EXPENSE,
// on 2,000 sentences nobody wrote for this parser. That is the only way to
// measure false-positive pressure honestly: the corpus rows in
// ko-sentences.json/en-sentences.json can only prove what the parser FINDS,
// never what it should have left alone.
//
// Rows that genuinely mention money (a movie review complaining a ticket cost
// 만원) are NOT filtered out here — filtering them would be marking our own
// homework. They stay in the sample and get an `allowAmount: true` flag, added
// by hand in the fixture after review, which the test reads as "this row is
// permitted to yield an amount". Everything else must yield null.
//
// Sources (pinned to a commit SHA for reproducibility — re-pin deliberately,
// don't float on a branch head). See NOTICE for licenses:
//   - NSMC, Naver sentiment movie corpus (https://github.com/e9t/nsmc) — CC0-1.0
//     ratings_test.txt (50K Korean movie reviews, id/document/label TSV)
//   - Chatbot_data (https://github.com/songys/Chatbot_data) — MIT
//     ChatbotData.csv (11.8K Korean chitchat Q/A pairs)
//   - chatterbot-corpus (https://github.com/gunthercox/chatterbot-corpus) —
//     BSD-3-Clause, chatterbot_corpus/data/english/*.yml (English chitchat)
//
// The English source is a DEVIATION from the task brief, which named only
// NSMC and Chatbot_data: both of those are Korean-only, so they cannot fuzz
// the English pipeline at all. chatterbot-corpus was chosen as the English
// counterpart on the same three criteria the Korean pair satisfies —
// permissive license, GitHub-hosted so it can be SHA-pinned, and ordinary
// conversation rather than task-oriented dialogue (a booking/ordering corpus
// would be full of real prices, which makes a false-positive gate meaningless).
// `coding.yml` and `tech_support.yml` are excluded: they are source code and
// shell transcripts, not English sentences.
//
// Run: node scripts/lang/fetch-fuzz-samples.mjs
//
// Network is required. If any fetch fails or a sample comes up short, the
// script throws and exits non-zero rather than emitting a partial fixture
// (mirrors mine-korean-lexicons.mjs's house rule).

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT_DIR = path.join(__dirname, '../../test-fixtures/goat')

const NSMC_SHA = 'cc0670e872d4ac27bfe36c87456783004b39ef6c'
const CHATBOT_SHA = '4cf20d13fc46f5037fd1c531cd566e2dd9f72974'
const CHATTERBOT_SHA = 'eec45b284424c9784a5baab78368b1a9ff3b656f'

const NSMC_URL = `https://raw.githubusercontent.com/e9t/nsmc/${NSMC_SHA}/ratings_test.txt`
const CHATBOT_URL = `https://raw.githubusercontent.com/songys/Chatbot_data/${CHATBOT_SHA}/ChatbotData.csv`
const CHATTERBOT_BASE = `https://raw.githubusercontent.com/gunthercox/chatterbot-corpus/${CHATTERBOT_SHA}/chatterbot_corpus/data/english`

const CHATTERBOT_FILES = [
  'ai',
  'botprofile',
  'computers',
  'conversations',
  'emotion',
  'food',
  'gossip',
  'greetings',
  'health',
  'history',
  'humor',
  'literature',
  'money',
  'movies',
  'politics',
  'psychology',
  'science',
  'sports',
  'trivia',
]

const SAMPLE_SIZE = 1000
/** Korean sample split between its two sources, so neither register (movie
 *  review vs. chitchat) dominates the gate. */
const KO_NSMC_SHARE = 500
const KO_CHATBOT_SHARE = SAMPLE_SIZE - KO_NSMC_SHARE

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

/** Deterministic PRNG (mulberry32) so re-running the script reproduces the
 *  SAME sample — a fuzz fixture that reshuffles on every run would turn every
 *  re-mine into an unreviewable diff. */
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SEED = 20260813

/** Picks `n` items without replacement, then restores source order so the
 *  emitted fixture reads in corpus order and diffs stay local. */
function sample(pool, n, rng) {
  if (pool.length < n) {
    throw new Error(`refusing to emit a short sample: pool has ${pool.length}, need ${n}`)
  }
  const idx = pool.map((_, i) => i)
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[idx[i], idx[j]] = [idx[j], idx[i]]
  }
  return idx
    .slice(0, n)
    .sort((a, b) => a - b)
    .map((i) => pool[i])
}

/** Shared row hygiene: a fuzz row has to be a sentence a person could plausibly
 *  type into the chat box. Length-bounded (the parser's own inputs are chat
 *  lines) and de-duplicated by the caller. Nothing here looks at digits or
 *  money words — see the "marking our own homework" note at the top. */
function isUsableRow(text) {
  if (text.length < 4 || text.length > 140) return false
  if (/[\t\r\n]/.test(text)) return false
  return true
}

function parseNsmc(tsv) {
  const out = []
  const lines = tsv.split('\n')
  if (!lines[0].startsWith('id\tdocument\tlabel')) {
    throw new Error('NSMC: unexpected header — source format drifted')
  }
  for (const line of lines.slice(1)) {
    const cols = line.split('\t')
    if (cols.length !== 3) continue
    const text = cols[1].trim()
    if (isUsableRow(text)) out.push(text)
  }
  return out
}

/** Minimal RFC4180-ish reader — ChatbotData.csv has quoted fields containing
 *  commas, so a plain split(',') would shred them. */
function parseCsvRows(csv) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i]
    if (quoted) {
      if (c === '"') {
        if (csv[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
    } else if (c === '"') {
      quoted = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (c !== '\r') {
      field += c
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

function parseChatbotData(csv) {
  const rows = parseCsvRows(csv)
  const header = rows[0]
  if (!header || header[0] !== 'Q' || header[1] !== 'A') {
    throw new Error('Chatbot_data: unexpected header — source format drifted')
  }
  const out = []
  for (const r of rows.slice(1)) {
    if (r.length < 2) continue
    // Both halves are chat text a user could type; Q is the user turn, A the
    // bot turn, and neither is an expense entry.
    for (const text of [r[0].trim(), r[1].trim()]) {
      if (isUsableRow(text)) out.push(text)
    }
  }
  return out
}

/** chatterbot-corpus YAML rows are plain `- text` list items, two levels deep
 *  under `conversations:`. The files carry no anchors/aliases/multiline
 *  scalars, so the list-item shape is the whole grammar we need. */
function parseChatterbot(yml) {
  const out = []
  for (const raw of yml.split('\n')) {
    const m = /^\s*-\s+(?:-\s+)?(.*)$/.exec(raw)
    if (!m) continue
    let text = m[1].trim()
    if (text === '') continue
    // strip a YAML-quoted scalar
    if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
      text = text.slice(1, -1)
    }
    if (!/[A-Za-z]/.test(text)) continue
    if (isUsableRow(text)) out.push(text)
  }
  return out
}

function dedupe(rows) {
  return [...new Set(rows)]
}

const HEADER = (sources) => ({
  _generatedBy: 'scripts/lang/fetch-fuzz-samples.mjs — do not hand-edit EXCEPT to add `allowAmount: true` to a reviewed row.',
  _purpose:
    'Negative controls. parse() must return amount: null and classify() must not return EXPENSE_ENTRY-with-amount or EDIT_EXPENSE for any row, except rows explicitly flagged allowAmount.',
  _sources: sources,
})

/** Re-running the script must never silently drop the `allowAmount` flags a
 *  human added after review — they are the only hand-maintained part of these
 *  files. Carry them over by TEXT (not row index, which moves if a share or
 *  seed changes), and shout if a flagged row is no longer in the sample. */
function carryOverAllowAmount(outPath, rows) {
  let previous
  try {
    previous = JSON.parse(readFileSync(outPath, 'utf8'))
  } catch {
    return rows
  }
  const flagged = new Set((previous.rows ?? []).filter((r) => r.allowAmount).map((r) => r.text))
  if (flagged.size === 0) return rows
  const seen = new Set()
  const carried = rows.map((r) => {
    if (!flagged.has(r.text)) return r
    seen.add(r.text)
    return { ...r, allowAmount: true }
  })
  const lost = [...flagged].filter((t) => !seen.has(t))
  if (lost.length > 0) {
    console.warn(
      `WARNING: ${lost.length} previously reviewed allowAmount row(s) fell out of ${path.basename(outPath)}; ` +
        `re-review the new sample:\n  ${lost.join('\n  ')}`,
    )
  }
  return carried
}

function write(file, header, rows) {
  const outPath = path.join(OUT_DIR, file)
  const carried = carryOverAllowAmount(outPath, rows)
  writeFileSync(outPath, JSON.stringify({ ...header, rows: carried }, null, 2) + '\n')
  const flags = carried.filter((r) => r.allowAmount).length
  console.log(`${file}: ${carried.length} rows (${flags} allowAmount)`)
}

async function main() {
  console.log('Fetching NSMC ratings_test.txt...')
  const nsmcRaw = await fetchText(NSMC_URL)
  console.log('Fetching Chatbot_data ChatbotData.csv...')
  const chatbotRaw = await fetchText(CHATBOT_URL)
  console.log('Fetching chatterbot-corpus english/*.yml...')
  const chatterbotRaw = []
  for (const f of CHATTERBOT_FILES) {
    chatterbotRaw.push(await fetchText(`${CHATTERBOT_BASE}/${f}.yml`))
  }

  const rng = mulberry32(SEED)

  const nsmc = dedupe(parseNsmc(nsmcRaw))
  const chatbot = dedupe(parseChatbotData(chatbotRaw))
  const chatterbot = dedupe(parseChatterbot(chatterbotRaw.join('\n')))
  console.log(`pools: nsmc=${nsmc.length} chatbot=${chatbot.length} chatterbot=${chatterbot.length}`)

  const koRows = [
    ...sample(nsmc, KO_NSMC_SHARE, rng).map((text) => ({ text, source: 'nsmc' })),
    ...sample(chatbot, KO_CHATBOT_SHARE, rng).map((text) => ({ text, source: 'chatbot_data' })),
  ]
  const enRows = sample(chatterbot, SAMPLE_SIZE, rng).map((text) => ({ text, source: 'chatterbot_corpus' }))

  if (koRows.length !== SAMPLE_SIZE || enRows.length !== SAMPLE_SIZE) {
    throw new Error('refusing to emit a fixture that is not exactly the requested sample size')
  }

  write(
    'fuzz-ko.json',
    HEADER([
      { name: 'NSMC (Naver sentiment movie corpus)', license: 'CC0-1.0', commit: NSMC_SHA, url: NSMC_URL, rows: KO_NSMC_SHARE },
      { name: 'Chatbot_data', license: 'MIT', commit: CHATBOT_SHA, url: CHATBOT_URL, rows: KO_CHATBOT_SHARE },
    ]),
    koRows,
  )
  write(
    'fuzz-en.json',
    HEADER([
      {
        name: 'chatterbot-corpus (english)',
        license: 'BSD-3-Clause',
        commit: CHATTERBOT_SHA,
        url: `${CHATTERBOT_BASE}/{${CHATTERBOT_FILES.join(',')}}.yml`,
        rows: SAMPLE_SIZE,
      },
    ]),
    enRows,
  )
}

main().catch((err) => {
  console.error('Fuzz sampling FAILED:', err.message)
  process.exit(1)
})
