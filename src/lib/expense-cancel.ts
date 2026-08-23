/**
 * The soft-delete write, in one place.
 *
 * Cancelling an expense is not a delete: the row stays, leaves every
 * settlement and wallet computation, and remains visible in feeds with its
 * audit trail intact.
 *
 * It was split out when TWO call sites performed that write and had to write
 * exactly the same fields; the second (the chat's "그거 취소해줘") went with
 * the chat programme on 2026-08-21, leaving the expense detail screen's
 * toggle (`setExpenseCancelled`, expenses/actions.ts). It stays a separate
 * pure module because the pinning test below is worth more than the
 * inlining: the retroactive-change flow writes these same fields on the far
 * side of a consent request.
 *
 * `at` is a parameter rather than a `new Date()` here so the function stays
 * pure and its contract is pinnable in a test (which is the point: prose
 * saying "these two write the same fields" drifts silently, a test does not).
 */
export interface ExpenseCancelFields {
  cancelledAt: Date | null
  cancelledById: string | null
  updatedById: string
}

export function cancelledFields(
  cancelled: boolean,
  /** The member performing the change — recorded as the canceller (when
   *  cancelling) and always as the last editor. */
  memberId: string,
  at: Date,
): ExpenseCancelFields {
  return {
    // Restoring clears both cancellation fields; the edit is still audited.
    cancelledAt: cancelled ? at : null,
    cancelledById: cancelled ? memberId : null,
    updatedById: memberId,
  }
}
