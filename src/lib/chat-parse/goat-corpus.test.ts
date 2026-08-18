import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { classify } from '../assistant/classify'
import type { AssistantContext, Classified } from '../assistant/types'
import { parse } from './index'

/**
 * The calibration corpora — the accuracy bar, asserted as N sentences rather
 * than claimed as a percentage.
 *
 * Three fixtures, three different jobs:
 *
 *  - `ko-sentences.json` / `en-sentences.json` — hand-authored expectations
 *    for real chat sentences, seeded from `.superpowers/research/*.md` and
 *    crossed systematically (amount forms x pay verbs x josa x split forms x
 *    noise), plus every sentence the branch's own review rounds argued about.
 *    Each row says what the WHOLE pipeline must produce: the intent from
 *    `classify()`, and, for an expense entry, the slots from `parse()`.
 *  - `fuzz-ko.json` / `fuzz-en.json` — 2,000 sentences from three open
 *    conversational corpora (see scripts/lang/fetch-fuzz-samples.mjs). Nobody
 *    wrote them for this parser and none of them is an expense, so they
 *    measure the thing the corpora above cannot: what the parser does with
 *    text it should leave alone.
 *
 * A row whose `known` field is set is a DOCUMENTED MISS: its `expect` records
 * what the parser does today, not what it should do, and `known` says why the
 * fix was judged out of scope. They are pinned rather than deleted so a future
 * change that fixes one FAILS here and has to update the row deliberately.
 */

const FIXTURES = path.join(__dirname, '../../../test-fixtures/goat')

// --- fixture shapes ---------------------------------------------------------

interface Expect {
  intent: string
  /** decimal string, or null when the sentence carries no amount */
  amount?: string | null
  currency?: string
  /** member NAME, or 'actor' for the person typing */
  payer?: string
  /** 'everyone', or member names ('actor' for the typer) */
  participants?: 'everyone' | string[]
  description?: string
  funding?: 'PAY_AS_YOU_GO' | 'NEW_CASH_WALLET'
  /** amountMentions — asserted only where a row is about multi-amount input */
  mentions?: number
  /** EDIT_EXPENSE only */
  action?: unknown
  reference?: unknown
  /** QUERY_* only */
  view?: string
  memberId?: string | null
  /** CONFIRM_MODIFY only — the slot shape §3.4 gives each `field` */
  field?: string | null
  slotAmount?: string | null
  op?: string
  split?: string
  memberIds?: string[]
  /** UNKNOWN only */
  hold?: boolean
  suggest?: string[]
}

interface Row {
  text: string
  expect: Expect
  /** `confirm` = read this row with a confirm card already on screen, which is
   *  the only state where a bare 응/취소/3만원으로 means anything. */
  card?: 'confirm'
  /** why this row is here / what it pins */
  note?: string
  /** set = pinned KNOWN MISS; the text explains why it is not fixed here */
  known?: string
}

interface Corpus {
  _members: Array<{ id: string; name: string }>
  _actorId: string
  _currency: string
  _locale: 'ko' | 'en'
  rows: Row[]
}

interface FuzzRow {
  text: string
  source: string
  allowAmount?: boolean
  allowAmountReason?: string
}

interface FuzzCorpus {
  rows: FuzzRow[]
}

function load<T>(file: string): T {
  return JSON.parse(readFileSync(path.join(FIXTURES, file), 'utf8')) as T
}

// --- corpus assertions ------------------------------------------------------

function contextOf(corpus: Corpus, card?: Row['card']): AssistantContext {
  const base: AssistantContext = {
    members: corpus._members,
    actorId: corpus._actorId,
    defaultCurrency: corpus._currency,
    locale: corpus._locale,
    openCard: null,
  }
  if (card !== 'confirm') return base
  // A plain, already-complete draft — the state a user is answering when they
  // type 응 / 아니 / 3만원으로 / just me and Sam.
  const draft = parse(corpus._locale === 'ko' ? '점심 30000원' : 'lunch $30', base)
  return { ...base, openCard: { kind: 'confirm', draft, amountMinor: 30000n } }
}

