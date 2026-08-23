import type { Prisma } from '@prisma/client'
import type {
  RetroAuditEntry,
  RetroDecision,
  RetroWriter,
} from '@/lib/retro-apply'
import type { RetroProposal } from '@/lib/retro-proposal'

/**
 * The Prisma half of `applyRetroPlan`, bound to ONE transaction.
 *
 * Every method here writes through the `tx` it was built with and nowhere
 * else. That is the whole contract: `applyRetroPlan` decides what happens, and
 * because it can only reach the database through this object, everything it
 * does belongs to a single transaction that rolls back as one.
 */
export function prismaRetroWriter(
  tx: Prisma.TransactionClient,
  groupId: string,
): RetroWriter {
  return {
    async clearExpenseChildren(expenseId) {
      await tx.expenseParticipant.deleteMany({ where: { expenseId } })
      await tx.expenseItem.deleteMany({ where: { expenseId } })
      await tx.expenseFunding.deleteMany({ where: { expenseId } })
    },

    async writeProposal(expenseId: string, proposal: RetroProposal) {
      // A proposal that lands after every checkpoint is not settled money any
      // more — an edit may move a timestamp past the last barrier — so its
      // funding rows are written LIVE, with no freeze on them. The rates the
      // proposal carries are still the ones the diff was computed from; they
      // are simply not pinned, because nothing has settled them.
      const frozen = proposal.frozenAtCheckpointId !== null
      await tx.expense.update({
        where: { id: expenseId },
        data: {
          title: proposal.title,
          payerId: proposal.payerId,
          amount: BigInt(proposal.amount),
          timestamp: new Date(proposal.timestampIso),
          note: proposal.note,
          isPersonal: proposal.isPersonal,
          receiptImagePath: proposal.receiptImagePath,
          participants: {
            create: proposal.participantIds.map((memberId) => ({ memberId })),
          },
          items: {
            create: proposal.items.map((item) => ({
              name: item.name,
              unitAmount: BigInt(item.unitAmount),
              quantity: item.quantity,
              splitMode: item.splitMode,
              assignments: {
                create: item.assignees.map((assignee) => ({
                  memberId: assignee.memberId,
                  quantity: assignee.quantity,
                  amount:
                    assignee.amount === undefined
                      ? null
                      : BigInt(assignee.amount),
                })),
              },
            })),
          },
          funding: {
            create: proposal.funding.map((row) => ({
              position: row.position,
              amount: BigInt(row.amount),
              walletId: row.walletId,
              ownRateSnapshot: row.ownRateSnapshot,
              funderId: row.funderId,
              ...(frozen
                ? {
                    frozenRateNum: BigInt(row.frozenRateNum),
                    frozenRateDen: BigInt(row.frozenRateDen),
                    frozenSource: row.frozenSource,
                    frozenAmount: BigInt(row.frozenAmount),
                  }
                : {}),
            })),
          },
        },
      })
    },

    async setCancelled(expenseId, cancelled, byMemberId) {
      await tx.expense.update({
        where: { id: expenseId },
        data: {
          cancelledAt: cancelled ? new Date() : null,
          cancelledById: cancelled ? byMemberId : null,
          updatedById: byMemberId,
        },
      })
    },

    async setFrozenAt(expenseId, checkpointId) {
      await tx.expense.update({
        where: { id: expenseId },
        data: { frozenAtCheckpointId: checkpointId },
      })
    },

    async decideRequest(
      requestId: string,
      decision: RetroDecision,
      decidedAt: Date,
    ) {
      await tx.retroChangeRequest.update({
        where: { id: requestId },
        data: { status: decision, decidedAt },
      })
    },

    async appendAudit(entry: RetroAuditEntry, actorId: string | null) {
      await tx.auditEvent.create({
        data: {
          groupId,
          kind: entry.kind,
          actorId,
          // The entry is already JSON-safe: every money figure in it is a
          // decimal string, never a number.
          payload: entry as unknown as Prisma.InputJsonValue,
        },
      })
    },
  }
}
