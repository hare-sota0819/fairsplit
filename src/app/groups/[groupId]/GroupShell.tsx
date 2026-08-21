/**
 * The group routes' page frame: one centred column, widening at lg+.
 * (The desktop context panel it used to make room for went with the chat
 * removal, 2026-08-21.)
 */
export function GroupShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col lg:max-w-2xl">
        {children}
      </div>
    </div>
  )
}
