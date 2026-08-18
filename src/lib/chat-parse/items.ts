import { scanAmountCandidates, type AmountCandidate } from '../assistant/hangul-number'
import { parseAmountToMinor } from '../format'
import { tokenize } from './engine/tokenizer'
import { findPeopleWithActor } from './parsers/people'
import type { ParseContext } from './types'

export interface ParsedItem {
  name: string
  /**
   * Decimal string, same convention as ExpenseItemSchema (not minor units) —
   * or null: the sentence enumerated this item WITHOUT a price ("콜라 하나,
   * 우동 3개"), and the UI must ask for it before save. A null here is a
   * representable, first-class state precisely because throwing the item away
   * (the pre-2026-08-14 behavior: parseItems bailed to null and the
   * single-amount path silently dropped the quantity) booked wrong totals.
   */
  unitAmount: string | null
  /** Integer >= 1. */
  quantity: number
  /**
   * Members the SENTENCE assigns this line to ("우동은 내가 다먹었고",
   * "콜라는 수탉이"), as member ids — pre-ticks for the assign card, exactly
   * the shape `toChatItems` seeds. Empty = the sentence said nothing.
   */
  assigneeIds: string[]
  /**
   * The sentence said this line is shared out ("우유롤은 하나씩 나눠먹음")
   * without naming who — divide among the expense's participants, which only
   * the caller knows (`assignEveryone`). Never set together with a non-empty
   * `assigneeIds`.
   */
  shareAll: boolean
}

export interface ParsedItemList {
  items: ParsedItem[]
  /** Resolved, single currency for the whole sentence. */
  currency: string
}

// --- quantity markers -------------------------------------------------------

/**
 * Counter words a quantity number binds to. Deliberately excludes head-count
 * counters (명/분/살) and time/measure units — "우리 4명이서" counts people,
 * not items. 인분 is the food exception: it counts servings bought.
 */
const COUNTERS = '개|인분|잔|병|그릇|판|조각|봉지|캔|마리|접시|팩|통|장|줄'

/** Native numerals in their pre-counter (determiner) form: 두 개, 세 잔. */
const NATIVE_NUM: ReadonlyArray<[string, number]> = [
  ['한', 1],
  ['두', 2],
  ['세', 3],
  ['네', 4],
  ['다섯', 5],
  ['여섯', 6],
  ['일곱', 7],
  ['여덟', 8],
  ['아홉', 9],
  ['열', 10],
]

/**
 * Trailing josa a marker may carry ("2개를 먹었어", "하나만"). Consumed into
 * the marker span so the next segment never starts with a stranded particle.
 * 씩 is deliberately NOT here: "하나씩/2개씩" is a share-out expression (one
 * EACH), not a quantity of the enumeration — the assignment layer reads it.
 */
const MARKER_JOSA = '(?:을|를|은|는|만)?'

const DIGIT_MARKER_RE = new RegExp(`(\\d+)\\s*(?:${COUNTERS})(?!씩)${MARKER_JOSA}`, 'g')
const NATIVE_MARKER_RE = new RegExp(
  `(?<![가-힣])(${NATIVE_NUM.map(([w]) => w).join('|')})\\s?(?:${COUNTERS})(?!씩)${MARKER_JOSA}`,
  'g',
)
/** Bare 하나 as "one of it" ("콜라 하나") — 하나도 ("not even one") and 하나씩
 *  (share-out) excluded, as is any other Hangul continuation that is not a
 *  particle or connector (하나둘, 하나님): the marker must END the word. */
const HANA_RE = new RegExp(
  `(?<![가-힣])하나(?=$|[^가-힣]|을|를|은|는|만|이랑|랑|하고|와|과|그리고)(?!씩|도)${MARKER_JOSA}`,
  'g',
)
/** "×3" or ASCII "x3"/"X3". */
const SYMBOL_MARKER_RE = /[×xX](\d+)/g

interface QuantityMarker {
  start: number
  end: number
  value: number
}

