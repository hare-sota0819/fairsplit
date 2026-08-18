import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { classify } from '../classify'
import type { AssistantContext, Classified } from '../types'
import { emptyMemory, observeUserUtterance, resolvePersonReference } from './engine'
import type { DialogueMemory } from './engine'

/**
 * The MULTI-TURN dialogue corpus — the conversation-level bar the owner
 * set on 2026-08-14 ("판정 기준의 추가": sentence-level assertions stay,
 * dialogue-level assertions go on top). Each fixture is one conversation;
 * the runner replays it through the SAME pipeline order the composer
 * uses — reference resolution → memory observation → classify — with a
 * fresh memory per file, and asserts what each turn must produce.
 *
 * A turn's `expect` may assert:
 *  - reference: 'resolved' | 'ambiguous' | 'unknown' (+ resolvedText)
 *  - intent, and any flat slot on the Classified result
 *    (act/topic/scope/currency/walletType/view/memberId).
 * An ambiguous/unknown reference ends the turn (the composer asks), so
 * intent expectations are only legal on turns that classify.
 */

const FIXTURES = path.join(__dirname, '../../../../test-fixtures/dialogues')

interface TurnExpect {
  reference?: 'resolved' | 'ambiguous' | 'unknown'
  resolvedText?: string
  intent?: string
  [slot: string]: unknown
}

interface DialogueFixture {
  _members: Array<{ id: string; name: string }>
  _actorId: string
  _currency: string
  _locale: 'ko' | 'en'
  _note?: string
  turns: Array<{ user: string; expect: TurnExpect }>
}

const files = readdirSync(FIXTURES).filter((f) => f.endsWith('.json'))

describe.each(files)('dialogue corpus: %s', (file) => {
  const fixture = JSON.parse(
    readFileSync(path.join(FIXTURES, file), 'utf8'),
  ) as DialogueFixture
  const ctx: AssistantContext = {
    members: fixture._members,
    actorId: fixture._actorId,
    defaultCurrency: fixture._currency,
    locale: fixture._locale,
    openCard: null,
  }

  it('replays every turn to its expected outcome', () => {
    let memory: DialogueMemory = emptyMemory()
    fixture.turns.forEach((turn, index) => {
      const label = `turn ${index + 1}: "${turn.user}"`
      const reference = resolvePersonReference(
        memory,
        turn.user,
        ctx.members,
        ctx.actorId,
      )
      memory = observeUserUtterance(
        memory,
        reference.kind === 'resolved' ? reference.text : turn.user,
        ctx.members,
      )

      if (turn.expect.reference !== undefined) {
        expect(reference.kind, label).toBe(turn.expect.reference)
      }
      if (turn.expect.resolvedText !== undefined) {
        expect(reference.kind, label).toBe('resolved')
        if (reference.kind === 'resolved') {
          expect(reference.text, label).toBe(turn.expect.resolvedText)
        }
      }
      // The composer stops and asks on these — no classify happens.
      if (reference.kind === 'ambiguous' || reference.kind === 'unknown') {
        expect(turn.expect.intent, `${label} must not also expect an intent`).toBeUndefined()
        return
      }

      if (turn.expect.intent !== undefined) {
        const effective = reference.kind === 'resolved' ? reference.text : turn.user
        const got: Classified = classify(effective, ctx)
        expect(got.intent, label).toBe(turn.expect.intent)
        for (const [slot, want] of Object.entries(turn.expect)) {
          if (slot === 'intent' || slot === 'reference' || slot === 'resolvedText') continue
          expect(
            (got as unknown as Record<string, unknown>)[slot],
            `${label} slot ${slot}`,
          ).toEqual(want)
        }
      }
    })
  })
})

describe('dialogue corpus hygiene', () => {
  it('holds at least 4 conversations', () => {
    expect(files.length).toBeGreaterThanOrEqual(4)
  })
})
