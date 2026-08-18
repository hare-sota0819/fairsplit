// Converts two upstream English number/amount corpora into normalized JSON
// fixtures under test-fixtures/goat/, consumed by
// src/lib/chat-parse/en/numbers.test.ts.
//
// Both upstreams are pinned to a commit SHA for reproducibility — re-pin
// deliberately, don't float on a branch head. See NOTICE for licenses.
//   - Duckling (https://github.com/facebook/duckling) — BSD-3-Clause
//     Duckling/AmountOfMoney/EN/Corpus.hs
//   - Microsoft Recognizers-Text (https://github.com/microsoft/Recognizers-Text) — MIT
//     Specs/NumberWithUnit/English/CurrencyModel.json
//
// Run: node scripts/lang/convert-en-fixtures.mjs
//
// Network is required. If any fetch fails or returns an empty/unparseable
// body, the script throws and exits non-zero rather than emitting an empty
// or partial fixture (mirrors mine-korean-lexicons.mjs's house rule).

import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT_DIR = path.join(__dirname, '../../test-fixtures/goat')

const DUCKLING_SHA = '8a8f55700269192e691e03779c90861dceadef39'
const MS_SHA = 'b6d844335aa1efebfdd8a1d14aa20764aba7829d'

const DUCKLING_URL = `https://raw.githubusercontent.com/facebook/duckling/${DUCKLING_SHA}/Duckling/AmountOfMoney/EN/Corpus.hs`
const MS_URL = `https://raw.githubusercontent.com/microsoft/Recognizers-Text/${MS_SHA}/Specs/NumberWithUnit/English/CurrencyModel.json`

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

// --- Duckling Corpus.hs ----------------------------------------------------
//
// Only `simple CURRENCY VALUE` examples are converted — `between`/`under`/
// `above` constructors describe a RANGE or a threshold, not a single value,
// and the normalized row schema here (one `value` per row, per the brief)
// has no way to represent that faithfully. Skipping them is a deliberate
// scope decision, not an oversight: extending the schema to carry a range
// would be new surface area this task doesn't need (Task 5 reads NUMBERS,
// not amount ranges).
//
// `Unnamed` is Duckling's tag for "no specific currency recognized" — mapped
// to `currency: null` here. This is the corpus's OWN ground truth about
// which phrases are currency-free (not a re-guess from surface text), which
// is why e.g. "42 bucks" (tagged `simple Unnamed 42`) ends up a plain-number
// fixture row: readEnglishNumber's job is only to read the leading "42"
// correctly and stop, regardless of what non-numeric word follows.

const DUCKLING_CURRENCY_MAP = {
  Unnamed: null,
  Dollar: 'Dollar',
  Cent: 'Cent',
  USD: 'USD',
  EUR: 'EUR',
  Pound: 'Pound',
  INR: 'INR',
  GBP: 'GBP',
  CAD: 'CAD',
  CHF: 'CHF',
  CNY: 'CNY',
  KWD: 'KWD',
  LBP: 'LBP',
  EGP: 'EGP',
  QAR: 'QAR',
  SAR: 'SAR',
  BGN: 'BGN',
  MYR: 'MYR',
  Dinar: 'Dinar',
  ILS: 'ILS',
  Riyal: 'Riyal',
  Rial: 'Rial',
  MNT: 'MNT',
  UAH: 'UAH',
}

/** Decodes Haskell numeric-escape sequences found in Corpus.hs string
 * literals — only `\xHHHH` (optionally followed by the `\&` empty-string
 * separator Haskell uses to end a numeric escape before more digits) shows
 * up in this file (e.g. "\x00a3\&10" = "£10", "20\x20ac" = "20€"). */