function findQuantityMarkers(input: string): QuantityMarker[] {
  const markers: QuantityMarker[] = []
  for (const m of input.matchAll(DIGIT_MARKER_RE)) {
    markers.push({ start: m.index, end: m.index + m[0].length, value: Number(m[1]) })
  }
  for (const m of input.matchAll(NATIVE_MARKER_RE)) {
    const native = NATIVE_NUM.find(([w]) => w === m[1])
    if (native) {
      markers.push({ start: m.index, end: m.index + m[0].length, value: native[1] })
    }
  }
  for (const m of input.matchAll(HANA_RE)) {
    markers.push({ start: m.index, end: m.index + m[0].length, value: 1 })
  }
  for (const m of input.matchAll(SYMBOL_MARKER_RE)) {
    markers.push({ start: m.index, end: m.index + m[0].length, value: Number(m[1]) })
  }
  // Overlaps (a native marker inside a digit one cannot happen, but 하나 vs
  // native 한 can share a start): keep the longest at each start.
  markers.sort((a, b) => a.start - b.start || b.end - a.end)
  const kept: QuantityMarker[] = []
  for (const m of markers) {
    const last = kept[kept.length - 1]
    if (last && m.start < last.end) continue
    kept.push(m)
  }
  return kept
}

// --- segmentation -----------------------------------------------------------

function overlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && a.end > b.start
}

/**
 * End of the enumeration region: the first sentence-ending punctuation that is
 * not a decimal point. Everything after it can only ASSIGN the items already
 * enumerated ("우동은 내가 다먹었고 …"), never add new ones — which is what
 * keeps the "3개" inside an assignment clause from minting a phantom item.
 */
function enumerationEnd(input: string): number {
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (ch === '\n' || ch === '!' || ch === '?') return i
    if (ch === '.' && !/\d/.test(input[i + 1] ?? '')) return i
  }
  return input.length
}

/** Split connectors that may follow a marker or amount span directly. */
const BOUND_CONNECTOR_RE = /^(이랑|랑|하고|와|과|그리고)/
/** Connectors safe to split on mid-text: two-syllable forms attached to a
 *  word and followed by whitespace. Bare 랑/와/과 are NOT split mid-text —
 *  랑그드샤/사과 would be mangled; they only split when bound to a marker or
 *  amount span (above), where no name syllable can be involved. */
const FREE_CONNECTOR_RE = /(이랑|하고|그리고)(?=\s)/g

interface Segment {
  start: number
  end: number
}

function splitSegments(
  region: string,
  markers: QuantityMarker[],
  candidates: AmountCandidate[],
): Segment[] {
  const cuts = new Set<number>([0, region.length])
  for (const m of region.matchAll(/[,、]/g)) {
    // A comma INSIDE a money span is that span's own artifact (a thousands
    // separator, or a trailing comma the bare-digit scanner swallowed —
    // "콜라 1500," scans as one span to index 8) — cutting there would strand
    // the amount outside every segment.
    if ([...markers, ...candidates].some((s) => m.index >= s.start && m.index < s.end)) continue
    cuts.add(m.index)
    cuts.add(m.index + 1)
  }
  for (const m of region.matchAll(FREE_CONNECTOR_RE)) {
    cuts.add(m.index + m[1].length)
  }
  for (const span of [...markers, ...candidates]) {
    const after = region.slice(span.end)
    const bound = BOUND_CONNECTOR_RE.exec(after)
    if (bound) cuts.add(span.end + bound[0].length)
  }
  const sorted = [...cuts].sort((a, b) => a - b)
  const segments: Segment[] = []
  for (let i = 0; i + 1 < sorted.length; i++) {
    const start = sorted[i]
    const end = sorted[i + 1]
    if (region.slice(start, end).trim() !== '') segments.push({ start, end })
  }
  return segments
}

/**
 * A segment holding 2+ price candidates missed a split the sentence never
 * wrote down ("700엔 콜라는 수탉이 마셨고 900엔 우동은 내가 먹음"). The
 * candidates themselves say where the seam is: a price-first chain (no text
 * before the first candidate) breaks BEFORE each later candidate, a
 * name-first chain ("커피 5000원 콜라 3000원") breaks AFTER each earlier one.
 */
