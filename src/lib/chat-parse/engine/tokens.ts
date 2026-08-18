import { disassembleCompleteCharacter, hasBatchim } from 'es-hangul'

export type TokenKind = 'hangul' | 'latin' | 'digits' | 'punct' | 'space'

export interface Token {
  kind: TokenKind
  text: string
  start: number // offset in the ORIGINAL string
  end: number // exclusive
}

/** hangul tokens only: per-syllable jamo, from es-hangul. */
export interface HangulInfo {
  /** disassembleCompleteCharacter per syllable; null for non-복합 chars. */
  syllables: Array<{ choseong: string; jungseong: string; jongseong: string } | null>
  /** hasBatchim of the LAST syllable — josa allomorphy needs exactly this. */
  finalBatchim: boolean
}

export function hangulInfo(t: Token): HangulInfo {
  const chars = Array.from(t.text)
  const syllables = chars.map((ch) => disassembleCompleteCharacter(ch) ?? null)
  const lastChar = chars[chars.length - 1] ?? ''
  return { syllables, finalBatchim: hasBatchim(lastChar) }
}
