# Garra admin

Operator console for Garra. Separate Next 15 app from the player frontend so
admin tooling can iterate independently and the player bundle stays free of
admin code. Talks to `central/fastapi` over `/admin/*` HTTP routes; auth is
handled by Supabase (admin sessions are Supabase JWTs).

## First-time setup

1. **Create a Supabase project** (free tier is fine):
   - https://supabase.com → new project.
   - Auth → Providers → enable Email; disable everything else for now.
   - Auth → Settings → **disable "Allow new users to sign up"** so attackers
     can't self-register against your admin app.

2. **Create the first admin user** manually:
   - Auth → Users → Add user → Create new user → set an email + temporary
     password. (Repeat per operator. There are no roles in v1 — every signed-
     in user is an admin.)

3. **Copy env vars**:
   - `cp central/.env.admin.example central/.env.admin`
   - Fill in `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (from
     Project Settings → API), and `SUPABASE_JWT_SECRET` (from Project
     Settings → API → JWT Settings).

4. **Run**:
   - `docker compose -f docker-compose.dev.yml up --build`
   - Open <http://admin.localhost> (most browsers resolve `*.localhost` to
     `127.0.0.1`; if yours doesn't, add `127.0.0.1 admin.localhost` to your
     hosts file).

## Stack

- Next 15 (App Router), React 19
- Tailwind + shadcn-style primitives in `components/ui/` (copy-paste, no
  CLI). Add more via `npx shadcn add <component>` whenever you need them.
- `@supabase/supabase-js` for auth (client-only — no middleware, no SSR).
- `lib/api.ts` is the API wrapper that pins the Supabase JWT on every
  request.

## Conventions

- Every protected page lives under `app/(app)/` so the route group's layout
  wraps it in `RequireAuth` + `NavBar`.
- `/login` lives outside that group so it's not gated.
- API calls go through `apiFetch` (never bare `fetch`) so 401 handling and
  auth headers stay consistent.

## What ships in v1

Route surface only — the four screens are placeholders, the backend stubs
return empty payloads. Real implementations land in the next pass:

- `/balls` — list balls with current binding, "Bind to OpenedBooster" form.
- `/inventory` — OpenedBooster / ClosedBooster / Card CRUD.
- `/ops` — cabinet status, clear-fault, void-ball, force-turn-end.

Manual batch publish for on-chain commitments is intentionally deferred
until the cryptography stack is finalized.