function subdivide(region: string, segment: Segment, inSeg: AmountCandidate[]): Segment[] {
  if (inSeg.length < 2) return [segment]
  const priceFirst = region.slice(segment.start, inSeg[0].start).trim() === ''
  const cuts = priceFirst
    ? inSeg.slice(1).map((c) => c.start)
    : inSeg.slice(0, -1).map((c) => c.end)
  const bounds = [segment.start, ...cuts, segment.end]
  const out: Segment[] = []
  for (let i = 0; i + 1 < bounds.length; i++) {
    out.push({ start: bounds[i], end: bounds[i + 1] })
  }
  return out
}

// --- per-segment reading ----------------------------------------------------

/**
 * Leading/trailing scraps a name span may carry after span removal. Leading
 * strips only multi-syllable connectors and punctuation: a single leading
 * josa syllable can be the first syllable of a real name (을지로, 은어), and
 * bare 랑/와/과 can too (랑그드샤, 와규, 과일) — 와규 lost its 와 to exactly
 * this in review. Trailing keeps the single-syllable josa (콜라를 → 콜라)
 * plus 랑, whose word-final reading as a name syllable has no real food
 * precedent, but still not 와/과 (사과).
 */
const NAME_TRIM_RE =
  /^(?:\s|,|、|이랑|하고|그리고)+|(?:\s|,|、|이랑|랑|하고|그리고|을|를|은|는|도|만)+$/g

/**
 * Whole-token eat/buy/order verbs that trail an enumeration ("우동 3개
 * 먹었어") — trimmed from a would-be name, token by token from the right.
 * Matched against a WHOLE whitespace-separated token so 삼겹살 never loses
 * its 삼. 짜리 shows up when a digit-form unit price folded only its currency
 * ("1200엔" + "짜리").
 */
const TAIL_TOKEN_RE =
  /^(?:짜리|먹었[가-힣]*|먹음|먹자|먹고|마셨[가-힣]*|마심|마시고|드셨[가-힣]*|드심|시켰[가-힣]*|시킴|시키고|샀[가-힣]*|삼|사줬[가-힣]*|사옴|사왔[가-힣]*|주문[가-힣]*|결제[가-힣]*|계산[가-힣]*|냈[가-힣]*|냄|지불[가-힣]*|긁었[가-힣]*|했[가-힣]*|함)$/

/** Leading context tokens: a time/place adverbial ("점심에", "식당에서") is
 *  sentence scenery, not part of the item's name. Leading position only. */
const LEAD_CONTEXT_RE = /^[가-힣]+(?:에서|에)$/

function cleanName(raw: string): string {
  let name = raw
    // A digit-form unit price folds only its currency token, leaving the
    // 짜리 suffix at the start of the name span ("1200엔" + "짜리 맥주").
    .replace(/^\s*짜리\s*/, '')
    .replace(NAME_TRIM_RE, '')
    .replace(/\s+/g, ' ')
    .trim()
  for (;;) {
    const tokens = name.split(' ')
    if (tokens.length > 0 && TAIL_TOKEN_RE.test(tokens[tokens.length - 1])) {
      tokens.pop()
      name = tokens.join(' ').trim()
      continue
    }
    if (tokens.length > 1 && LEAD_CONTEXT_RE.test(tokens[0])) {
      tokens.shift()
      name = tokens.join(' ').trim()
      continue
    }
    return name
  }
}

/** Strips every member/actor span from `text` (they are assignment or payer
 *  information, never part of an item's name). */
function stripPeople(text: string, ctx: ParseContext): string {
  const hits = findPeopleWithActor(tokenize(text), text, ctx.members, ctx.actorId)
  let out = ''
  let at = 0
  for (const h of hits.sort((a, b) => a.start - b.start)) {
    out += text.slice(at, h.start)
    at = Math.max(at, h.end)
  }
  return out + text.slice(at)
}

// --- assignment reading -----------------------------------------------------

/** "하나씩/2개씩/나눠/각자/같이/반씩" — the line is shared out. */
const SHARE_RE = /씩|나눠|나누|각자|같이|반반/

/**
 * Something was consumed or bought — the signal that an all-unpriced
 * enumeration is an expense at all. Eat/drink/order stems plus the pay-verb
 * family's most common chat surfaces; substring match is safe for these
 * conjugating stems (먹, 마셨, …) the same way the funding words match.
 */
const CONSUME_SIGNAL_RE =
  /먹|마시|마셨|마심|드셨|드심|시켰|시킴|시켜|샀|사줬|사옴|사왔|(?<![가-힣])삼(?![가-힣])|결제|계산|냈|냄|지불|긁었|쏘|쐈|주문/

