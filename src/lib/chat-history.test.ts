import { describe, expect, it } from 'vitest'
import type { TranscriptMessage } from '@/app/groups/[groupId]/ChatTranscript'
import {
  CHAT_HISTORY_CAP,
  CHAT_HISTORY_PAGE_SIZE,
  appendChatMessagesSchema,
  fromPersistable,
  sessionMemorySchema,
  sessionTitleFrom,
  toPersistable,
  type ChatMessageRow,
} from './chat-history'

const hasAllKeys = () => true
const hasNoKeys = () => false

/** Builds a `ChatMessageRow` as `fetchChatHistory` would hand it to
 *  `fromPersistable` — `payload` as it comes back from Postgres JSON. */
function row(over: Partial<ChatMessageRow> & { role: string; kind: string; payload: unknown }): ChatMessageRow {
  return {
    id: 'msg1',
    groupId: 'group1',
    createdAt: '2026-08-13T00:00:00.000Z',
    ...over,
  }
}

describe('constants', () => {
  it('cap is 500, page size is 50', () => {
    expect(CHAT_HISTORY_CAP).toBe(500)
    expect(CHAT_HISTORY_PAGE_SIZE).toBe(50)
  })
})

describe('toPersistable', () => {
  it('user/text -> {role: user, kind: text, payload: {text}}', () => {
    const message: TranscriptMessage = { id: 'u1', role: 'user', kind: 'text', text: 'hi' }
    expect(toPersistable(message)).toEqual({
      role: 'user',
      kind: 'text',
      clientMessageId: 'u1',
      payload: { text: 'hi' },
    })
  })

  it('user/image with no uploaded path -> {imagePath: null, text} (url is never persisted)', () => {
    const message: TranscriptMessage = {
      id: 'u2',
      role: 'user',
      kind: 'image',
      url: 'blob:http://localhost/abc',
      text: 'receipt',
      imagePath: null,
    }
    expect(toPersistable(message)).toEqual({
      role: 'user',
      kind: 'image',
      clientMessageId: 'u2',
      payload: { imagePath: null, text: 'receipt' },
    })
  })

  it('user/image with null text', () => {
    const message: TranscriptMessage = {
      id: 'u3',
      role: 'user',
      kind: 'image',
      url: 'blob:http://localhost/abc',
      text: null,
      imagePath: null,
    }
    expect(toPersistable(message)).toEqual({
      role: 'user',
      kind: 'image',
      clientMessageId: 'u3',
      payload: { imagePath: null, text: null },
    })
  })

  it('user/image with an uploaded path threads imagePath through (url is still never persisted)', () => {
    const message: TranscriptMessage = {
      id: 'u4',
      role: 'user',
      kind: 'image',
      url: 'blob:http://localhost/abc',
      text: null,
      imagePath: 'g1/photo.jpg',
    }
    expect(toPersistable(message)).toEqual({
      role: 'user',
      kind: 'image',
      clientMessageId: 'u4',
      payload: { imagePath: 'g1/photo.jpg', text: null },
    })
  })

  it('assistant/answer with only plain lines -> keeps all', () => {
    const message: TranscriptMessage = {
      id: 'a1',
      role: 'assistant',
      kind: 'answer',
      lines: [{ key: 'chat.ack' }, { key: 'chat.hold', values: { name: 'Bob' } }],
    }
    expect(toPersistable(message)).toEqual({
      role: 'assistant',
      kind: 'answer',
      clientMessageId: 'a1',
      payload: {
        lines: [{ key: 'chat.ack', values: undefined }, { key: 'chat.hold', values: { name: 'Bob' } }],
      },
    })
  })

  it('assistant/answer whose every line is a chip (onSelect/href) -> null (a prompt, not a record)', () => {
    const message: TranscriptMessage = {
      id: 'a2',
      role: 'assistant',
      kind: 'answer',
      lines: [
        { key: 'assistant.guided.option.a', onSelect: () => {} },
        { key: 'assistant.guided.escape', href: '/expenses/new' },
      ],
    }
    expect(toPersistable(message)).toBeNull()
  })

  it('assistant/answer mixed (plain + chip lines) -> drops chip lines, keeps plain ones', () => {
    const message: TranscriptMessage = {
      id: 'a3',
      role: 'assistant',
      kind: 'answer',
      lines: [
        { key: 'chat.ack' },
        { key: 'assistant.guided.option.a', onSelect: () => {} },
        { key: 'chat.hold' },
        { key: 'assistant.guided.escape', href: '/expenses/new' },
      ],
    }
    expect(toPersistable(message)).toEqual({
      role: 'assistant',
      kind: 'answer',
      clientMessageId: 'a3',
      payload: {
        lines: [{ key: 'chat.ack', values: undefined }, { key: 'chat.hold', values: undefined }],
      },
    })
  })

  it('assistant/saved -> {title, receiptTotal}', () => {
    const message: TranscriptMessage = {
      id: 's1',
      role: 'assistant',
      kind: 'saved',
      title: 'Dinner',
      receiptTotal: '¥12,000',
      groupId: 'group1',
    }
    expect(toPersistable(message)).toEqual({
      role: 'assistant',
      kind: 'saved',
      clientMessageId: 's1',
      payload: { title: 'Dinner', receiptTotal: '¥12,000' },
    })
  })

  it('assistant/saved with null fields', () => {
    const message: TranscriptMessage = {
      id: 's2',
      role: 'assistant',
      kind: 'saved',
      title: null,
      receiptTotal: null,
      groupId: 'group1',
    }
    expect(toPersistable(message)).toEqual({
      role: 'assistant',
      kind: 'saved',
      clientMessageId: 's2',
      payload: { title: null, receiptTotal: null },
    })
  })

  it('assistant/card -> null (live callbacks)', () => {
    const message: TranscriptMessage = {
      id: 'c1',
      role: 'assistant',
      kind: 'card',
      card: {
        kind: 'askAmount',
        value: '',
        invalid: false,
        onChange: () => {},
        onSubmit: () => {},
        onCancel: () => {},
      },
    }
    expect(toPersistable(message)).toBeNull()
  })

  it('assistant/scanning -> null (transient indicator)', () => {
    const message: TranscriptMessage = { id: 'sc1', role: 'assistant', kind: 'scanning' }
    expect(toPersistable(message)).toBeNull()
  })

  it('assistant/recalc -> null (server-derived)', () => {
    const message: TranscriptMessage = {
      id: 'recalc',
      role: 'assistant',
      kind: 'recalc',
      groupId: 'group1',
      message: 'Balances updated',
      dismissLabel: 'Dismiss',
      action: async () => {},
    }
    expect(toPersistable(message)).toBeNull()
  })

  it('assistant/persistExplainer -> null (device-local, one-time UI chrome)', () => {
    const message: TranscriptMessage = {
      id: 'persist-explainer',
      role: 'assistant',
      kind: 'persistExplainer',
    }
    expect(toPersistable(message)).toBeNull()
  })
})

