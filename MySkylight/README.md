# MySkylight

Family calendar PWA — wall screen (`/device`) + companion app (`/app`). Built with Next.js 16, Tailwind v4, Clerk auth, and TanStack Query.

Backend: [HomeServerAPI](https://github.com/DaymonH/HomeServerAPI) (FastAPI on Raspberry Pi)

## Local Development

Run both the frontend and backend locally so you can see changes instantly without deploying.

**Prerequisites:** Node.js 20+ and npm (works the same on macOS, Linux, and Windows). On macOS,
install with `brew install node`.

### 1. Start the backend

Follow the **Local Development** section in the [HomeServerAPI README](https://github.com/DaymonH/HomeServerAPI). The backend must be running on `http://localhost:8001` before starting the frontend.

### 2. Start the frontend

```bash
npm install      # first time only
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The `.env.local` file already has `API_BASE_URL=http://localhost:8001`, so requests proxy to your local backend automatically. No changes needed.

### Workflow

Keep two terminals open:

| Terminal | Command | URL |
|---|---|---|
| Backend | `uvicorn app.main:app --reload --port 8001` | `http://localhost:8001` |
| Frontend | `npm run dev` | `http://localhost:3000` |

Both support hot reload — save a file and the change appears immediately.

---

## Environment variables

| Variable | Where to get it |
|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk dashboard → API Keys |
| `CLERK_SECRET_KEY` | Clerk dashboard → API Keys |
| `API_BASE_URL` | `http://localhost:8001` for local, `https://skylight-api.daymonhansen.com` for production |
| `NEXT_PUBLIC_API_BASE_URL` | **Production only** — `https://skylight-api.daymonhansen.com`. The realtime stream connects here directly instead of relaying through the proxy route. Leave it **unset** locally so the stream uses the proxy and local dev needs no CORS setup. |
| `CLERK_JWT_TEMPLATE` | Name of the JWT template in Clerk (set to `skylight-api`) |

These are already set in `.env.local` for local dev. For production, set them in the Netlify dashboard under **Site settings → Environment variables**.

> `NEXT_PUBLIC_API_BASE_URL` is not optional in production, and forgetting it fails quietly: the app
> keeps working, but the SSE stream falls back to the proxy route, where a serverless function's
> execution limit kills it every few seconds. The kiosk then reconnects around the clock — the
> behaviour that ran up a Netlify function-invocation bill. See `hooks/use-realtime.ts`.
>
> Because the browser then calls the API cross-origin, `CORS_ORIGINS` in the backend's
> `skylight-api/.env` must list the site's origin (`https://myskylight.daymonhansen.com`).

---

## Adding shadcn/ui components

```bash
npx shadcn@latest add <component-name>
```

Components are placed in `components/ui/`.