interface AssignmentReading {
  assigneeIds: string[]
  shareAll: boolean
}

function readAssignment(segment: string, ctx: ParseContext): AssignmentReading {
  const ids = [
    ...new Set(
      findPeopleWithActor(tokenize(segment), segment, ctx.members, ctx.actorId).map(
        (h) => h.memberId,
      ),
    ),
  ]
  if (ids.length > 0) return { assigneeIds: ids, shareAll: false }
  return { assigneeIds: [], shareAll: SHARE_RE.test(segment) }
}

/**
 * Splits an item's raw name at a topic particle when what follows actually
 * reads as an assignment ("커피는 수이수이가 마시고" → name 커피, assignees
 * 수이수이). Without a person or share word after the particle the split is
 * refused — "김치찌개는 국물이 진국" keeps its full text.
 */
function splitInlineAssignment(
  raw: string,
  ctx: ParseContext,
): { name: string; reading: AssignmentReading | null } {
  const m = /^(.+?)(?:은|는)(?:\s+|$)(.*)$/.exec(raw.trim())
  if (!m) return { name: raw, reading: null }
  const reading = readAssignment(m[2], ctx)
  if (reading.assigneeIds.length === 0 && !reading.shareAll) return { name: raw, reading: null }
  return { name: m[1], reading }
}

// --- entry point ------------------------------------------------------------

/**
 * Parses an item-enumerating sentence — any mix of priced and unpriced items,
 * price-first or name-first order, digit or native-numeral quantities — into
 * an exact item array, with per-item assignments when the sentence states
 * them ("우동은 내가 다먹었고 콜라는 수탉이, 우유롤은 하나씩").
 *
 * Pure: reuses `scanAmountCandidates` for every money span and
 * `parseAmountToMinor` to validate each priced line. Returns null rather than
 * guessing when nothing enumerates (no quantity marker and fewer than 2
 * priced lines), when a unit price fails validation, or when explicit
 * currencies disagree — a single confidently-wrong number is worse than
 * falling back to the single-amount path.
 *
 * Price semantics (controller ruling, 2026-08-14): a 짜리-marked price is
 * ALWAYS the unit price. A price-first line ("700엔 콜라 2개") keeps the
 * long-standing unit reading. A name-first line whose price trails the
 * quantity ("삼겹살 2인분 36000원") states the LINE total — divided back to a
 * unit price when it divides exactly, else kept whole at quantity 1.
 */
