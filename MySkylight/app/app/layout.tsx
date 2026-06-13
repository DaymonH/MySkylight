import { UserButton } from "@clerk/nextjs"

export const metadata = { title: "MySkylight" }

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-background text-foreground flex min-h-svh flex-col">
      <header className="border-border flex h-14 items-center justify-between border-b px-4">
        <span className="font-heading text-lg font-semibold">MySkylight</span>
        <UserButton />
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  )
}
