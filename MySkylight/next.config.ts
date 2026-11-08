import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // Netlify's commit hash, exposed to the client so a new deploy invalidates the
  // persisted query cache (see lib/query-persist.ts).
  env: {
    NEXT_PUBLIC_BUILD_SHA: process.env.COMMIT_REF ?? "dev",
  },
  allowedDevOrigins: ["192.168.68.55"],
  // Barrel-optimize big re-export packages so only the primitives/icons actually
  // used are pulled into client chunks (smaller JS to parse on the kiosk).
  experimental: {
    optimizePackageImports: ["radix-ui", "lucide-react"],
  },
}

export default nextConfig
