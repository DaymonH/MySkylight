import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.68.55"],
  // Barrel-optimize big re-export packages so only the primitives/icons actually
  // used are pulled into client chunks (smaller JS to parse on the kiosk).
  experimental: {
    optimizePackageImports: ["radix-ui", "lucide-react"],
  },
}

export default nextConfig
