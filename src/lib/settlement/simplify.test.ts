import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import { simplifyDebts } from './simplify'

const balances = (entries: Record<string, bigint>): Map<string, bigint> =>
  new Map(Object.entries(entries))

describe('simplifyDebts', () => {
  test('settles a single debtor-creditor pair directly', () => {
    expect(simplifyDebts(balances({ alice: 10n, bob: -10n }))).toEqual([
      { from: 'bob', to: 'alice', amount: 10n },
    ])
  })

  test('returns no transfers when everyone is settled', () => {
    expect(simplifyDebts(balances({ alice: 0n, bob: 0n }))).toEqual([])
  })

  test('matches the largest creditor with the largest debtor first', () => {
    const result = simplifyDebts(
      balances({ alice: 7n, bob: 3n, carol: -5n, dave: -5n }),
    )
    expect(result[0]).toEqual({ from: 'carol', to: 'alice', amount: 5n })
    expect(result.length).toBeLessThanOrEqual(3)
  })

  test('is deterministic on ties (smaller member id first)', () => {
    const a = simplifyDebts(balances({ bob: 5n, alice: 5n, carol: -10n }))
    const b = simplifyDebts(balances({ alice: 5n, carol: -10n, bob: 5n }))
    expect(a).toEqual(b)
    expect(a[0].to).toBe('alice')
  })

  test('5 members need at most 4 transfers (brief scenario 5)', () => {
    const result = simplifyDebts(
      balances({
        a: 90_000n,
        b: -20_000n,
        c: -30_000n,
        d: -15_000n,
        e: -25_000n,
      }),
    )
    expect(result.length).toBeLessThanOrEqual(4)
    // Transfers must exactly settle every balance.
    const net = new Map<string, bigint>()
    for (const { from, to, amount } of result) {
      expect(amount > 0n).toBe(true)
      net.set(from, (net.get(from) ?? 0n) - amount)
      net.set(to, (net.get(to) ?? 0n) + amount)
    }
    expect(net.get('a')).toBe(90_000n)
  })

  test('property: n members always settle in at most n-1 transfers, exactly', () => {
    const arb = fc
      .array(fc.bigInt({ min: -1_000_000n, max: 1_000_000n }), {
        minLength: 2,
        maxLength: 8,
      })
      .map((amounts) => {
        // Force zero-sum by balancing the last member.
        const total = amounts.reduce((a, b) => a + b, 0n)
        const entries = amounts.map((amount, i) => [`m${i}`, amount] as const)
        entries.push([`m${amounts.length}`, -total])
        return new Map(entries)
      })
    fc.assert(
      fc.property(arb, (input) => {
        const transfers = simplifyDebts(input)
        expect(transfers.length).toBeLessThanOrEqual(input.size - 1)
        const net = new Map<string, bigint>()
        for (const { from, to, amount } of transfers) {
          net.set(from, (net.get(from) ?? 0n) - amount)
          net.set(to, (net.get(to) ?? 0n) + amount)
        }
        // Executing the transfers hands every member exactly their balance:
        // creditors receive what they are owed, debtors pay what they owe.
        for (const [memberId, balance] of input) {
          expect(net.get(memberId) ?? 0n).toBe(balance)
        }
      }),
    )
  })

  test('throws when balances do not sum to zero', () => {
    expect(() => simplifyDebts(balances({ alice: 1n }))).toThrow()
  })
})
