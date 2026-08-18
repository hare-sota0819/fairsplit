import { fuseEnding, jongseongOf, stripInfinitive, stripPast, unfuseEnding } from './inflect'
import { ADJ_STEMS_KO, VERB_STEMS_KO } from './lexicon-verbs'

/**
 * Attributive / clause-connective form recognizer.
 *
 * Answers the one question payer resolution needs about a token sitting
 * between a candidate subject and the pay verb: is this an EMBEDDED CLAUSE's
 * verb (a boundary — the subject before it belongs to that clause, not to the
 * pay verb), an ADJECTIVE modifying the next noun (not a boundary at all), or
 * something this parser knows nothing about (also not a boundary — unknown
 * must never become a wrong hit)?
 *
 * Task 4 shipped this as a literal set of ENDINGS (한/던/해서/는데) and logged
 * four review rounds of consequences (docs/SOLVED.md [2026-08-13]): the
 * ending alone cannot answer it. 추천한 (verb, boundary) and 시원한
 * (adjective, not a boundary) share an ending down to the syllable; 한 alone
 * is the determiner "one"; 식당에서's 서 is a location particle; 술하고's 하고
 * is the companion josa. What separates them is the STEM's class, so this
 * module combines the ending grammar (ko/inflect.ts) with the stem lexicons
 * (ko/lexicon-verbs.ts) and reports the stem it found, not just a boolean.
 */

export type ClauseFormKind = 'verb' | 'adjective'

export interface ClauseForm {
  /** `verb` = clause boundary; `adjective` = modifies the next noun. */
  kind: ClauseFormKind
  /** The stem that was found in the lexicon — what the caller can log/act on. */
  stem: string
  /** The ending that was stripped: a syllable (은/는/을/던/고/서/는데) or a
   * fused single consonant (ㄴ/ㄹ). */
  ending: string
  /** `attributive` modifies a following noun; `connective` links two clauses. */
  endingKind: 'attributive' | 'connective'
}

interface Rule {
  ending: string
  endingKind: ClauseForm['endingKind']
  /** Candidate stems for `word` under this ending; `[]` when it cannot apply. */
  stems(word: string): string[]
}

/** A suffix-stripping rule: `word` must end with `ending`, and the head must
 * be non-empty (a bare ending is a word of its own, never stem + ending). */
function head(word: string, ending: string): string | null {
  if (!word.endsWith(ending) || word.length <= ending.length) return null
  return word.slice(0, word.length - ending.length)
}

/**
 * Order matters twice over: the longest ending must be tried before its own
 * suffix (는데 before 는), and the syllabic 은/을 before the fused ㄴ/ㄹ so
 * 먹은 analyses as 먹+은 rather than as 먹으+ㄴ.
 */
const RULES: readonly Rule[] = [
  {
    ending: '는데',
    endingKind: 'connective',
    stems: (word) => {
      const h = head(word, '는데')
      return h === null ? [] : [h, ...stripPast(h)]
    },
  },
  {
    ending: '서',
    endingKind: 'connective',
    stems: (word) => {
      const h = head(word, '서')
      return h === null ? [] : stripInfinitive(h)
    },
  },
  {
    ending: '던',
    endingKind: 'attributive',
    stems: (word) => {
      const h = head(word, '던')
      return h === null ? [] : [h, ...stripPast(h)]
    },
  },
  {
    ending: '는',
    endingKind: 'attributive',
    stems: (word) => {
      const h = head(word, '는')
      return h === null ? [] : [h]
    },
  },
  {
    ending: '은',
    endingKind: 'attributive',
    stems: (word) => {
      const h = head(word, '은')
      // -은 only attaches to a consonant-final stem; after a vowel the ending
      // is the fused ㄴ instead, handled by its own rule below.
      if (h === null || jongseongOf(h.slice(-1)) === '') return []
      return [h]
    },
  },
  {
    ending: '을',
    endingKind: 'attributive',
    stems: (word) => {
      const h = head(word, '을')
      if (h === null || jongseongOf(h.slice(-1)) === '') return []
      return [h]
    },
  },
  {
    ending: 'ㄴ',
    endingKind: 'attributive',
    stems: (word) => unfuseEnding(word, 'ㄴ'),
  },
  {
    ending: 'ㄹ',
    endingKind: 'attributive',
    stems: (word) => unfuseEnding(word, 'ㄹ'),
  },
  {
    ending: '고',
    endingKind: 'connective',
    stems: (word) => {
      const h = head(word, '고')
      return h === null ? [] : [h, ...stripPast(h)]
    },
  },
]

const VERB_STEM_SET: ReadonlySet<string> = new Set(VERB_STEMS_KO)
const ADJ_STEM_SET: ReadonlySet<string> = new Set(ADJ_STEMS_KO)

/**
 * The attributive/connective form `word` is, or null when no rule + lexicon
 * pair explains it.
 *
 * Null is the answer for every ordinary word, and that is the point: 원/잔/
 * 반/건 (the currency and counter words Task 4's round-2 regression fired on),
 * 한 and 던 standing alone (the determiner "one" — its stem candidate 하 is
 * not in the verb lexicon, so nothing special-cases it), 식당에서, 술하고.
 */
export function readClauseForm(word: string): ClauseForm | null {
  for (const rule of RULES) {
    for (const stem of rule.stems(word)) {
      if (VERB_STEM_SET.has(stem)) {
        return { kind: 'verb', stem, ending: rule.ending, endingKind: rule.endingKind }
      }
      if (ADJ_STEM_SET.has(stem)) {
        return { kind: 'adjective', stem, ending: rule.ending, endingKind: rule.endingKind }
      }
    }
  }
  return null
}

/** `word` is a VERB's attributive/connective form — a clause boundary. */
export function isVerbAttributive(word: string): boolean {
  return readClauseForm(word)?.kind === 'verb'
}

/** `word` is an ADJECTIVE's attributive form — NOT a clause boundary. */
export function isAdjectiveAttributive(word: string): boolean {
  return readClauseForm(word)?.kind === 'adjective'
}

/**
 * The attributive surface of `stem`: 시원하 → 시원한, 좋 → 좋은, 만들 → 만든,
 * 맛있 → 맛있는, 먹 → 먹은 (for a verb this is the PAST attributive, for an
 * adjective the present one — the same three forms, which is exactly why the
 * ending cannot tell the two classes apart).
 *
 * Null when no rule applies to the stem's shape.
 */
export function attributiveOf(stem: string): string | null {
  const last = stem.at(-1)
  if (last === undefined) return null
  const batchim = jongseongOf(last)
  // 있/없-final adjectives take 는, not 은 (맛있는, 재미없는) — including the
  // colloquial contraction that fuses 있 into the stem's own syllable
  // (재미있 → 재밌 → 재밌는, never 재밌은).
  if (last === '있' || last === '없' || batchim === 'ㅆ') return `${stem}는`
  if (batchim === 'ㄹ' || batchim === '') return fuseEnding(stem, 'ㄴ')
  return `${stem}은`
}

/**
 * Every adjective attributive form this parser knows — GENERATED from
 * `ADJ_STEMS_KO` by `attributiveOf`, not typed out. The mandated
 * "ADJ_ATTRIBUTIVE list" of the brief, kept a derived value so the list and
 * the recognizer can never disagree (a hand-typed list is a second grammar,
 * and a second grammar is a second chance to be wrong).
 */
export const ADJ_ATTRIBUTIVE: readonly string[] = ADJ_STEMS_KO.map(attributiveOf).filter(
  (form): form is string => form !== null,
)
