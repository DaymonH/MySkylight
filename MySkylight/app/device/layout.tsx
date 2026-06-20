import { DeviceSidebar } from "@/components/device-sidebar"

export const metadata = { title: "MySkylight — Device" }

export default function DeviceLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-background text-foreground flex h-screen w-screen overflow-hidden">
      <DeviceSidebar />
      <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
    </div>
  )
}
