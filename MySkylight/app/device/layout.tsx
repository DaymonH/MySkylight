import { DeviceNav } from "@/components/device-nav"

export const metadata = { title: "MySkylight — Device" }

export default function DeviceLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-background text-foreground flex h-screen w-screen flex-col overflow-hidden">
      <DeviceNav />
      <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
    </div>
  )
}