function idOf(corpus: Corpus, name: string): string {
  if (name === 'actor') return corpus._actorId
  const member = corpus._members.find((m) => m.name === name)
  if (!member) throw new Error(`corpus row names "${name}", who is not in _members`)
  return member.id
}

/** Reports every expectation this row got wrong, so one run shows the whole
 *  picture instead of the first mismatch. */
function check(corpus: Corpus, row: Row): string[] {
  const ctx = contextOf(corpus, row.card)
  const e = row.expect
  const fails: string[] = []
  const got: Classified = classify(row.text, ctx)
  if (got.intent !== e.intent) fails.push(`intent: want ${e.intent}, got ${got.intent}`)

  if ('view' in e && e.view !== undefined) {
    const view = 'view' in got ? got.view : undefined
    if (view !== e.view) fails.push(`view: want ${e.view}, got ${String(view)}`)
  }
  if ('memberId' in e) {
    const memberId = 'memberId' in got ? got.memberId : undefined
    const want = e.memberId === null || e.memberId === undefined ? e.memberId : idOf(corpus, e.memberId)
    if (memberId !== want) fails.push(`memberId: want ${String(want)}, got ${String(memberId)}`)
  }
  const slot = (key: string): unknown =>
    key in (got as Record<string, unknown>) ? (got as Record<string, unknown>)[key] : undefined
  for (const [key, want] of [
    ['field', e.field],
    ['op', e.op],
    ['split', e.split],
    ['hold', e.hold],
  ] as const) {
    if (want === undefined) continue
    if (slot(key) !== want) fails.push(`${key}: want ${String(want)}, got ${String(slot(key))}`)
  }
  if (e.slotAmount !== undefined && slot('amount') !== e.slotAmount) {
    fails.push(`slot amount: want ${String(e.slotAmount)}, got ${String(slot('amount'))}`)
  }
  if (e.memberIds !== undefined) {
    const want = e.memberIds.map((n) => idOf(corpus, n))
    if (JSON.stringify(slot('memberIds')) !== JSON.stringify(want)) {
      fails.push(`memberIds: want ${want.join(',')}, got ${JSON.stringify(slot('memberIds'))}`)
    }
  }
  if (e.suggest !== undefined) {
    if (JSON.stringify(slot('suggest')) !== JSON.stringify(e.suggest)) {
      fails.push(`suggest: want ${e.suggest.join(',')}, got ${JSON.stringify(slot('suggest'))}`)
    }
  }
  if (e.action !== undefined) {
    const action = 'action' in got ? got.action : undefined
    expectDeep(fails, 'action', action, e.action, corpus)
  }
  if (e.reference !== undefined) {
    const reference = 'reference' in got ? got.reference : undefined
    expectDeep(fails, 'reference', reference, e.reference, corpus)
  }

  const p = parse(row.text, ctx)
  if (e.amount !== undefined && p.amount !== e.amount) {
    fails.push(`amount: want ${String(e.amount)}, got ${String(p.amount)}`)
  }
  if (e.currency !== undefined && p.currency !== e.currency) {
    fails.push(`currency: want ${e.currency}, got ${p.currency}`)
  }
  if (e.payer !== undefined) {
    const want = idOf(corpus, e.payer)
    if (p.payerId !== want) fails.push(`payer: want ${e.payer} (${want}), got ${p.payerId}`)
  }
  if (e.participants !== undefined) {
    // Named participants are compared in the group's own member order, which
    // is the order `parse()` promises the UI.
    const named =
      e.participants === 'everyone'
        ? corpus._members.map((m) => m.id)
        : e.participants.map((name) => idOf(corpus, name))
    const want = corpus._members.map((m) => m.id).filter((id) => named.includes(id))
    if (JSON.stringify(p.participantIds) !== JSON.stringify(want)) {
      fails.push(`participants: want ${want.join(',')}, got ${p.participantIds.join(',')}`)
    }
  }
  if (e.description !== undefined && p.description !== e.description) {
    fails.push(`description: want "${e.description}", got "${p.description}"`)
  }
  if (e.funding !== undefined && p.funding !== e.funding) {
    fails.push(`funding: want ${e.funding}, got ${p.funding}`)
  }
  if (e.mentions !== undefined && p.amountMentions !== e.mentions) {
    fails.push(`amountMentions: want ${e.mentions}, got ${p.amountMentions}`)
  }
  return fails
}

