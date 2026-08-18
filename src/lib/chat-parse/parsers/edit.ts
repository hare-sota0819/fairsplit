import type { ParseHit } from '../engine/hits'
import type { Token } from '../engine/tokens'
import type { AmountValue } from './amount'
import type { PersonHit } from './people'

/**
 * Edit-action parser: what a context command ASKS FOR on an already-saved
 * expense ("아까 그 술값에 민수도 껴줘" → add 민수).
 *
 * It owns no numbers and no names of its own. The amount comes from
 * `findAmounts` and the member from `findPeople`, both passed in — the house
 * rule is that a second number path is a second chance to be wrong
 * (docs/SOLVED.md's whole readKoreanNumber series), and it applies to names
 * just as much. This file's only job is to find the ACTION word, decide which
 * of the four actions it names, and bind it to the right slot value.
 *
 * The action word must be a REQUEST, not a report. `취소했어` ("it got
 * cancelled") and `민수 빼고 다들 정산했어?` both contain an action stem, and
 * neither is an instruction — so the stem alone never fires: a Korean stem is
 * held to a request/imperative continuation (`EDIT_REQUEST_ENDING`, or the
 * 하-family request forms for a verbal noun), exactly the way
 * `ko/lexicon-verbs.ts` holds a pay stem to `PAY_VERB_ENDING`/
 * `PAY_VERBALIZER`. Enumerating whole inflected surfaces instead would be the
 * mistake this branch has logged over and over.
 */

export type EditAction =
  | { kind: 'addParticipant'; memberId: string }
  | { kind: 'removeParticipant'; memberId: string }
  /**
   * `amount` is the decimal string `parseAmountToMinor` expects, and
   * `currency` is the ISO 4217 code the SENTENCE resolved to — the group's
   * default when the text named none, `USD` for "30달러로 바꿔줘". Carrying it
   * is not optional: `findAmounts` already knows the currency, and an applier
   * that assumes the settlement currency would silently book 30 USD as 30 KRW.
   */
  | { kind: 'changeAmount'; amount: string; currency: string }
  | { kind: 'cancel' }

/** What an action word asks for, before it is bound to a member/amount. */
type EditKind = 'add' | 'remove' | 'changeAmount' | 'cancel'

interface KoActionEntry {
  /** Surface stem, matched at any position INSIDE a hangul token. */
  stem: string
  kind: EditKind
  /**
   * `verbal-noun` — a noun that only asks for anything once the 하-family
   * verbalizes it into a REQUEST (취소해줘/취소하자/취소할래). Its own past
   * form (취소했어) is a report, not a request, and is rejected because 했 is
   * deliberately absent from `KO_VERBAL_REQUEST`.
   *
   * `verb-form` — already a verb stem (껴/빼/지워/바꿔); it takes a request
   * ending directly, or stands alone as a bare imperative ("민수 빼").
   */
  form: 'verbal-noun' | 'verb-form'
}

/**
 * The Korean action vocabulary. Stems only — 껴줘/껴주세요/껴줄래 are the one
 * stem 껴 plus `KO_REQUEST_ENDING`.
 *
 * Ordered longest-first so a longer stem wins at the same position (the
 * invariant, asserted in the tests, not a coincidence of this content).
 */
const KO_ACTIONS: readonly KoActionEntry[] = [
  { stem: '끼워', kind: 'add', form: 'verb-form' },
  { stem: '넣어', kind: 'add', form: 'verb-form' },
  { stem: '추가', kind: 'add', form: 'verbal-noun' },
  { stem: '포함', kind: 'add', form: 'verbal-noun' },
  { stem: '제외', kind: 'remove', form: 'verbal-noun' },
  { stem: '바꿔', kind: 'changeAmount', form: 'verb-form' },
  { stem: '고쳐', kind: 'changeAmount', form: 'verb-form' },
  { stem: '변경', kind: 'changeAmount', form: 'verbal-noun' },
  { stem: '수정', kind: 'changeAmount', form: 'verbal-noun' },
  { stem: '취소', kind: 'cancel', form: 'verbal-noun' },
  { stem: '삭제', kind: 'cancel', form: 'verbal-noun' },
  { stem: '지워', kind: 'cancel', form: 'verb-form' },
  { stem: '없애', kind: 'cancel', form: 'verb-form' },
  { stem: '껴', kind: 'add', form: 'verb-form' },
  { stem: '빼', kind: 'remove', form: 'verb-form' },
]

