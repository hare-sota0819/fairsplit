import type { ParseHit } from '../engine/hits'
import type { Token } from '../engine/tokens'
import { jongseongOf } from '../ko/inflect'
import { josaAgreesWithStem } from '../ko/josa'
import { JOSA } from '../ko/lexicon-josa'
import type { ChatMember } from '../types'

export interface PersonHit {
  memberId: string
  start: number
  end: number
  role: 'subject' | 'with' | 'plain'
  honorific: boolean
}

const HONORIFIC = new Set(['님', '씨'])

/**
 * The typer referring to themselves. One vocabulary, two readers: `people.ts`'s
 * `resolvePayer` asks whether a self-mention precedes the pay verb (payer
 * policy), and `findActorMentions` below reports every occurrence as a SPAN so
 * the pipeline can consume it out of the description — "내가" in "김치찌개
 * 3만원 내가 냈고" is text the parse read, not part of what was bought.
 *
 * Kept as a small regex rather than a token walk because that is what it is:
 * a closed list of fixed surfaces, in two scripts, with no grammar behind it.
 * `\bI\b` needs the boundary (English pronoun).
 *
 * Forms starting with 나/저 that can also END a longer word carry a
 * (?<![가-힣]) guard: a member named 유나 makes 유나는/유나도/유나랑 ordinary
 * sentences, and without the guard the trailing 나는/나도/나랑 reads as a
 * self-mention — harmless in the pipeline (the person hit wins the overlap in
 * refine) but WRONG in `resolvePayer`, whose bare `.exec` has no overlap
 * filter: the false actorPos sat AFTER the real subject and silently pushed
 * the payer back to the actor ("유나는 커피 5000원 냈어" credited the typer,
 * live bug, 2026-08-14). 내가/제가 keep no guard: no Korean word ends in
 * 내/제 followed by 가 in a name-like way, and the unguarded form still
 * matches glued 붙여쓰기 ("어제내가냈어").
 *
 * The companion forms 나랑/저랑/나하고/저하고 (added 2026-08-14, live-app fix
 * round) are the typer as a COMPANION — "콜라 하나를 나랑 수이수이가 먹음"
 * left a dangling 나랑 in the description before this.
 */
export const ACTOR_WORD =
  /내가|제가|(?<![가-힣])(?:나는|저는|나도|나랑|저랑|나하고|저하고)|\bI\b/i
const ACTOR_WORD_G = new RegExp(ACTOR_WORD.source, 'gi')

export type ActorHit = ParseHit<'actor', { word: string }>

/** Every self-mention in `input`, left to right, as exact spans. */
export function findActorMentions(input: string): ActorHit[] {
  return [...input.matchAll(ACTOR_WORD_G)].map((m) => ({
    type: 'actor' as const,
    start: m.index,
    end: m.index + m[0].length,
    value: { word: m[0] },
    confidence: 1,
  }))
}

// Companion/dative particles: a name tagged with one of these is never the
// clause's subject ("민수랑 냈어" = paid WITH Minsu, not that Minsu paid).
const WITH_JOSA = new Set([
  '이랑',
  '랑',
  '하고',
  '과',
  '와',
  '한테',
  '에게',
  '한테서',
  '에게서',
])
// Subject/topic markers.
const SUBJECT_JOSA = new Set(['이', '가', '은', '는', '께서'])

