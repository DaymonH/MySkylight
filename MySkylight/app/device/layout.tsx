export const metadata = { title: "MySkylight — Device" }

export default function DeviceLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-background text-foreground flex h-screen w-screen overflow-hidden">
      {children}
    </div>
  )
}
