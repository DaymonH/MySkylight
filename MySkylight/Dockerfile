# syntax=docker/dockerfile:1
#
# Production image for the MySkylight frontend, built and run by the
# HomeServerAPI Compose stack (service `myskylight-web`). Not for local dev —
# use `npm run dev` for that.
#
# Debian slim rather than Alpine on purpose: Tailwind v4 and the Next.js compiler
# ship native binaries, and package-lock.json is generated on macOS, so the glibc
# variants are the well-trodden path. The image is bigger; the host has the disk.

# ── deps ──────────────────────────────────────────────────────────────────────
# Separate stage so node_modules is cached independently of source changes — only
# a package.json/package-lock.json edit re-runs the install.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ── builder ───────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules

# `next build` inlines every NEXT_PUBLIC_* value into the client bundle, so these
# must arrive as build args — passing them at runtime has no effect on the browser
# code. Nothing secret belongs here: anything in this list ships to the client.
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_CLERK_SIGN_IN_URL
ARG NEXT_PUBLIC_CLERK_SIGN_UP_URL
ARG NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL
ARG NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL
ARG NEXT_PUBLIC_CLERK_JWT_TEMPLATE
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY} \
    NEXT_PUBLIC_CLERK_SIGN_IN_URL=${NEXT_PUBLIC_CLERK_SIGN_IN_URL} \
    NEXT_PUBLIC_CLERK_SIGN_UP_URL=${NEXT_PUBLIC_CLERK_SIGN_UP_URL} \
    NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=${NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL} \
    NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=${NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL} \
    NEXT_PUBLIC_CLERK_JWT_TEMPLATE=${NEXT_PUBLIC_CLERK_JWT_TEMPLATE}

# Git SHA of this build. app/sw.js/route.ts bakes it into the service worker's
# cache name, so each deploy retires the previous build's cached chunks — the
# always-on kiosk then swaps itself onto the new build without a manual reload.
# Netlify used to supply this variable; ops/deploy.sh does now. Declared after
# the ENV block above so it only invalidates the layers below it.
ARG COMMIT_REF=unknown
ENV COMMIT_REF=${COMMIT_REF}

ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN npm run build

# ── runner ────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runner
WORKDIR /app

# HOSTNAME=0.0.0.0 binds all interfaces rather than just loopback, so Caddy can
# reach the server across the Compose network. Don't "harden" this to 127.0.0.1:
# Next 16 runs proxy.ts in front of the app and forwards to `localhost` over HTTP,
# which resolves to ::1 first — with only 127.0.0.1 bound, route handlers fail with
# "Failed to proxy" while static and proxy-level responses still work, so it breaks
# in a way that's easy to miss.
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# `output: "standalone"` emits a self-contained server plus the subset of
# node_modules it actually needs. `public/` and `.next/static` are deliberately
# excluded from it and have to be copied alongside. Owned by `node` so the
# runtime can write .next/cache.
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

USER node
EXPOSE 3000

# Same probe ops/deploy.sh uses, so `docker ps` reflects real readiness. Node 22
# has a global fetch, so this needs no extra dependency.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]