/**
 * English companion prepositions — the structural equivalent of `WITH_JOSA`,
 * on the other side of the name because English marks the relation BEFORE the
 * noun instead of after it.
 *
 * "lunch with Sam" and "민수랑 저녁" say the same thing with the same two
 * pieces; the only difference is word order, so they get the same treatment:
 * the marker is part of the person's span (role `with`), which is what makes
 * the description come out as "lunch" in both languages rather than leaving a
 * stranded "with" behind.
 *
 * Only a marker IMMEDIATELY before the name binds (one run of whitespace, no
 * other word between), so "with" governing something else — "paid with cash,
 * Sam owes me" — never reaches across to a name it does not introduce.
 *
 * `and` is deliberately HELD BACK pending a ruling (T8 fix round 1). It is a
 * coordinating conjunction, not a preposition — English says "I went WITH
 * Sam", never "I went AND Sam" — so in "me and Sam" the `and` joins two
 * PARTICIPANTS rather than marking one as a companion of the verb. Binding it
 * into the name's span also breaks a real corpus row: `classify.ts`'s §2.4
 * fragment gate removes member spans BEFORE it strips its own MODIFY
 * patterns, so a span that swallows the `and` of "just me and" leaves that
 * pattern unmatchable and "just me and Sam" stops reading as a participants
 * edit. Adding `and` therefore needs the fragment gate taught about bound
 * prepositions first; it is not a one-line lexicon change.
 */
const WITH_PREPOSITION = new Set(['with'])

/**
 * Words that may legally follow a name(+honorific)(+SINGLE-SYLLABLE josa)
 * split GLUED to it (no space) inside the same token without invalidating
 * the split — "민수랑같이" must still bind 민수 even though "같이" rides
 * along in the same hangul run. Deliberately minimal: only what's needed so
 * a glued continuation isn't mistaken for more of the name itself (see the
 * 사랑해 case below, which has no josa attachment at all and is rejected
 * before this list is even consulted).
 */
const ACCEPTED_CONTINUATION = ['같이']

function roleFor(josa: string): PersonHit['role'] {
  if (WITH_JOSA.has(josa)) return 'with'
  if (SUBJECT_JOSA.has(josa)) return 'subject'
  return 'plain'
}

/**
 * Whether `leftover` (whatever's glued after name+honorific+josa, still
 * inside the SAME token) invalidates the split. A 2+-syllable josa (한테/
 * 에게/이랑/하고/한테서/…) is unambiguous enough that it never itself starts
 * an unrelated Korean word — F-1 붙여쓰기 ("민수한테얼마줘야돼", no spaces
 * at all) is a real continuation of the SENTENCE, not a trap, so anything
 * may follow it. A single-syllable josa (이/가/을/를/랑/…) IS exactly the
 * ambiguous case (같은 음절이 이름의 일부일 수도 있음), so glued content
 * after one only counts as a real continuation when it's a recognized word
 * (currently just 같이). NO josa at all (matchedJosa === null, a bare name)
 * gets NO continuation rescue — controller ruling: 같이 only legitimizes a
 * glued continuation after a DETACHED josa ("민수랑같이" keeps binding),
 * never directly after the bare name ("사랑같이" does not bind 사랑 — and
 * semantically, "민수같이" means "like Minsu," not a with-relation, so
 * rejecting the no-josa case is correct in general, not just for the 사랑
 * collision).
 */
function isAcceptedLeftover(leftover: string, matchedJosa: string | null): boolean {
  if (leftover === '') return true
  if (matchedJosa === null) return false
  if (matchedJosa.length >= 2) return true
  return ACCEPTED_CONTINUATION.some((w) => leftover.startsWith(w))
}

/**
 * The name suffix 이 (접미사) — the syllable Korean adds to a CONSONANT-FINAL
 * given name before its particle: 지훈이가, 서연이한테, 민혁이랑. It attaches
 * to the name, not to the sentence, which is why it is consumed as part of the
 * person's span rather than looked up as a particle.
 *
 * Only consonant-final names take it (민수 is never 민수이가), and a name
 * already carrying an honorific does not (지훈님이가 is not Korean) — those
 * two conditions ARE the rule, so they are asked here rather than enumerated
 * per name.
 */
const NAME_SUFFIX_I = '이'

function takesNameSuffixI(name: string, honorific: boolean): boolean {
  if (honorific) return false
  return jongseongOf(name[name.length - 1]) !== ''
}

/** The first josa in the mined inventory that fits at the start of `rest`
 *  after a stem ending in `stemLastChar`; null when none does. */