/**
 * Endings that turn an already-verbal stem into a request: the 주-family
 * (줘/주세요/줄래/주라), the propositive/imperative 자/라, and the polite 요.
 *
 * Each entry is the ending's FIRST syllable, so it covers everything built on
 * it (`주` → 주세요/주라/주시죠, `줄` → 줄래/줄 수). Deliberately absent:
 * 고 (빼고 — "excluding", the connective §2.4's fragment gate already has to
 * fight), 면 (빼면), 서, 졌 (지워졌어), and every past-tense form. Those are
 * what make a report a report.
 */
const KO_REQUEST_ENDING = ['줘', '주', '줄', '줍', '자', '라', '요', '시']

/**
 * The 하-family forms that make a verbal noun a REQUEST: 취소해/취소해줘/
 * 취소하자/취소할래/취소합시다. `했`/`함`/`한` are absent on purpose — 취소했어
 * reports a cancellation that already happened, and 취소한 is attributive.
 */
const KO_VERBAL_REQUEST = ['해', '하', '할', '합']

function startsWithAny(text: string, prefixes: readonly string[]): boolean {
  return prefixes.some((p) => text.startsWith(p))
}

/**
 * Whether `rest` (whatever is glued after the stem inside the SAME token)
 * leaves the stem asking for something. An empty rest is a bare imperative /
 * bare noun request ("민수 빼", "그거 취소") and counts for both classes.
 */
function isRequestContinuation(entry: KoActionEntry, rest: string): boolean {
  if (rest === '') return true
  if (entry.form === 'verbal-noun') return startsWithAny(rest, KO_VERBAL_REQUEST)
  return startsWithAny(rest, KO_REQUEST_ENDING)
}

interface EnActionEntry {
  /** Space-separated words, matched as consecutive latin tokens. */
  phrase: string
  kind: EditKind
}

/**
 * The English action vocabulary, matched as WHOLE tokens (the tokenizer
 * already grouped the maximal latin run, so `add` never fires inside
 * `address`). English has no report/request morphology to gate on — an
 * English speaker writes "I cancelled it", where the pronoun and tense sit in
 * separate tokens, so there is nothing to strip; the reference-word
 * requirement in `classify()` is what keeps a past-tense report out.
 */
const EN_ACTIONS: readonly EnActionEntry[] = [
  { phrase: 'add', kind: 'add' },
  { phrase: 'include', kind: 'add' },
  { phrase: 'remove', kind: 'remove' },
  { phrase: 'exclude', kind: 'remove' },
  { phrase: 'drop', kind: 'remove' },
  { phrase: 'change', kind: 'changeAmount' },
  { phrase: 'make', kind: 'changeAmount' },
  { phrase: 'update', kind: 'changeAmount' },
  { phrase: 'set', kind: 'changeAmount' },
  { phrase: 'cancel', kind: 'cancel' },
  { phrase: 'delete', kind: 'cancel' },
]

/**
 * English frames whose two halves sit APART, with the object between them
 * ("take Jo out of that") — the same shape `classify()`'s
 * `MODIFY_DISCONTINUOUS_FRAMES` exists for. Written as a frame rather than a
 * phrase because the words are not adjacent and never will be: English puts
 * the object inside the verb-particle pair.
 *
 * The marker's position is the SUFFIX's, so the name binding measures from
 * `out` — which is where the object it applies to was just named.
 */
const EN_FRAMES: ReadonlyArray<{ prefix: string; suffix: string; kind: EditKind }> = [
  { prefix: 'take', suffix: 'out', kind: 'remove' },
]

