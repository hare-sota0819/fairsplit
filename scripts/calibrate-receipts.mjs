// Phase 5 receipt calibration. Model, repeats and thinking are env-overridable
// (MODEL / REPEATS / THINKING=off / ONLY_LONG_EDGE / ONLY_MEDIA).
// Brief PHASE5_RECEIPT_PROMPT.md §45-67: long edge = original/2400/1800/1500/1200,
// production prompt, real token counts from usageMetadata, thinking reported
// separately. Adds a media_resolution axis (see report) because it is the
// dominant token lever and the brief does not mention it.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
// The production prompt and response schema, imported rather than copied: a
// calibration that measures a stale prompt measures nothing. Node strips the
// TypeScript types on the way in. This drift is not hypothetical — the copy
// that used to live here was missing the whole TAX block by 2026-08-09.
import {
  RECEIPT_RESPONSE_SCHEMA as SCHEMA,
  RECEIPT_SYSTEM_PROMPT as PROMPT,
} from '../src/lib/receipts/prompt.ts'
// The script lives in a scratchpad outside the repo, so resolve sharp from the
// project's node_modules explicitly rather than by upward lookup.
const sharp = createRequire(path.join(process.cwd(), 'package.json'))('sharp')

const KEY = process.env.GEMINI_API_KEY
// Overridable so the same grid can be re-run against a GA model without
// forking the script (OPEN_QUESTIONS #2).
const MODEL = process.env.MODEL || 'gemini-3-flash-preview'
const DIR = 'test-fixtures/receipts'
const OUT = process.argv[2] || 'calibration-results.json'
const ONLY_LONG_EDGE = process.env.ONLY_LONG_EDGE ? Number(process.env.ONLY_LONG_EDGE) : null
const ONLY_MEDIA = process.env.ONLY_MEDIA || null
const THINKING = process.env.THINKING || null // 'off' => thinkingBudget 0
// A single call per cell cannot tell a real accuracy difference from sampling
// noise, so the thinking and GA-model comparisons run the same cell N times.
const REPEATS = process.env.REPEATS ? Number(process.env.REPEATS) : 1

// Ground truth, read by hand from each photo. Amounts are JPY minor units
// (exponent 0). `positives` is the multiset of charged line amounts;
// `negatives` is the multiset of standalone discount lines.
const TRUTH = {
  'KakaoTalk_20260808_001448764.jpg': {
    label: 'pokemon-center',
    kind: 'medium (6 lines / 10 pieces)',
    positives: [1067, 2134, 3300, 400, 20, 0],
    negatives: [],
    total: 6921,
    taxInclusive: 629,
  },
  'KakaoTalk_20260808_001448764_01.jpg': {
    label: 'sundrug',
    kind: 'long (13 lines)',
    positives: [348, 348, 348, 348, 348, 348, 348, 348, 700, 700, 700, 700, 700],
    negatives: [],
    total: 6284,
    taxInclusive: 0, // tax-free sale (免税売上)
  },
  'KakaoTalk_20260808_001448764_02.jpg': {
    label: 'familymart',
    kind: 'short, poor quality (crumpled)',
    positives: [372, 267, 267],
    negatives: [-100],
    total: 806,
    taxInclusive: 59,
  },
  'KakaoTalk_20260808_001448764_03.jpg': {
    label: 'menshou-takamatsu',
    kind: 'short, header cropped',
    positives: [1260, 300],
    negatives: [],
    total: 1560,
    taxInclusive: 141,
  },
}

const LONG_EDGES = [0, 2400, 1800, 1500, 1200] // 0 = original
const MEDIA = ['DEFAULT', 'LOW', 'MEDIUM', 'HIGH']

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function variantBuffer(file, longEdge) {
  // .rotate() with no argument bakes in the EXIF orientation. All four fixtures
  // are orientation 6; without it every receipt reaches the model sideways.
  const pipe = sharp(path.join(DIR, file)).rotate()
  if (longEdge > 0) pipe.resize({ width: longEdge, height: longEdge, fit: 'inside', withoutEnlargement: true })
  return pipe.jpeg({ quality: 80 }).toBuffer()
}

async function callGemini(buf, media) {
  const generationConfig = {
    responseMimeType: 'application/json',
    responseSchema: SCHEMA,
  }
  if (media !== 'DEFAULT') generationConfig.mediaResolution = `MEDIA_RESOLUTION_${media}`
  if (THINKING === 'off') generationConfig.thinkingConfig = { thinkingBudget: 0 }

  const body = {
    contents: [
      { parts: [{ text: PROMPT }, { inline_data: { mime_type: 'image/jpeg', data: buf.toString('base64') } }] },
    ],
    generationConfig,
  }
  for (let attempt = 0; attempt < 6; attempt++) {
    const started = Date.now()
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    )
    const json = await res.json()
    if (json.error) {
      if (json.error.code === 429 || json.error.code >= 500) {
        await sleep(5000 * (attempt + 1))
        continue
      }
      return { error: `${json.error.code} ${json.error.message}`.slice(0, 200) }
    }
    const u = json.usageMetadata || {}
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? ''
    let parsed = null
    try {
      parsed = JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, ''))
    } catch {
      /* scored as unparseable */
    }
    return {
      ms: Date.now() - started,
      promptTokens: u.promptTokenCount ?? 0,
      outputTokens: u.candidatesTokenCount ?? 0,
      thoughtsTokens: u.thoughtsTokenCount ?? 0,
      totalTokens: u.totalTokenCount ?? 0,
      finishReason: json.candidates?.[0]?.finishReason,
      parsed,
    }
  }
  return { error: 'exhausted retries' }
}

