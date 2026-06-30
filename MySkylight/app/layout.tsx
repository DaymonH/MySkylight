import type { Metadata, Viewport } from "next"
import { ClerkProvider } from "@clerk/nextjs"
import { Fraunces, Geist_Mono, Inter } from "next/font/google"
import { Toaster } from "@/components/ui/sonner"

import "./globals.css"
import { Providers } from "@/components/providers"
import { cn } from "@/lib/utils"

// Fraunces — a warm, optically-sized "old-style" serif for headings/logo. The
// `opsz` axis lets large titles (e.g. "March 2026") show more flair while small
// card titles stay calm. Pairs with Inter to feel homey rather than corporate.
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-heading",
  axes: ["opsz"],
})
const inter = Inter({ subsets: ["latin"], variable: "--font-sans" })
const fontMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" })

export const metadata: Metadata = {
  title: "MySkylight",
  description: "Family calendar hub",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "MySkylight",
    statusBarStyle: "default",
  },
  icons: {
    apple: "/apple-touch-icon.png",
  },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <ClerkProvider>
      <html
        lang="en"
        suppressHydrationWarning
        className={cn(
          "antialiased",
          fontMono.variable,
          "font-sans",
          inter.variable,
          fraunces.variable
        )}
      >
        <body>
          {/* Apply the saved color theme before paint (mirrors next-themes' own
              anti-flash script). Keep the id list in sync with `use-palette.ts`. */}
          <script
            dangerouslySetInnerHTML={{
              __html: `(function(){try{var v=localStorage.getItem("skylight:settings:palette");var ok=["coral","hearth","midnight","graphite","ocean","berry","meadow"];document.documentElement.setAttribute("data-palette",ok.indexOf(v)>-1?v:"coral")}catch(e){}})()`,
            }}
          />
          <Providers>{children}</Providers>
          <Toaster richColors position="top-center" expand />
        </body>
      </html>
    </ClerkProvider>
  )
}
