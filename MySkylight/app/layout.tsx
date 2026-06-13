import type { Metadata, Viewport } from "next"
import { ClerkProvider } from "@clerk/nextjs"
import { Geist_Mono, Inter, Montserrat } from "next/font/google"
import { Toaster } from "sonner"

import "./globals.css"
import { Providers } from "@/components/providers"
import { cn } from "@/lib/utils"

const montserratHeading = Montserrat({ subsets: ["latin"], variable: "--font-heading" })
const inter = Inter({ subsets: ["latin"], variable: "--font-sans" })
const fontMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" })

export const metadata: Metadata = {
  title: "MySkylight",
  description: "Family calendar hub",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "MySkylight",
    statusBarStyle: "black-translucent",
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
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
          montserratHeading.variable,
        )}
      >
        <body>
          <Providers>{children}</Providers>
          <Toaster richColors position="top-center" />
        </body>
      </html>
    </ClerkProvider>
  )
}
