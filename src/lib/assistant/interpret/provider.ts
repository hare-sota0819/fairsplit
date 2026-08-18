import type { ChatMember } from '../../chat-parse/types'

/**
 * The fallback-interpreter SEAM (docs/handoff/C-conversation-layer.md,
 * owner decision B+ 2026-08-14): when the rule path cannot read an
 * utterance, a pluggable interpreter MAY be asked to propose structure —
 * and until one is configured, `NullInterpreter` answers `unavailable`,
 * which the caller turns into a clarifying question. A future Gemini
 * implementation reuses the receipt-scan conventions
 * (src/lib/receipts/{provider,gemini}.ts, GEMINI_API_KEY) behind this
 * exact interface; plugging it in is config, not surgery.
 *
 * The owner's silent-failure guards live on OUR side of the seam, so any
 * implementation is automatically distrusted:
 *  G1 source-grounding — `groundInterpretation` (ground.ts) rejects every
 *     number/name not literally present in the raw text;
 *  G2 no-arithmetic — the shape below carries STRUCTURE only, no totals;
 *  G3 no-silent-save — proposals only ever PREFILL cards;
 *  G4 uncertain→ask — `unavailable`/`refused`/low confidence become
 *     specific questions, never best guesses.
 */
export interface UtteranceInterpretation {
  intent: 'expense' | 'query' | 'edit' | 'unknown'
  /** Decimal string exactly as it appears (normalized) in the text. */
  amount: string | null
  currency: string | null
  /** Member NAMES as written in the text — ids are bound by the caller. */
  payerName: string | null
  participantNames: string[]
  description: string | null
  /** 0..1 — the interpreter's own stated confidence. */
  confidence: number
}

export interface InterpretInput {
  text: string
  /** Serialized dialogue context: active card kind, salient names, and
   *  which roster member is SPEAKING (for first-person binding). */
  dialogue: {
    openCardKind: string | null
    salientNames: string[]
    senderId: string
  }
  roster: ChatMember[]
  defaultCurrency: string
  locale: 'ko' | 'en'
}

export type InterpretOutcome =
  | { ok: true; interpretation: UtteranceInterpretation }
  /** No interpreter configured, or the backend cannot answer right now. */
  | { ok: false; kind: 'unavailable' }
  /** The interpreter answered but refused/failed to produce structure. */
  | { ok: false; kind: 'refused' }

/** Implementations must not throw for expected failures — same law as
 *  ReceiptParser (src/lib/receipts/provider.ts). */
export interface FallbackInterpreter {
  interpret(input: InterpretInput): Promise<InterpretOutcome>
}

/** The default: nothing configured, every ask is `unavailable` — the
 *  caller asks the user instead. */
export class NullInterpreter implements FallbackInterpreter {
  interpret(): Promise<InterpretOutcome> {
    return Promise.resolve({ ok: false, kind: 'unavailable' })
  }
}