function decodeHaskellString(raw) {
  return raw.replace(/\\x([0-9a-fA-F]+)(\\&)?/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
}

/** Parses a Haskell numeric literal (`42`, `20.43`, `1e4`, `4.7e9`) into an
 * exact decimal string — no parseFloat, so no float rounding ever touches
 * fixture data (this repo's money policy: exact integer/rational
 * arithmetic only, see docs/DECISIONS.md). Returns `{ digits, scale }` where the
 * real value is `digits * 10^-scale`, both as decimal strings/integers. */
function parseHaskellLiteral(lit) {
  const m = /^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(lit)
  if (!m) throw new Error(`unparseable Haskell numeric literal: ${lit}`)
  const [, intPart, fracPart = '', expPart] = m
  let digits = intPart + fracPart
  let scale = fracPart.length
  const exp = expPart ? parseInt(expPart, 10) : 0
  if (exp > 0) {
    if (exp >= scale) {
      digits += '0'.repeat(exp - scale)
      scale = 0
    } else {
      scale -= exp
    }
  } else if (exp < 0) {
    scale -= exp // exp negative, so this increases scale
  }
  // strip leading zeros (keep at least one digit)
  digits = digits.replace(/^0+(?=\d)/, '')
  return { digits, scale }
}

function convertDuckling(hs) {
  const rows = []

  // negativeCorpus: `[ "exactly dollars" ]`
  const negBlock = /negativeCorpus\s*::[\s\S]*?examples\s*=\s*\[([\s\S]*?)\]/.exec(hs)
  if (!negBlock) throw new Error('Duckling: could not locate negativeCorpus block')
  for (const m of negBlock[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
    rows.push({ text: decodeHaskellString(m[1]), value: null, currency: null, negative: true })
  }

  // `examples (simple CURRENCY LITERAL) [ "s1", "s2", ... ]` blocks, in both
  // `allExamples` (corpus) and `latentCorpus`.
  const simpleRe = /examples\s*\(simple\s+(\w+)\s+([\d.eE+-]+)\)\s*\[([\s\S]*?)\]/g
  let simpleCount = 0
  for (const m of hs.matchAll(simpleRe)) {
    const [, currencyTag, literal] = m
    if (!(currencyTag in DUCKLING_CURRENCY_MAP)) {
      throw new Error(`Duckling: unknown currency constructor "${currencyTag}" — add it to DUCKLING_CURRENCY_MAP`)
    }
    const { digits, scale } = parseHaskellLiteral(literal)
    const currency = DUCKLING_CURRENCY_MAP[currencyTag]
    for (const strM of m[3].matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
      rows.push({
        text: decodeHaskellString(strM[1]),
        value: { digits, scale },
        currency,
        negative: false,
      })
      simpleCount++
    }
  }
  if (simpleCount === 0) throw new Error('Duckling: matched zero `simple` example rows — regex drifted from source shape')

  return rows
}

// --- MS Recognizers-Text CurrencyModel.json --------------------------------
//
// Every positive row in this corpus is, by construction, a currency-bearing
// span (that's the whole point of a *currency* spec file) — so after the
// plain-number filter (`currency === null`) is applied in the test, this
// source contributes zero rows to Task 5's own assertions. It's still
// converted and committed here because Task 6 (the amount parser) needs the
// same pinned/normalized fixture, and because the empty-Results "negative"
// rows below ARE useful now: they're sentences with no currency amount, not
// necessarily sentences with no NUMBER (e.g. "All 70 of us." has no
// currency but does have a number) — so, unlike Duckling's negativeCorpus,
// they are NOT marked in a way that asserts readEnglishNumber must return
// null; numbers.test.ts must not treat MS's `negative: true` the same way
// it treats Duckling's.

function convertMs(json) {
  const data = JSON.parse(json)
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('MS CurrencyModel.json: parsed to an empty/non-array body')
  }
  const rows = []
  let positiveCount = 0
  for (const row of data) {
    if (!row.Results || row.Results.length === 0) {
      // "negative" here means "no currency amount found" — see doc-comment
      // above. Input text may still contain a plain number.
      rows.push({ text: row.Input, value: null, currency: null, negative: true })
      continue
    }
    for (const r of row.Results) {
      const raw = r.Resolution?.value
      if (raw === null || raw === undefined) continue // e.g. bare "rmb" — no numeric value resolved
      const neg = raw.startsWith('-')
      const unsigned = neg ? raw.slice(1) : raw
      const dotIdx = unsigned.indexOf('.')
      const digits = dotIdx === -1 ? unsigned : unsigned.slice(0, dotIdx) + unsigned.slice(dotIdx + 1)
      const scale = dotIdx === -1 ? 0 : unsigned.length - dotIdx - 1
      rows.push({
        text: r.Text,
        value: { digits, scale, negative: neg },
        currency: r.Resolution.unit ?? null,
        negative: false,
      })
      positiveCount++
    }
  }
  if (positiveCount === 0) throw new Error('MS CurrencyModel.json: matched zero positive Result rows')
  return rows
}

const GENERATED_HEADER_FIELDS = (source, sha, sourceUrl) => ({
  _generatedBy: 'scripts/lang/convert-en-fixtures.mjs — do not hand-edit; source licenses in NOTICE.',
  _source: source,
  _sourceCommit: sha,
  _sourceUrl: sourceUrl,
})

async function main() {
  console.log('Fetching Duckling AmountOfMoney EN Corpus.hs...')
  const hs = await fetchText(DUCKLING_URL)
  console.log('Fetching MS Recognizers-Text English CurrencyModel.json...')
  const msJson = await fetchText(MS_URL)

  const ducklingRows = convertDuckling(hs)
  const msRows = convertMs(msJson)

  if (ducklingRows.length === 0) throw new Error('refusing to emit an empty duckling-en-amounts.json')
  if (msRows.length === 0) throw new Error('refusing to emit an empty ms-currency-model.json')

  const ducklingOut = {
    ...GENERATED_HEADER_FIELDS('Duckling AmountOfMoney/EN/Corpus.hs', DUCKLING_SHA, DUCKLING_URL),
    rows: ducklingRows,
  }
  const msOut = {
    ...GENERATED_HEADER_FIELDS('Microsoft Recognizers-Text Specs/NumberWithUnit/English/CurrencyModel.json', MS_SHA, MS_URL),
    rows: msRows,
  }

  writeFileSync(path.join(OUT_DIR, 'duckling-en-amounts.json'), JSON.stringify(ducklingOut, null, 2) + '\n')
  writeFileSync(path.join(OUT_DIR, 'ms-currency-model.json'), JSON.stringify(msOut, null, 2) + '\n')

  console.log(`duckling-en-amounts.json: ${ducklingRows.length} rows`)
  console.log(`ms-currency-model.json: ${msRows.length} rows`)
}

main().catch((err) => {
  console.error('Conversion FAILED:', err.message)
  process.exit(1)
})
