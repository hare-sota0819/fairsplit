import { InviteLink } from '@/components/InviteLink'

/**
 * Heading, explanation and the copyable invite link. Statement grammar
 * (FIXES §2 family): no card, no ring, no fill — a micro-label, a meta
 * sentence, and the link row on its own hairline.
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
    <section className="flex flex-col" data-testid="invite-cta">
      <h2 className="text-xs font-normal uppercase tracking-[0.12em] text-[#a8a8a8]">
        {title}
      </h2>
      <div className="mt-1">
        <InviteLink
          inviteCode={inviteCode}
          copyLabel={copyLabel}
          copiedLabel={copiedLabel}
        />
      </div>
      <p className="mt-2 text-xs leading-5 text-[#a8a8a8]">{body}</p>
    </section>
  )
}