describe('fromPersistable', () => {
  it('restores a text row, prefixing the id with db-', () => {
    const restored = fromPersistable(
      row({ role: 'user', kind: 'text', payload: { text: 'hi' } }),
      hasAllKeys,
    )
    expect(restored).toEqual({ id: 'db-msg1', role: 'user', kind: 'text', text: 'hi' })
  })

  it('restores an image row with a non-null imagePath into the signed image route', () => {
    const restored = fromPersistable(
      row({ role: 'user', kind: 'image', payload: { imagePath: 'g1/photo.jpg', text: null } }),
      hasAllKeys,
    )
    expect(restored).toEqual({
      id: 'db-msg1',
      role: 'user',
      kind: 'image',
      url: `/api/receipts/image?path=${encodeURIComponent('g1/photo.jpg')}`,
      text: null,
      imagePath: 'g1/photo.jpg',
    })
  })

  it('restores an image row with a null imagePath as an empty url (placeholder fallback)', () => {
    const restored = fromPersistable(
      row({ role: 'user', kind: 'image', payload: { imagePath: null, text: 'note' } }),
      hasAllKeys,
    )
    expect(restored).toEqual({
      id: 'db-msg1',
      role: 'user',
      kind: 'image',
      url: '',
      text: 'note',
      imagePath: null,
    })
  })

  it('restores an answer row, filtering lines by hasKey', () => {
    const restored = fromPersistable(
      row({
        role: 'assistant',
        kind: 'answer',
        payload: { lines: [{ key: 'chat.ack' }, { key: 'chat.removed.key' }] },
      }),
      (key) => key !== 'chat.removed.key',
    )
    expect(restored).toEqual({
      id: 'db-msg1',
      role: 'assistant',
      kind: 'answer',
      lines: [{ key: 'chat.ack' }],
    })
  })

  it('drops an answer row entirely when every line fails hasKey (renamed/removed keys)', () => {
    const restored = fromPersistable(
      row({ role: 'assistant', kind: 'answer', payload: { lines: [{ key: 'chat.gone' }] } }),
      hasNoKeys,
    )
    expect(restored).toBeNull()
  })

  it('restores a saved row', () => {
    const restored = fromPersistable(
      row({ role: 'assistant', kind: 'saved', payload: { title: 'Dinner', receiptTotal: '¥12,000' } }),
      hasAllKeys,
    )
    expect(restored).toEqual({
      id: 'db-msg1',
      role: 'assistant',
      kind: 'saved',
      title: 'Dinner',
      receiptTotal: '¥12,000',
      groupId: 'group1',
    })
  })

  it('unknown kind -> null (forward compat)', () => {
    const restored = fromPersistable(
      row({ role: 'assistant', kind: 'futureKind', payload: { anything: true } }),
      hasAllKeys,
    )
    expect(restored).toBeNull()
  })

  it('malformed payload for a known kind -> null', () => {
    const restored = fromPersistable(
      row({ role: 'user', kind: 'text', payload: { nope: 1 } }),
      hasAllKeys,
    )
    expect(restored).toBeNull()
  })
})

