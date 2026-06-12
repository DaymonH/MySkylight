# MySkylight — Implementation Plan

## Route Structure

```
app/
├── (auth)/
│   ├── sign-in/page.tsx          # Clerk <SignIn />
│   └── sign-up/page.tsx          # Clerk <SignUp />
├── (app)/
│   ├── layout.tsx                # Protected layout — redirects if no user/family
│   ├── page.tsx                  # Family dashboard
│   ├── members/page.tsx          # Members list + add/edit/delete
│   ├── invitations/page.tsx      # Pending invites + send/revoke
│   └── onboarding/page.tsx       # Create family or accept invite
├── invite/
│   └── accept/page.tsx           # Public — accept invite via token from URL
└── api/
    ├── backend/[...path]/route.ts # Proxy (already created)
    └── webhooks/clerk/route.ts   # Clerk webhook → POST /api/v1/webhooks/clerk
```

## API Call Conventions

All backend calls go through `apiRequest<T>()` in `lib/api.ts`:

```ts
// reads
const { data, loading } = useApiQuery<Family>("api/v1/families/123");

// mutations
const result = await apiRequest("api/v1/families", {
  method: "POST",
  body: JSON.stringify({ name: "The Hansens" }),
});
```

The proxy at `app/api/backend/[...path]/route.ts` injects the Clerk JWT automatically.

## Data Patterns

- **Single fetch on mount** → `useApiQuery<T>(path)` from `lib/use-api-query.ts`
- **Mutations / conditional fetches** → `apiRequest<T>(path, options)` directly
- **React Query** is available but use it only for complex caching needs (e.g. SSE invalidation)
- **No global state** — family data lives in the dashboard layout via a context or prop-drilled from a layout fetch

## Realtime (SSE)

```ts
// lib/use-family-stream.ts
useEffect(() => {
  const es = new EventSource("/api/backend/api/v1/families/{id}/stream");
  es.onmessage = (e) => { /* invalidate query or update state */ };
  return () => es.close();
}, [familyId]);
```

## Auth & Role Checks

- `auth()` from `@clerk/nextjs/server` — use in server components and API routes
- `useUser()` from `@clerk/nextjs` — use in client components
- Role checks happen server-side on the backend; frontend shows/hides UI based on membership role returned from `GET /api/v1/families/{id}/memberships`

## Webhook Route

The backend expects Svix-signed POST from Clerk. The Next.js webhook route just proxies to the backend — do NOT verify the signature in Next.js (backend handles it):

```ts
// app/api/webhooks/clerk/route.ts
export async function POST(req: Request) {
  // forward raw body + Svix headers to backend
}
```

Register `https://myskylight.daymonhansen.com/api/webhooks/clerk` in Clerk dashboard → Webhooks.

## Component Library

Uses shadcn/ui (radix-ui primitives already installed). Add components with:
```bash
npx shadcn add button card dialog drawer input label select badge
```

## File Naming

- Files: kebab-case (`member-card.tsx`, `use-family-stream.ts`)
- Components/Types: PascalCase
- Hooks/functions: camelCase
- Domain types: `app/(app)/_lib/types.ts`