export function parseItems(input: string, ctx: ParseContext): ParsedItemList | null {
  const regionEnd = enumerationEnd(input)
  const region = input.slice(0, regionEnd)
  const tail = input.slice(regionEnd)

  const markers = findQuantityMarkers(region)
  const allCandidates = scanAmountCandidates(region).filter(
    (c) => !markers.some((m) => overlaps(c, m)),
  )
  // Decoy rule: one currency-marked mention makes every bare number a
  // non-price ("카톡 1234 보고 3만원 냈어" must never mint a 1234 item). A
  // sentence with ONLY bare numbers keeps them when there are at least two —
  // the legacy "콜라 1500, 우동 3000" reading.
  const marked = allCandidates.filter((c) => c.currency !== null)
  const usable = marked.length > 0 ? marked : allCandidates.length >= 2 ? allCandidates : []

  const explicit = new Set(marked.map((c) => c.currency as string))
  if (explicit.size > 1) return null
  const currency = explicit.size === 1 ? [...explicit][0] : ctx.defaultCurrency

  const segments = splitSegments(region, markers, usable).flatMap((seg) =>
    subdivide(
      region,
      seg,
      usable.filter((c) => c.start >= seg.start && c.end <= seg.end),
    ),
  )

  interface Draft {
    name: string
    unitAmount: string | null
    quantity: number
    reading: AssignmentReading | null
  }
  const drafts: Draft[] = []
  for (const seg of segments) {
    const cand = usable.find((c) => c.start >= seg.start && c.end <= seg.end) ?? null
    const marker = markers.find((m) => m.start >= seg.start && m.end <= seg.end) ?? null
    if (markers.filter((m) => m.start >= seg.start && m.end <= seg.end).length > 1) return null
    if (!cand && !marker) continue

    const quantity = marker ? marker.value : 1
    if (quantity < 1) return null

    let rawName: string
    let unitAmount: string | null = null
    if (cand) {
      const candText = region.slice(cand.start, cand.end)
      const afterPrice = region.slice(cand.end, marker && marker.start >= cand.end ? marker.start : seg.end)
      const unitExplicit = candText.endsWith('짜리') || region.slice(cand.end).startsWith('짜리')
      const afterHasName = cleanName(stripPeople(afterPrice, ctx)) !== ''
      // Which number the price IS depends on where it sits relative to the
      // quantity: BEFORE it ("700엔 콜라 2개", "30000엔 3개") states the unit
      // price; AFTER it ("삼겹살 2인분 36000원") states the line total. 짜리
      // says unit outright, wherever it sits.
      const priceBeforeQty = marker === null || cand.start < marker.start
      rawName = afterHasName
        ? afterPrice
        : region.slice(seg.start, Math.min(marker ? marker.start : seg.end, cand.start))
      unitAmount = cand.amount
      if (!unitExplicit && !priceBeforeQty) {
        if (!cand.amount.includes('.') && BigInt(cand.amount) % BigInt(quantity) === 0n) {
          unitAmount = (BigInt(cand.amount) / BigInt(quantity)).toString()
        } else {
          // Not exactly divisible: keep the stated total as one line.
          drafts.push({
            name: cleanName(stripPeople(rawName, ctx)),
            unitAmount,
            quantity: 1,
            reading: null,
          })
          continue
        }
      }
      if (parseAmountToMinor(unitAmount, currency) === null) return null
    } else {
      // Unpriced: the name sits before its quantity marker.
      rawName = region.slice(seg.start, marker!.start)
    }

    // Inline assignment first, on the UNstripped text — the people after the
    // topic particle ARE the assignment ("커피는 수이수이가 마시고"); stripping
    // them first would leave nothing for the split to read.
    const inline = splitInlineAssignment(rawName, ctx)
    const name = cleanName(stripPeople(inline.name, ctx))
    // A line priced by a currency-MARKED amount keeps an empty name —
    // dropping it would vanish money the sentence stated ("30000엔 3개랑
    // 700엔 콜라 2개"). A nameless draft whose price is a BARE number is the
    // opposite: nothing but digits vouches for it ("1e+21" scans as two bare
    // candidates), so it is skipped, as is an unpriced nameless draft.
    if (name === '' && (unitAmount === null || cand?.currency == null)) continue
    drafts.push({ name, unitAmount, quantity, reading: inline.reading })
  }

  if (drafts.length === 0) return null
  if (drafts.length === 1 && !markers.length) return null
  // An all-unpriced enumeration is only an EXPENSE when the sentence says
  // something happened to the items (먹었어/샀어/시켰어…). "표 2장 남았어"
  // enumerates a quantity too, and minting an item card for it would turn
  // small talk into a money question.
  if (drafts.every((d) => d.unitAmount === null) && !CONSUME_SIGNAL_RE.test(input)) {
    return null
  }

  // Assignment sentences after the enumeration: "<name>은/는 …" clauses.
  if (tail !== '') {
    const topics = drafts
      .map((d) => {
        for (const josa of ['은', '는']) {
          const idx = tail.indexOf(d.name + josa)
          if (idx !== -1) return { draft: d, start: idx, bodyStart: idx + d.name.length + josa.length }
        }
        return null
      })
      .filter((t): t is NonNullable<typeof t> => t !== null)
      .sort((a, b) => a.start - b.start)
    topics.forEach((topic, i) => {
      const bodyEnd = i + 1 < topics.length ? topics[i + 1].start : tail.length
      const reading = readAssignment(tail.slice(topic.bodyStart, bodyEnd), ctx)
      if (reading.assigneeIds.length > 0 || reading.shareAll) topic.draft.reading = reading
    })
  }

  return {
    items: drafts.map((d) => ({
      name: d.name,
      unitAmount: d.unitAmount,
      quantity: d.quantity,
      assigneeIds: d.reading?.assigneeIds ?? [],
      shareAll: d.reading?.shareAll ?? false,
    })),
    currency,
  }
}