describe('toPersistable / fromPersistable round trip', () => {
  it('text', () => {
    const original: TranscriptMessage = { id: 'u1', role: 'user', kind: 'text', text: 'hello' }
    const persisted = toPersistable(original)
    expect(persisted).not.toBeNull()
    // `clientMessageId` is a sibling DB COLUMN, not part of the row shape
    // `fromPersistable` reads — passed explicitly (not spread) so it's never
    // smuggled in here, same as the real `appendChatMessages`/
    // `fetchChatHistory` split keeps it out of `payload`.
    const restored = fromPersistable(
      row({ role: persisted!.role, kind: persisted!.kind, payload: persisted!.payload, id: 'x' }),
      hasAllKeys,
    )
    expect(restored).toEqual({ id: 'db-x', role: 'user', kind: 'text', text: 'hello' })
  })

  it('answer (plain lines survive, values preserved)', () => {
    const original: TranscriptMessage = {
      id: 'a1',
      role: 'assistant',
      kind: 'answer',
      lines: [{ key: 'chat.paidBy', values: { name: 'Alice' } }],
    }
    const persisted = toPersistable(original)
    expect(persisted).not.toBeNull()
    const restored = fromPersistable(
      row({ role: persisted!.role, kind: persisted!.kind, payload: persisted!.payload, id: 'x' }),
      hasAllKeys,
    )
    expect(restored).toEqual({
      id: 'db-x',
      role: 'assistant',
      kind: 'answer',
      lines: [{ key: 'chat.paidBy', values: { name: 'Alice' } }],
    })
  })

  it('saved', () => {
    const original: TranscriptMessage = {
      id: 's1',
      role: 'assistant',
      kind: 'saved',
      title: 'Dinner',
      receiptTotal: '¥1,000',
      groupId: 'group1',
    }
    const persisted = toPersistable(original)
    expect(persisted).not.toBeNull()
    const restored = fromPersistable(
      row({
        role: persisted!.role,
        kind: persisted!.kind,
        payload: persisted!.payload,
        id: 'x',
        groupId: 'group1',
      }),
      hasAllKeys,
    )
    expect(restored).toEqual({
      id: 'db-x',
      role: 'assistant',
      kind: 'saved',
      title: 'Dinner',
      receiptTotal: '¥1,000',
      groupId: 'group1',
    })
  })
})