function expectDeep(
  fails: string[],
  label: string,
  got: unknown,
  want: unknown,
  corpus: Corpus,
): void {
  // A member NAME in an expected action/reference is resolved to its id, so
  // fixtures stay readable ("민수", not "m-minsu").
  const resolved = JSON.parse(
    JSON.stringify(want).replace(/"memberId":"([^"]*)"/g, (_, name: string) => `"memberId":"${idOf(corpus, name)}"`),
  )
  if (JSON.stringify(got) !== JSON.stringify(resolved)) {
    fails.push(`${label}: want ${JSON.stringify(resolved)}, got ${JSON.stringify(got)}`)
  }
}

const CORPORA: Array<[string, string, number]> = [
  ['ko', 'ko-sentences.json', 250],
  ['en', 'en-sentences.json', 200],
]

describe.each(CORPORA)('%s sentence corpus', (_lang, file, minimum) => {
  const corpus = load<Corpus>(file)

  it(`holds at least ${minimum} rows, none duplicated`, () => {
    expect(corpus.rows.length).toBeGreaterThanOrEqual(minimum)
    // Keyed by CONTEXT too: the same sentence with and without a card open is
    // two different rows, and asserting both is the point (나도 껴줘 edits the
    // card in one and asks in the other).
    const texts = corpus.rows.map((r) => `${r.card ?? 'no-card'}::${r.text}`)
    expect(new Set(texts).size).toBe(texts.length)
  })

  it('every EXPENSE_ENTRY row states the full slot set', () => {
    for (const row of corpus.rows) {
      if (row.expect.intent !== 'EXPENSE_ENTRY') continue
      for (const slot of ['amount', 'currency', 'payer', 'participants'] as const) {
        expect(slot in row.expect, `${row.text} is missing expect.${slot}`).toBe(true)
      }
    }
  })

  it('every pinned known-miss carries a written justification', () => {
    for (const row of corpus.rows) {
      if (row.known === undefined) continue
      expect(row.known.length, row.text).toBeGreaterThan(40)
    }
  })

  it.each(corpus.rows.map((r): [string, Row] => [`${r.card ? '[card] ' : ''}${r.text}`, r]))('%s', (_text, row) => {
    expect(check(corpus, row)).toEqual([])
  })
})

// --- fuzz gates -------------------------------------------------------------

const FUZZ: Array<[string, string]> = [
  ['ko', 'fuzz-ko.json'],
  ['en', 'fuzz-en.json'],
]

describe.each(FUZZ)('%s fuzz corpus — negative controls', (lang, file) => {
  const corpus = load<Corpus>(lang === 'ko' ? 'ko-sentences.json' : 'en-sentences.json')
  const ctx = contextOf(corpus)
  const fuzz = load<FuzzCorpus>(file)

  it('holds 1,000 sampled rows', () => {
    expect(fuzz.rows.length).toBe(1000)
  })

  it('every allowAmount flag carries a review note', () => {
    for (const row of fuzz.rows) {
      if (!row.allowAmount) continue
      expect(row.allowAmountReason?.length ?? 0, row.text).toBeGreaterThan(40)
    }
  })

  it('parse() finds no amount, and never throws', () => {
    const found: string[] = []
    for (const row of fuzz.rows) {
      const amount = parse(row.text, ctx).amount
      if (amount !== null && !row.allowAmount) found.push(`${amount} <- ${row.text}`)
    }
    expect(found).toEqual([])
  })

  it('classify() never books an expense or edits one, and never throws', () => {
    const wrong: string[] = []
    for (const row of fuzz.rows) {
      const got = classify(row.text, ctx)
      if (got.intent === 'EDIT_EXPENSE') {
        wrong.push(`EDIT_EXPENSE <- ${row.text}`)
      } else if (got.intent === 'EXPENSE_ENTRY' && got.parsed.amount !== null && !row.allowAmount) {
        wrong.push(`EXPENSE_ENTRY ${got.parsed.amount} <- ${row.text}`)
      }
    }
    expect(wrong).toEqual([])
  })
})