/**
 * Words naming THE EXPENSE ITSELF as the object of a removal — the difference
 * between "remove Minsu" (a participant edit) and "remove that expense" (a
 * cancellation). A remove-family word with no member bound to it only reads as
 * a cancel when one of these is in the sentence; with nothing naming an
 * object, the request stays ambiguous and this parser returns null rather than
 * guess (the house rule: never a confidently wrong edit).
 */
const KO_EXPENSE_OBJECT = ['그거', '그것', '그건', '그걸', '이거', '지출', '내역']
const EN_EXPENSE_OBJECT = ['expense', 'it', 'that', 'this', 'one']

// --- marker scan ------------------------------------------------------------

interface ActionMarker {
  kind: EditKind
  start: number
  end: number
}

/** Matches `words` as consecutive latin tokens from `i`, allowing exactly the
 *  whitespace between them; returns the LAST token index matched, or null. */
function matchWords(tokens: Token[], i: number, words: string[]): number | null {
  let j = i
  for (let w = 0; w < words.length; w++) {
    if (w > 0) {
      if (tokens[j]?.kind !== 'space') return null
      j += 1
    }
    const token = tokens[j]
    if (!token || token.kind !== 'latin' || token.text.toLowerCase() !== words[w]) return null
    j += 1
  }
  return j - 1
}

const EN_PHRASES = EN_ACTIONS.map((entry) => ({
  words: entry.phrase.split(' '),
  entry,
})).sort((a, b) => b.words.length - a.words.length)

/** Longest stem first, derived rather than trusted to the table's hand
 *  ordering: at the same position a longer stem must always win. */
const KO_BY_LENGTH: readonly KoActionEntry[] = [...KO_ACTIONS].sort(
  (a, b) => b.stem.length - a.stem.length,
)

/** The first action stem inside one hangul token, with its request check. */
function koMarkerIn(token: Token): ActionMarker | null {
  for (let k = 0; k < token.text.length; k++) {
    for (const entry of KO_BY_LENGTH) {
      if (!token.text.startsWith(entry.stem, k)) continue
      const rest = token.text.slice(k + entry.stem.length)
      if (!isRequestContinuation(entry, rest)) continue
      return { kind: entry.kind, start: token.start + k, end: token.end }
    }
  }
  return null
}

/** Every action word in the sentence, left to right. */
function findActionMarkers(tokens: Token[]): ActionMarker[] {
  const markers: ActionMarker[] = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token.kind === 'hangul') {
      const marker = koMarkerIn(token)
      if (marker) markers.push(marker)
      continue
    }
    if (token.kind !== 'latin') continue
    for (const { words, entry } of EN_PHRASES) {
      const last = matchWords(tokens, i, words)
      if (last === null) continue
      markers.push({ kind: entry.kind, start: token.start, end: tokens[last].end })
      i = last
      break
    }
  }
  markers.push(...findFrameMarkers(tokens))
  return markers.sort((a, b) => a.start - b.start)
}

/** The discontinuous English frames — a prefix token, then its suffix token
 *  somewhere after it in the same sentence. */
function findFrameMarkers(tokens: Token[]): ActionMarker[] {
  const latin = tokens.filter((token) => token.kind === 'latin')
  const markers: ActionMarker[] = []
  for (const frame of EN_FRAMES) {
    const prefix = latin.find((token) => token.text.toLowerCase() === frame.prefix)
    if (!prefix) continue
    const suffix = latin.find(
      (token) => token.start > prefix.end && token.text.toLowerCase() === frame.suffix,
    )
    if (!suffix) continue
    markers.push({ kind: frame.kind, start: suffix.start, end: suffix.end })
  }
  return markers
}

/**
 * Whether this token reads as an edit-action request. Exported for
 * `parsers/reference.ts`'s keyword guard, so "아까 취소해줘" does not take
 * 취소해줘 for the noun the reference is about — the vocabulary is written
 * down once, here, and read there.
 */
