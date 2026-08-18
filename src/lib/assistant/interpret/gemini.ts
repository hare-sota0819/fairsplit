import type {
  FallbackInterpreter,
  InterpretInput,
  InterpretOutcome,
  UtteranceInterpretation,
} from './provider'

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'

/** Same model family as receipt scanning (src/lib/receipts/config.ts) —
 *  one provider, one bill, swappable here without touching call sites. */
export const INTERPRET_MODEL_ID = 'gemini-3.5-flash'

/** Thinking off: this is a structured-extraction call on a short text;
 *  latency is subordinate to quality (owner ruling) but reasoning adds
 *  nothing to slot-copying and the receipts calibration showed the same. */
const THINKING_BUDGET = 0

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    intent: { type: 'string', enum: ['expense', 'query', 'edit', 'unknown'] },
    amount: { type: 'string', nullable: true },
    currency: { type: 'string', nullable: true },
    payerName: { type: 'string', nullable: true },
    participantNames: { type: 'array', items: { type: 'string' } },
    description: { type: 'string', nullable: true },
    confidence: { type: 'number' },
  },
  required: ['intent', 'participantNames', 'confidence'],
} as const

function systemPrompt(input: InterpretInput): string {
  const roster = input.roster.map((m) => m.name).join(', ')
  return [
    'You extract STRUCTURE from one chat message in a shared-expense app.',
    'Rules — violating any of them makes the answer worthless:',
    '- Copy values LITERALLY from the message. Never invent, convert, or compute a number. If the message says 2만엔, amount is "20000" and currency "JPY"; if no amount is stated, amount is null.',
    '- payerName/participantNames may ONLY be names from the roster that the message itself refers to (their name, or first-person words meaning the sender). Anything else: leave them out.',
    '- Do not sum, split, or do ANY arithmetic. Structure only.',
    `- Roster: ${roster || '(empty)'} — the sender is "${input.roster.find((m) => m.id === input.dialogue.senderId)?.name ?? ''}".`,
    `- Default currency when the message marks money but no currency: ${input.defaultCurrency}.`,
    '- intent: expense = money was spent and should be recorded; query = a question about balances/history; edit = changing something already recorded; unknown = none of these.',
    '- confidence: your own 0..1 estimate that this reading is what the sender meant.',
    `Message (locale ${input.locale}): ${JSON.stringify(input.text)}`,
  ].join('\n')
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[]
  error?: { code?: number; message?: string }
}

/**
 * Gemini implementation of the fallback-interpreter seam (owner-triggered
 * R6). SERVER-ONLY — the key never travels to the client; import from a
 * server action only. Every guard stays on the caller's side of the seam
 * (ground.ts G1 etc.); this class only fetches and shapes. Never throws
 * for expected failures; one automatic retry on transient errors, same
 * budget rule as GeminiReceiptParser.
 */
export class GeminiInterpreter implements FallbackInterpreter {
  private readonly apiKey: string
  private readonly model: string

  constructor(apiKey: string, model: string = INTERPRET_MODEL_ID) {
    this.apiKey = apiKey
    this.model = model
  }

  async interpret(input: InterpretInput): Promise<InterpretOutcome> {
    const first = await this.attempt(input)
    if (first.ok || first.kind !== 'unavailable') return first
    return this.attempt(input)
  }

  private async attempt(input: InterpretInput): Promise<InterpretOutcome> {
    const body = {
      contents: [{ parts: [{ text: systemPrompt(input) }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        thinkingConfig: { thinkingBudget: THINKING_BUDGET },
      },
    }

    let response: Response
    try {
      response = await fetch(
        `${ENDPOINT}/${this.model}:generateContent?key=${encodeURIComponent(this.apiKey)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(8000),
        },
      )
    } catch {
      return { ok: false, kind: 'unavailable' }
    }

    let json: GeminiResponse
    try {
      json = (await response.json()) as GeminiResponse
    } catch {
      return { ok: false, kind: 'unavailable' }
    }
    if (json.error) {
      return { ok: false, kind: 'unavailable' }
    }
    const text =
      json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
    if (!text) return { ok: false, kind: 'refused' }

    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      return { ok: false, kind: 'refused' }
    }
    const shaped = shape(raw)
    if (shaped === null) return { ok: false, kind: 'refused' }
    return { ok: true, interpretation: shaped }
  }
}

/** Defensive shaping — the schema is enforced provider-side, but a guard
 *  layer never trusts the wire. */
function shape(raw: unknown): UtteranceInterpretation | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const intent = r.intent
  if (
    intent !== 'expense' &&
    intent !== 'query' &&
    intent !== 'edit' &&
    intent !== 'unknown'
  ) {
    return null
  }
  const str = (v: unknown): string | null =>
    typeof v === 'string' && v.trim() !== '' ? v.trim() : null
  const confidence = typeof r.confidence === 'number' ? r.confidence : 0
  return {
    intent,
    amount: str(r.amount),
    currency: str(r.currency)?.toUpperCase() ?? null,
    payerName: str(r.payerName),
    participantNames: Array.isArray(r.participantNames)
      ? r.participantNames.filter((n): n is string => typeof n === 'string')
      : [],
    description: str(r.description),
    confidence: Math.max(0, Math.min(1, confidence)),
  }
}