function firstJosa(rest: string, stemLastChar: string): string | null {
  for (const josa of JOSA) {
    if (rest.startsWith(josa) && josaAgreesWithStem(stemLastChar, josa)) return josa
  }
  return null
}

interface Candidate {
  memberId: string
  start: number
  end: number
  role: PersonHit['role']
  honorific: boolean
}

/** Tries `m`'s name as a match at `token`'s start; null if it doesn't fit. */
function matchAt(token: Token, m: ChatMember): Candidate | null {
  const name = m.name
  if (name.length === 0) return null
  const folded = name.toLowerCase()
  if (token.text.length < name.length) return null
  if (token.text.slice(0, name.length).toLowerCase() !== folded) return null

  const afterName = token.text.slice(name.length)

  if (token.kind === 'latin') {
    // No josa grammar for latin names — only an exact whole-token match
    // counts.
    if (afterName !== '') return null
    return {
      memberId: m.id,
      start: token.start,
      end: token.end,
      role: 'plain',
      honorific: false,
    }
  }

  // hangul: optionally consume an honorific, then optionally a josa.
  let honorific = false
  let rest = afterName
  const honorificChar = rest[0]
  if (honorificChar !== undefined && HONORIFIC.has(honorificChar)) {
    honorific = true
    rest = rest.slice(1)
  }
  const stemLastChar = honorific ? honorificChar! : name[name.length - 1]

  const first = firstJosa(rest, stemLastChar)
  const attempts: Array<{ suffix: number; josa: string | null; stem: string }> = [
    { suffix: 0, josa: first, stem: stemLastChar },
  ]
  // 접미사 이: a consonant-final Korean given name takes an extra 이 before
  // its particle in ordinary speech — 지훈이가, 서연이한테, 민혁이랑. The
  // syllable is part of how the NAME is said, not a particle of its own, so
  // without this the josa search sees 지훈 + 이 and is left holding a stray
  // 가, and the whole hit is rejected (which is how "지훈이가 계산했어" used
  // to credit the actor instead of 지훈). Tried only as a FALLBACK, after the
  // plain reading: "지훈이" on its own is 지훈 + the subject 이, and reading it
  // as a suffix instead would throw that grammatical role away.
  if (takesNameSuffixI(name, honorific) && rest.startsWith(NAME_SUFFIX_I)) {
    const afterSuffix = rest.slice(NAME_SUFFIX_I.length)
    attempts.push({
      suffix: NAME_SUFFIX_I.length,
      josa: firstJosa(afterSuffix, NAME_SUFFIX_I),
      stem: NAME_SUFFIX_I,
    })
  }

  for (const attempt of attempts) {
    const consumedLen =
      name.length + (honorific ? 1 : 0) + attempt.suffix + (attempt.josa?.length ?? 0)
    const leftover = token.text.slice(consumedLen)
    if (!isAcceptedLeftover(leftover, attempt.josa)) continue
    return {
      memberId: m.id,
      start: token.start,
      end: token.start + consumedLen,
      role: attempt.josa ? roleFor(attempt.josa) : 'plain',
      honorific,
    }
  }
  return null
}

/**
 * Extends `candidate` backwards over an English companion preposition sitting
 * immediately before it ("with Sam"), and marks the relation.
 *
 * Only reaches back across a single whitespace token, and only for a `plain`
 * latin match — a Korean name already carries its own relation in the josa it
 * consumed, and overwriting that with a preposition's would be reading the
 * sentence twice.
 */
function absorbPreposition(tokens: Token[], i: number, candidate: Candidate): Candidate {
  if (candidate.role !== 'plain') return candidate
  if (tokens[i].kind !== 'latin') return candidate
  if (tokens[i - 1]?.kind !== 'space') return candidate
  const marker = tokens[i - 2]
  if (!marker || marker.kind !== 'latin') return candidate
  if (!WITH_PREPOSITION.has(marker.text.toLowerCase())) return candidate
  return { ...candidate, start: marker.start, role: 'with' }
}

