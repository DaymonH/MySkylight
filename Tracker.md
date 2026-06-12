# MySkylight — Build Tracker

## Phase 1 — App Shell
- [ ] Root layout (`app/layout.tsx`) — ClerkProvider, ThemeProvider, font
- [ ] Sign-in page (`app/(auth)/sign-in/page.tsx`)
- [ ] Sign-up page (`app/(auth)/sign-up/page.tsx`)
- [ ] Protected app layout (`app/(app)/layout.tsx`) — auth guard + family guard
- [ ] Clerk webhook route (`app/api/webhooks/clerk/route.ts`)

## Phase 2 — Onboarding
- [ ] Onboarding page (`app/(app)/onboarding/page.tsx`)
- [ ] Create family form
- [ ] Invite accept page (`app/invite/accept/page.tsx`)

## Phase 3 — Family Dashboard
- [ ] App nav/sidebar layout
- [ ] Family overview page (`app/(app)/page.tsx`)
- [ ] Edit family name

## Phase 4 — Members
- [ ] Members page (`app/(app)/members/page.tsx`)
- [ ] Member card component
- [ ] Add member form/drawer
- [ ] Edit member form/drawer
- [ ] Delete member with confirmation

## Phase 5 — Invitations
- [ ] Invitations page (`app/(app)/invitations/page.tsx`)
- [ ] Send invite form
- [ ] Revoke invite action

## Phase 6 — PIN Lock
- [ ] Enable lock / set PIN flow
- [ ] PIN verify screen

## Phase 7 — Realtime
- [ ] `lib/use-family-stream.ts` SSE hook
- [ ] Wire stream into member list
- [ ] Wire stream into family header

## Infrastructure
- [x] Proxy route (`app/api/backend/[...path]/route.ts`)
- [x] `lib/api.ts` — `apiRequest<T>()`
- [x] `lib/use-api-query.ts` — `useApiQuery<T>()`
- [x] `.env.local` configured
- [x] `skylight-api` Clerk JWT template created
- [ ] Netlify deploy configured
- [ ] `app/api/webhooks/clerk` registered in Clerk dashboard
