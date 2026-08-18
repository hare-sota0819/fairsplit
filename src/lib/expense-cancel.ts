/**
 * The soft-delete write, in one place.
 *
 * Cancelling an expense is not a delete: the row stays, leaves every
 * settlement and wallet computation, and remains visible in feeds with its
 * audit trail intact. Two call sites perform that write — the expense detail
 * screen's toggle (`setExpenseCancelled`, expenses/actions.ts) and the chat's
 * "그거 취소해줘" (`applyCancel`, chat-edit-actions.ts) — and they must write
 * EXACTLY the same fields. Only their navigation differs (the detail screen
 * redirects back to itself; chat stays in the conversation and returns fresh
 * state), which is the whole reason there are two of them.
 *
 * It lives in `src/lib` rather than beside either caller because both callers
 * are `'use server'` modules, and a Server Actions file may only export async
 * functions — a shared plain helper cannot live in one of them.
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
