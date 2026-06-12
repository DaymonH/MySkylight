# MySkylight — Feature List

A family calendar app. Users belong to a family, have role-based access, and manage member personas (calendar profiles). Real-time updates via SSE. Calendar events are a future backend addition.

---

## Phase 1 — App Shell
- [ ] Root layout with Clerk `<ClerkProvider>`, theme provider, font
- [ ] Sign-in page (`/sign-in`)
- [ ] Sign-up page (`/sign-up`)
- [ ] Protected route guard (redirect unauthenticated users to `/sign-in`)
- [ ] Clerk webhook endpoint (`POST /api/webhooks/clerk`) — syncs user to backend DB on create/update/delete

## Phase 2 — Onboarding
- [ ] Onboarding page (`/app/onboarding`) — shown after sign-up or when user has no family
- [ ] Create a new family (form: family name)
- [ ] Accept an invite (`/invite/accept?token=...`) — calls `POST /invitations/accept`

## Phase 3 — Family Dashboard
- [ ] App shell layout (`/app/...`) — sidebar or nav with family name, user avatar
- [ ] Family overview page (`/app`) — family name, member list summary
- [ ] Edit family name (owner/adult only)

## Phase 4 — Member Management
- [ ] Members list (`/app/members`) — name, color, role badge, child indicator
- [ ] Add member drawer/modal (owner/adult) — name, color, is_child toggle, optional PIN
- [ ] Edit member drawer/modal (owner/adult) — name, color, avatar URL, PIN reset
- [ ] Delete member (owner/adult) — with confirmation

## Phase 5 — Invitations
- [ ] Invitations page (`/app/invitations`) — pending invites list (owner/adult)
- [ ] Send invite form — email + role selector (adult/viewer)
- [ ] Revoke invite

## Phase 6 — PIN Lock
- [ ] Enable family lock (owner/adult) — set alphanumeric PIN via `PATCH /families/{id}/lock`
- [ ] PIN verify screen — shown when lock is active, calls `POST /families/{id}/lock/verify`

## Phase 7 — Real-time
- [ ] SSE subscription hook (`useFamily Stream`) — connects to `GET /families/{id}/stream`
- [ ] Live member list updates (member.created / member.updated / member.deleted events)
- [ ] Live family updates (family.updated events)

## Future — Calendar (backend not yet built)
- [ ] Calendar view
- [ ] Add/edit/delete calendar events
- [ ] Per-member color coding on calendar
