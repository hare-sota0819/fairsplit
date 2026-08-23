'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * NUMBERS NEVER SWAP INSTANTLY — THEY ROLL (SPEC-INTERACTIONS §8).
 *
 * An amount rolls PER DIGIT COLUMN. Each column is its own strip of 0-9
 * inside a one-line-tall overflow-hidden window, translated by
 * -(digit * line). Static glyphs (the currency symbol, a trailing zero, a
 * decimal point) do not move, and get an explicit line-height/height equal
 * to the strip's so the whole run sits on one baseline — the alignment rule
 * the spec calls out: wrap everything in inline-flex align-items:flex-start
 * and match every static glyph to the strip height.
 *
 * MECHANICAL LAG. The leading column settles first (.32s); every column to
 * its right is 60ms slower and starts 40ms later, so the figure lands like
 * a till drawer rather than a digital clock. For the spec's own example
 * (hundreds then tens) that is exactly .32s and .38s / .04s delay.
 *
 * A GROUP SEPARATOR SLIDES OPEN. Columns are laid out from the RIGHT, so a
 * figure that grows past a thousand opens its new leading slots — the comma
 * included — by animating width 0→auto rather than appearing from nowhere.
 * Slots are never unmounted: an amount that shrinks closes them the same way.
 *
 * Reduced motion: globals' reduced-motion block collapses the transitions,
 * so the figure simply reads its final value.
 */

const ROLL_START_MS = 320
const ROLL_STEP_MS = 60
const ROLL_LAG_MS = 40
/** Beyond this many columns the lag stops accumulating — three columns of
 *  drift reads as a mechanism, ten reads as a stutter. */
const MAX_LAG_STEPS = 3

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']

function isDigit(char: string): boolean {
  return char >= '0' && char <= '9'
}

/** Splits "¥1,120" / "108,419원" into a static head, a rolling body and a
 *  static tail. Only the body — digits and their separators — rolls. */
function parts(text: string): { head: string; body: string; tail: string } {
  let start = 0
  while (start < text.length && !isDigit(text[start])) start += 1
  let end = text.length
  while (end > start && !isDigit(text[end - 1])) end -= 1
  return {
    head: text.slice(0, start),
    body: text.slice(start, end),
    tail: text.slice(end),
  }
}

/** One static glyph, height-matched to the digit strips. */
function Glyph({ char, line }: { char: string; line: number }) {
  return (
    <span style={{ lineHeight: `${line}px`, height: `${line}px` }}>{char}</span>
  )
}

/** One 0-9 strip in a one-line window, translated to show `digit`. */
function Column({
  digit,
  line,
  duration,
  delay,
}: {
  digit: number
  line: number
  duration: number
  delay: number
}) {
  return (
    <span
      className="inline-block overflow-hidden"
      style={{ height: `${line}px` }}
    >
      <span
        className="flex flex-col ease-swift"
        style={{
          lineHeight: `${line}px`,
          transform: `translateY(-${digit * line}px)`,
          transitionProperty: 'transform',
          transitionDuration: `${duration}ms`,
          transitionDelay: `${delay}ms`,
        }}
      >
        {DIGITS.map((digitChar) => (
          <span key={digitChar} style={{ height: `${line}px` }}>
            {digitChar}
          </span>
        ))}
      </span>
    </span>
  )
}

/** One slot of the rolling body: a digit column, a separator, or a closed
 *  gap waiting for the figure to grow into it. */
type Slot =
  | { kind: 'digit'; digit: number; duration: number; delay: number }
  | { kind: 'glyph'; char: string }
  | { kind: 'closed' }

function slotsFor(body: string, width: number): Slot[] {
  const offset = Math.max(width, body.length) - body.length
  // Lag accumulates left→right across the ROLLING columns only, so a
  // separator sitting between two digits does not spend a lag step.
  let rolling = 0
  return Array.from({ length: offset + body.length }, (_, index): Slot => {
    if (index < offset) return { kind: 'closed' }
    const char = body[index - offset]
    if (!isDigit(char)) return { kind: 'glyph', char }
    const step = Math.min(rolling, MAX_LAG_STEPS)
    rolling += 1
    return {
      kind: 'digit',
      digit: Number(char),
      duration: ROLL_START_MS + ROLL_STEP_MS * step,
      delay: ROLL_LAG_MS * step,
    }
  })
}

export function Odometer({
  value,
  line = 20,
  className,
}: {
  /** The amount, already formatted for its locale and currency. */
  value: string
  /** Strip height in px. The spec's inline default is 20. */
  line?: number
  className?: string
}) {
  const { head, body, tail } = parts(value)

  // The widest form seen this mount. Slots are never unmounted, so a figure
  // that grows opens new leading slots instead of re-flowing the whole run.
  const seen = useRef(body.length)
  const [width, setWidth] = useState(body.length)
  useEffect(() => {
    if (body.length > seen.current) {
      seen.current = body.length
      setWidth(body.length)
    }
  }, [body.length])

  return (
    <span className={cn('inline-flex tabular-nums', className)}>
      {/* Assistive tech reads the figure once, as a figure; the strips
          themselves are ten digits of decorative text. */}
      <span className="sr-only">{value}</span>
      <span aria-hidden="true" className="inline-flex items-start">
        {head.split('').map((char, index) => (
          <Glyph key={`h${index}`} char={char} line={line} />
        ))}
        {slotsFor(body, width).map((slot, index) => (
          <span
            key={index}
            className="inline-flex overflow-hidden ease-swift"
            style={{
              height: `${line}px`,
              width: slot.kind === 'closed' ? 0 : undefined,
              transitionProperty: 'width',
              transitionDuration: `${ROLL_START_MS}ms`,
            }}
          >
            {slot.kind === 'digit' ? (
              <Column
                digit={slot.digit}
                line={line}
                duration={slot.duration}
                delay={slot.delay}
              />
            ) : slot.kind === 'glyph' ? (
              <Glyph char={slot.char} line={line} />
            ) : null}
          </span>
        ))}
        {tail.split('').map((char, index) => (
          <Glyph key={`t${index}`} char={char} line={line} />
        ))}
      </span>
    </span>
  )
}

/**
 * THE QUANTITY ROLL (SPEC-INTERACTIONS §8).
 *
 * A serif figure rolling vertically in a 30px-tall window:
 * translateY = -(qty - 1) * 30px over .32s. One strip, one easing, no fade.
 */
export function QuantityRoll({
  value,
  max = 9,
  line = 30,
  className,
}: {
  value: number
  max?: number
  line?: number
  className?: string
}) {
  const ceiling = Math.max(max, value)
  return (
    <span className={cn('inline-flex', className)}>
      <span className="sr-only">{value}</span>
      <span
        aria-hidden="true"
        className="inline-block overflow-hidden text-center font-heading tabular-nums"
        style={{ height: `${line}px`, minWidth: `${line}px` }}
      >
        <span
          className="flex flex-col ease-swift"
          style={{
            lineHeight: `${line}px`,
            transform: `translateY(-${(value - 1) * line}px)`,
            transitionProperty: 'transform',
            transitionDuration: `${ROLL_START_MS}ms`,
          }}
        >
          {Array.from({ length: ceiling }, (_, index) => (
            <span key={index} style={{ height: `${line}px` }}>
              {index + 1}
            </span>
          ))}
        </span>
      </span>
    </span>
  )
}