export function isEditActionWord(token: Token): boolean {
  if (token.kind === 'hangul') return koMarkerIn(token) !== null
  if (token.kind !== 'latin') return false
  const lowered = token.text.toLowerCase()
  return EN_ACTIONS.some((entry) => entry.phrase.split(' ')[0] === lowered)
}

// --- binding ----------------------------------------------------------------

/** The member mention nearest the action word (`민수 포함 유나 빼줘` → 빼줘
 *  wins the marker race below, and 유나 is the name nearest to it). */
function nearestPerson(people: readonly PersonHit[], at: number): PersonHit | null {
  let best: PersonHit | null = null
  let bestDistance = Infinity
  for (const person of people) {
    const distance = person.start < at ? at - person.end : person.start - at
    if (distance < bestDistance) {
      best = person
      bestDistance = distance
    }
  }
  return best
}

/**
 * The amount a `changeAmount` request carries — the DECIMAL STRING
 * `parseAmountToMinor` expects plus the currency that came with it, exactly as
 * `findAmounts` reported them (never a number, never rounded here: the repo's
 * money rule). A marked amount wins over a bare one: "3만원으로 바꿔줘" carries
 * its own evidence, and a bare count in the same sentence is not what the user
 * is changing the total to.
 */
function pickAmount(
  amounts: ReadonlyArray<ParseHit<'amount', AmountValue>>,
): AmountValue | null {
  const marked = amounts.find((hit) => hit.value.marked)
  return (marked ?? amounts[0])?.value ?? null
}

function hasExpenseObject(tokens: Token[], input: string): boolean {
  if (KO_EXPENSE_OBJECT.some((word) => input.includes(word))) return true
  return tokens.some(
    (token) =>
      token.kind === 'latin' && EN_EXPENSE_OBJECT.includes(token.text.toLowerCase()),
  )
}

function bind(
  marker: ActionMarker,
  tokens: Token[],
  input: string,
  people: readonly PersonHit[],
  amounts: ReadonlyArray<ParseHit<'amount', AmountValue>>,
): EditAction | null {
  switch (marker.kind) {
    case 'cancel':
      return { kind: 'cancel' }
    case 'changeAmount': {
      const picked = pickAmount(amounts)
      if (picked === null) return null
      return {
        kind: 'changeAmount',
        amount: picked.amount,
        currency: picked.currency,
      }
    }
    case 'add': {
      const person = nearestPerson(people, marker.start)
      return person === null ? null : { kind: 'addParticipant', memberId: person.memberId }
    }
    case 'remove': {
      const person = nearestPerson(people, marker.start)
      if (person !== null) {
        return { kind: 'removeParticipant', memberId: person.memberId }
      }
      // "remove that expense" / "그거 지워줘" — the object is the EXPENSE, so
      // the request is a cancellation. Without an object word there is
      // nothing to remove anyone from, and guessing between "cancel it" and
      // "take me out of it" is exactly the confidently-wrong edit this layer
      // exists to refuse.
      return hasExpenseObject(tokens, input) ? { kind: 'cancel' } : null
    }
  }
}

/**
 * The edit this sentence asks for, or null when it asks for none.
 *
 * Several action words in one sentence resolve LAST-FIRST (`민수 빼고 3만원으로
 * 바꿔줘` is a change, not a removal) — the same last-wins rule §2.6 gives
 * `classify()`'s CONFIRM_MODIFY steps. An action that cannot be bound (an add
 * with no name, a change with no amount) does not stop the scan: the next
 * candidate leftwards is tried, and null only comes back when NONE of them
 * binds.
 */
export function findEditAction(
  tokens: Token[],
  input: string,
  people: PersonHit[],
  amounts: Array<ParseHit<'amount', AmountValue>>,
): EditAction | null {
  const markers = findActionMarkers(tokens)
  for (let i = markers.length - 1; i >= 0; i--) {
    const action = bind(markers[i], tokens, input, people, amounts)
    if (action) return action
  }
  return null
}
