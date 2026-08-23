import { describe, expect, it } from 'vitest'
import { cancelledFields } from './expense-cancel'

const AT = new Date('2026-08-13T03:00:00.000Z')

describe('cancelledFields', () => {
  /**
   * This is the drift guard, not a formality: prose promising that every
   * writer of this object agrees is exactly the kind of claim that rots.
   * Pinning the EXACT key set means adding a field to one caller's write
   * without adding it here fails loudly.
   */
  it('cancelling records when, who cancelled, and who edited — and nothing else', () => {
    const fields = cancelledFields(true, 'm1', AT)
    expect(fields).toEqual({
      cancelledAt: AT,
      cancelledById: 'm1',
      updatedById: 'm1',
    })
    expect(Object.keys(fields).sort()).toEqual([
      'cancelledAt',
      'cancelledById',
      'updatedById',
    ])
  })

  it('restoring clears both cancellation fields but still records the editor', () => {
    expect(cancelledFields(false, 'm2', AT)).toEqual({
      cancelledAt: null,
      cancelledById: null,
      updatedById: 'm2',
    })
  })

  it('is pure — the same inputs always produce the same write', () => {
    expect(cancelledFields(true, 'm1', AT)).toEqual(
      cancelledFields(true, 'm1', AT),
    )
  })
})