const eqMultiset = (a, b) => {
  const x = [...a].sort((p, q) => p - q)
  const y = [...b].sort((p, q) => p - q)
  return x.length === y.length && x.every((v, i) => v === y[i])
}

function score(parsed, truth) {
  if (!parsed || !Array.isArray(parsed.items)) return { exact: false, note: 'unparseable' }
  // A modifier folded onto a parent contributes to that parent's effective amount.
  const flat = parsed.items.map((i) => ({
    amount: i.amountMinor + (i.modifiers || []).reduce((s, m) => s + m.amountMinor, 0),
    bare: i.amountMinor,
  }))
  const positives = flat.filter((f) => f.bare >= 0).map((f) => f.bare)
  const negatives = flat.filter((f) => f.bare < 0).map((f) => f.bare)
  const modifierSum = parsed.items.reduce(
    (s, i) => s + (i.modifiers || []).reduce((t, m) => t + m.amountMinor, 0),
    0,
  )
  const itemCountOk = positives.length === truth.positives.length
  const amountsOk = eqMultiset(positives, truth.positives)
  // The discount may legitimately land as a negative item OR as a modifier.
  const discountOk =
    eqMultiset(negatives, truth.negatives) ||
    modifierSum === truth.negatives.reduce((a, b) => a + b, 0)
  const totalOk = parsed.totalMinor === truth.total
  const sumMatchesTotal =
    flat.reduce((s, f) => s + f.amount, 0) + (truth.negatives.length && negatives.length === 0 ? modifierSum * 0 : 0) ===
    truth.total
  return {
    exact: itemCountOk && amountsOk && discountOk && totalOk,
    itemCountOk,
    amountsOk,
    discountOk,
    totalOk,
    gotCount: positives.length,
    wantCount: truth.positives.length,
    gotTotal: parsed.totalMinor,
    itemSum: flat.reduce((s, f) => s + f.amount, 0),
    sumMatchesTotal,
    currency: parsed.currency,
  }
}

const files = Object.keys(TRUTH).filter((f) => fs.existsSync(path.join(DIR, f)))
if (!files.length) {
  console.error(`No fixtures in ${DIR} — nothing to calibrate.`)
  process.exit(1)
}

const edges = ONLY_LONG_EDGE !== null ? [ONLY_LONG_EDGE] : LONG_EDGES
const medias = ONLY_MEDIA ? [ONLY_MEDIA] : MEDIA
const jobs = []
for (const file of files)
  for (const e of edges)
    for (const m of medias)
      for (let run = 0; run < REPEATS; run++) jobs.push({ file, e, m, run })

console.error(
  `${jobs.length} calls — ${files.length} receipts x ${edges.length} long-edges x ${medias.length} media` +
    (THINKING === 'off' ? ' [thinking OFF]' : ''),
)

const results = []
let cursor = 0
let done = 0
async function worker() {
  while (cursor < jobs.length) {
    const job = jobs[cursor++]
    const buf = await variantBuffer(job.file, job.e)
    const meta = await sharp(buf).metadata()
    const r = await callGemini(buf, job.m)
    const truth = TRUTH[job.file]
    const row = {
      model: MODEL,
      run: job.run,
      receipt: truth.label,
      kind: truth.kind,
      longEdge: job.e || Math.max(meta.width, meta.height),
      isOriginal: job.e === 0,
      dims: `${meta.width}x${meta.height}`,
      kb: Math.round(buf.length / 1024),
      media: job.m,
      thinking: THINKING === 'off' ? 'off' : 'default',
      ...r,
      score: r.error ? null : score(r.parsed, truth),
    }
    row.items = r.parsed?.items ?? null
    row.taxMinor = r.parsed?.taxMinor ?? null
    // The whole tax-inclusive invariant (OPEN_QUESTIONS #1) rests on the model
    // reporting this correctly, so a calibration run has to record it.
    row.taxIncludedInItems = r.parsed?.taxIncludedInItems ?? null
    delete row.parsed
    results.push(row)
    done++
    process.stderr.write(
      `[${done}/${jobs.length}] ${truth.label.padEnd(18)} edge=${String(row.longEdge).padEnd(5)} ${row.media.padEnd(7)} ` +
        `in=${row.promptTokens ?? '-'} think=${row.thoughtsTokens ?? '-'} out=${row.outputTokens ?? '-'} ` +
        `${row.ms ?? '-'}ms exact=${row.score?.exact ?? 'ERR'}${r.error ? ' ' + r.error : ''}\n`,
    )
  }
}
await Promise.all(Array.from({ length: 4 }, worker))
results.sort((a, b) => a.receipt.localeCompare(b.receipt) || b.longEdge - a.longEdge || a.media.localeCompare(b.media))
fs.writeFileSync(OUT, JSON.stringify(results, null, 2))
console.error(`\nwrote ${OUT}`)
