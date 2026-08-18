import {
  RECEIPT_MEDIA_RESOLUTION,
  RECEIPT_MODEL_ID,
  RECEIPT_THINKING_BUDGET,
} from './config'
import { RECEIPT_RESPONSE_SCHEMA, RECEIPT_SYSTEM_PROMPT } from './prompt'
import type { ReceiptParseOutcome, ReceiptParser, ReceiptUsage } from './provider'
import { parseReceiptResponse } from './schema'

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'

interface GeminiUsageMetadata {
  promptTokenCount?: number
  candidatesTokenCount?: number
  thoughtsTokenCount?: number
  totalTokenCount?: number
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>
  usageMetadata?: GeminiUsageMetadata
  error?: { code?: number; message?: string; status?: string }
}

function toUsage(meta: GeminiUsageMetadata | undefined, latencyMs: number): ReceiptUsage {
  return {
    inputTokens: meta?.promptTokenCount ?? 0,
    outputTokens: meta?.candidatesTokenCount ?? 0,
    thinkingTokens: meta?.thoughtsTokenCount ?? 0,
    totalTokens: meta?.totalTokenCount ?? 0,
    latencyMs,
  }
}

/** Base64 without pulling in a polyfill — Buffer is always present server-side. */
function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

/**
 * Gemini implementation of `ReceiptParser`.
 *
 * The API key is read from the server environment and never travels to the
 * client (brief §28, §187) — this module must only ever be imported from a
 * route handler or server action.
 */
export class GeminiReceiptParser implements ReceiptParser {
  private readonly apiKey: string
  private readonly model: string

  constructor(apiKey: string, model: string = RECEIPT_MODEL_ID) {
    this.apiKey = apiKey
    this.model = model
  }

  async parse(
    image: Uint8Array,
    options: { signal?: AbortSignal } = {},
  ): Promise<ReceiptParseOutcome> {
    // Brief §197: exactly one automatic retry on a transient failure, then
    // surface the error. Never a loop — a stuck client must not be able to
    // spend quota indefinitely.
    const first = await this.attempt(image, options.signal)
    if (first.ok || !isTransient(first)) return first
    return this.attempt(image, options.signal)
  }

  private async attempt(image: Uint8Array, signal?: AbortSignal): Promise<ReceiptParseOutcome> {
    const body = {
      contents: [
        {
          parts: [
            { text: RECEIPT_SYSTEM_PROMPT },
            { inline_data: { mime_type: 'image/jpeg', data: toBase64(image) } },
          ],
        },
      ],
      generationConfig: {
        mediaResolution: RECEIPT_MEDIA_RESOLUTION,
        responseMimeType: 'application/json',
        responseSchema: RECEIPT_RESPONSE_SCHEMA,
        thinkingConfig: { thinkingBudget: RECEIPT_THINKING_BUDGET },
      },
    }

    const started = Date.now()
    let response: Response
    try {
      response = await fetch(
        `${ENDPOINT}/${this.model}:generateContent?key=${encodeURIComponent(this.apiKey)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal,
        },
      )
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError'
      return { ok: false, kind: aborted ? 'TIMEOUT' : 'PROVIDER_ERROR' }
    }

    let json: GeminiResponse
    try {
      json = (await response.json()) as GeminiResponse
    } catch {
      return { ok: false, kind: 'PROVIDER_ERROR' }
    }
    const usage = toUsage(json.usageMetadata, Date.now() - started)

    if (json.error) {
      const code = json.error.code ?? response.status
      if (code === 429) return { ok: false, kind: 'RATE_LIMITED', usage }
      return { ok: false, kind: 'PROVIDER_ERROR', raw: json.error.message, usage }
    }

    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
    if (!text) return { ok: false, kind: 'UNREADABLE', usage }

    const parsed = parseReceiptResponse(text)
    if (!parsed.ok) return { ok: false, kind: 'UNREADABLE', raw: parsed.raw, usage }

    return { ok: true, receipt: parsed.receipt, usage }
  }
}

function isTransient(outcome: Extract<ReceiptParseOutcome, { ok: false }>): boolean {
  // A rate limit is NOT retried: retrying it immediately is exactly the
  // quota-burning loop the brief forbids, and the user has a manual-entry exit.
  return outcome.kind === 'PROVIDER_ERROR'
}
