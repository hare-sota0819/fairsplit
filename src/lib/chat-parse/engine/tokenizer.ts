import type { Token, TokenKind } from './tokens'

// Unicode ranges for Hangul: syllables + all jamo blocks.
export function isHangulCodePoint(cp: number): boolean {
  return (
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul Syllables
    (cp >= 0x1100 && cp <= 0x11ff) || // Hangul Jamo
    (cp >= 0x3130 && cp <= 0x318f) || // Hangul Compatibility Jamo
    (cp >= 0xa960 && cp <= 0xa97f) || // Hangul Jamo Extended-A
    (cp >= 0xd7b0 && cp <= 0xd7ff) // Hangul Jamo Extended-B
  )
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9'
}

function isLatin(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')
}

function classify(ch: string): TokenKind {
  const cp = ch.codePointAt(0) as number
  if (isHangulCodePoint(cp)) return 'hangul'
  if (isDigit(ch)) return 'digits'
  if (isLatin(ch)) return 'latin'
  if (/\s/.test(ch)) return 'space'
  return 'punct'
}

/** Single forward walk over code points; groups maximal runs of the same kind into one token. */
export function tokenize(input: string): Token[] {
  const chars = Array.from(input)
  const tokens: Token[] = []
  let i = 0
  let offset = 0

  while (i < chars.length) {
    const kind = classify(chars[i])
    let text = chars[i]
    let j = i + 1

    if (kind === 'digits') {
      // `.`/`,` stay part of the digits run only when flanked by digits on both sides
      // (e.g. `45.60`, `45,000`); a trailing separator not followed by a digit is punct.
      while (j < chars.length) {
        const c = chars[j]
        if (isDigit(c)) {
          text += c
          j++
          continue
        }
        if ((c === '.' || c === ',') && j + 1 < chars.length && isDigit(chars[j + 1])) {
          text += c
          j++
          continue
        }
        break
      }
    } else {
      while (j < chars.length && classify(chars[j]) === kind) {
        text += chars[j]
        j++
      }
    }

    const start = offset
    offset += text.length
    tokens.push({ kind, text, start, end: offset })
    i = j
  }

  return tokens
}