describe('appendChatMessagesSchema', () => {
  it('accepts a well-formed batch', () => {
    const result = appendChatMessagesSchema.safeParse([
      { role: 'user', kind: 'text', clientMessageId: 'session-1:user-1', payload: { text: 'hi' } },
    ])
    expect(result.success).toBe(true)
  })

  it('rejects a batch over MAX_ENTRIES_PER_CALL (20)', () => {
    const entries = Array.from({ length: 21 }, (_, i) => ({
      role: 'user' as const,
      kind: 'text' as const,
      clientMessageId: `session-1:user-${i}`,
      payload: { text: 'hi' },
    }))
    const result = appendChatMessagesSchema.safeParse(entries)
    expect(result.success).toBe(false)
  })

  it('rejects text longer than 2000 chars', () => {
    const result = appendChatMessagesSchema.safeParse([
      {
        role: 'user',
        kind: 'text',
        clientMessageId: 'session-1:user-1',
        payload: { text: 'a'.repeat(2001) },
      },
    ])
    expect(result.success).toBe(false)
  })

  it('rejects a role/kind combination that does not exist (assistant/text)', () => {
    const result = appendChatMessagesSchema.safeParse([
      {
        role: 'assistant',
        kind: 'text',
        clientMessageId: 'session-1:assistant-1',
        payload: { text: 'hi' },
      },
    ])
    expect(result.success).toBe(false)
  })

  it('rejects an unknown kind', () => {
    const result = appendChatMessagesSchema.safeParse([
      { role: 'user', kind: 'futureKind', clientMessageId: 'session-1:user-1', payload: {} },
    ])
    expect(result.success).toBe(false)
  })

  it('rejects a missing clientMessageId (dedup key required — double-persist fix)', () => {
    const result = appendChatMessagesSchema.safeParse([
      { role: 'user', kind: 'text', payload: { text: 'hi' } },
    ])
    expect(result.success).toBe(false)
  })

  it('rejects an empty clientMessageId', () => {
    const result = appendChatMessagesSchema.safeParse([
      { role: 'user', kind: 'text', clientMessageId: '', payload: { text: 'hi' } },
    ])
    expect(result.success).toBe(false)
  })

  it('rejects a clientMessageId over the length cap', () => {
    const result = appendChatMessagesSchema.safeParse([
      { role: 'user', kind: 'text', clientMessageId: 'a'.repeat(201), payload: { text: 'hi' } },
    ])
    expect(result.success).toBe(false)
  })
})

describe('sessionTitleFrom (R2b)', () => {
  it('uses the first message as-is when short', () => {
    expect(sessionTitleFrom('점심 치킨 덮밥')).toBe('점심 치킨 덮밥')
  })
  it('collapses whitespace', () => {
    expect(sessionTitleFrom('  점심   2만엔 ')).toBe('점심 2만엔')
  })
  it('cuts long messages at a word boundary with an ellipsis', () => {
    const title = sessionTitleFrom(
      '점심에 2만엔짜리 치킨 덮밥 2개랑 콜라 하나를 나랑 수이수이가 먹음',
    )
    expect(title.length).toBeLessThanOrEqual(31)
    expect(title.endsWith('…')).toBe(true)
    expect(title).not.toContain('수이수이가 먹음')
  })
  it('empty input stays empty (caller falls back)', () => {
    expect(sessionTitleFrom('   ')).toBe('')
  })
})

describe('sessionMemorySchema (R2b)', () => {
  it('round-trips a dialogue memory', () => {
    const memory = {
      turn: 3,
      salience: {
        entities: [
          { kind: 'person', id: 'm1', label: '민수', turn: 2, by: 'user' },
        ],
      },
    }
    expect(sessionMemorySchema.parse(memory)).toEqual(memory)
  })
  it('rejects an incompatible older shape', () => {
    expect(sessionMemorySchema.safeParse({ v: 1, people: [] }).success).toBe(false)
  })
})
