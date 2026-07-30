import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // Emit a self-contained server (.next/standalone) with only the node_modules it
  // actually needs, so the Docker image doesn't carry the full dependency tree.
  // See the Dockerfile — public/ and .next/static are excluded from this output
  // and are copied in separately.
  output: "standalone",
  allowedDevOrigins: ["192.168.68.55"],
  // Barrel-optimize big re-export packages so only the primitives/icons actually
  // used are pulled into client chunks (smaller JS to parse on the kiosk).
  experimental: {
    optimizePackageImports: ["radix-ui", "lucide-react"],
  },
}

export default nextConfig