/**
 * `findPeople`, plus the typer's OWN first-person mentions bound to
 * `actorId` — "나도 껴줘" names a participant just as surely as "민수도 껴줘"
 * does, it just names them with a pronoun.
 *
 * A self-mention INSIDE a member's span is dropped: "유나도 껴줘" contains
 * 나도 starting at the second syllable of 유나, and the person hit that
 * already claimed 유나+도 is the right reading. (The same substring collision
 * `classify.ts`'s firstPerson gate documents.)
 *
 * Kept separate from `findPeople` rather than folded into it: the expense
 * parser's participant logic adds the actor itself, by policy, whether or not
 * the sentence mentions them — only the EDIT/MODIFY layers, where "who does
 * this operation name?" is the actual question, need the actor as a HIT.
 */
export function findPeopleWithActor(
  tokens: Token[],
  input: string,
  members: ChatMember[],
  actorId: string,
): PersonHit[] {
  const people = findPeople(tokens, input, members)
  const self = findActorMentions(input)
    .filter((a) => !people.some((p) => a.start < p.end && a.end > p.start))
    .map(
      (a): PersonHit => ({
        memberId: actorId,
        start: a.start,
        end: a.end,
        role: 'plain',
        honorific: false,
      }),
    )
  return [...people, ...self].sort((a, b) => a.start - b.start)
}

/**
 * Walks tokens; for each hangul token, tries member names against every
 * morphologically legal (stem, josa) split, INCLUDING glued forms
 * ("민수랑같이" → 민수+랑+같이, name+josa+following word inside ONE token).
 * Honorifics 님/씨 between name and josa are consumed. Latin tokens match
 * by exact (case-folded) equality — a token is already the maximal run of
 * same-kind characters, so "sam" inside "samsung" never even reaches the
 * comparison (the token IS "samsung", not "sam"). Case-folding is done via
 * toLowerCase on token/name text directly (not by folding the whole input
 * and re-deriving offsets) so folded/original offsets can never drift
 * apart (backlog #7) — every span is built from the token's own start/end
 * arithmetic, never from an index into a separately-folded string.
 *
 * Per token, the LONGEST member name that validly matches always wins the
 * span — this is decided BEFORE identity dedup runs, so a token already
 * claimed by a longer name is never re-tried against a shorter one (members
 * [유나, 유], "유나 유나": the second token's winner is still 유나, not 유
 * with a spuriously detached 나 josa, even though 유나 is already `seen`).
 * Dedup itself keys on (memberId, role): the SAME person mentioned again
 * with a DIFFERENT grammatical role ("민수랑 먹었는데 민수가 냈어" — with,
 * then subject) is real new information for payer resolution and stays;
 * only a repeat of the identical (person, role) collapses to one.
 */
export function findPeople(
  tokens: Token[],
  // Kept for interface parity with the brief (and so callers don't need to
  // pre-slice) — every span here is built from the tokens' own start/end
  // arithmetic, so `input` itself is never re-scanned.
  _input: string,
  members: ChatMember[],
): PersonHit[] {
  const nameCounts = new Map<string, number>()
  for (const m of members) {
    const key = m.name.toLowerCase()
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1)
  }
  // Longest name first so a longer member name wins a prefix collision
  // (민수 over 민) at the same token.
  const byLength = [...members].sort((a, b) => b.name.length - a.name.length)

  const hits: PersonHit[] = []
  const seen = new Set<string>()

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token.kind !== 'hangul' && token.kind !== 'latin') continue

    let winner: Candidate | null = null
    for (const m of byLength) {
      if ((nameCounts.get(m.name.toLowerCase()) ?? 0) > 1) continue
      winner = matchAt(token, m)
      if (winner) break
    }
    if (!winner) continue

    winner = absorbPreposition(tokens, i, winner)

    const key = `${winner.memberId}:${winner.role}`
    if (seen.has(key)) continue
    seen.add(key)
    hits.push(winner)
  }

  return hits.sort((a, b) => a.start - b.start)
}
