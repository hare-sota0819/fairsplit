import { InviteLink } from '@/components/InviteLink'

/**
 * Heading, explanation and the copyable invite link/code. Home's
 * alone-only block and the dedicated `/invite` screen both render this
 * (home gates it on `alone`; `/invite` always shows it), so the two can
 * never diverge.
 */
export function InviteBlock({
  inviteCode,
  title,
  body,
  copyLabel,
  copiedLabel,
}: {
  inviteCode: string
  title: string
  body: string
  copyLabel: string
  copiedLabel: string
}) {
  return (
    <section
      className="flex flex-col gap-3 rounded-xl bg-card p-4 shadow-sm ring-1 ring-border-strong"
      data-testid="invite-cta"
    >
      <h2 className="font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">{body}</p>
      <InviteLink
        inviteCode={inviteCode}
        copyLabel={copyLabel}
        copiedLabel={copiedLabel}
      />
    </section>
  )
}
