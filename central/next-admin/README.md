# Garra admin

Operator console for Garra. Separate Next 15 app from the player frontend so
admin tooling can iterate independently and the player bundle stays free of
admin code. Talks to `central/fastapi` over `/admin/*` HTTP routes; sign-in is Neon Auth
(Managed Better Auth on the Neon project's `production` branch).

## How sign-in works

- Operators sign in with an **emailed 6-digit code** or **Google**.
- The browser only ever talks to this app's `/api/auth/*`
  (`app/api/auth/[...path]/route.ts`), which proxies to Neon Auth and keeps the
  session cookie first-party on the admin origin.
- For FastAPI calls, `lib/api.ts` fetches a 15-minute EdDSA JWT from
  `/api/auth/token` and sends it as `Authorization: Bearer`.
- FastAPI checks the token against Neon Auth's JWKS, then requires a
  **verified** email on `ADMIN_EMAIL_ALLOWLIST` / `ADMIN_EMAIL_DOMAINS`. With
  both empty, nobody gets in.

## First-time setup

1. **Neon Auth** is enabled on the `production` branch. In Console → Auth:
   - The operators' accounts exist already (Users). To add one, create the
     user there and add the address to `ADMIN_EMAIL_ALLOWLIST`.
   - Trusted domains: `https://admin.cl4ws.com`, `http://admin.localhost`.
   - Google uses Neon's shared development credentials. For production,
     create your own Google OAuth client with the redirect URI
     `<NEON_AUTH_BASE_URL>/callback/google` and add it under Auth → OAuth.
   - Codes come from Neon's shared sender (`auth@mail.myneon.app`). For
     production, set up custom SMTP under Auth → Email.

2. **Add the env vars** to `central/.env` (dev) or `central/.env.prod` (prod).
   Both are read at runtime, so no rebuild is needed when they change:
   - `NEON_AUTH_BASE_URL`: Console → Auth → Configuration. Also read by
     FastAPI.
   - `NEON_AUTH_COOKIE_SECRET`: `openssl rand -base64 32`. Signs the cached
     session cookie.
   - `ADMIN_EMAIL_ALLOWLIST` (FastAPI).

3. **Run**:
   - `docker compose -f docker-compose.dev.yml up --build`
   - Open <http://admin.localhost> (most browsers resolve `*.localhost` to
     `127.0.0.1`; if yours doesn't, add `127.0.0.1 admin.localhost` to your
     hosts file).

## Stack

- Next 15 (App Router), React 19
- Tailwind + shadcn-style primitives in `components/ui/` (copy-paste, no
  CLI). Add more via `npx shadcn add <component>` whenever you need them.
- `@neondatabase/auth` for sign-in: `lib/auth.ts` is the browser client, and
  `app/api/auth/[...path]` is the proxy. There is no middleware; pages are gated
  client-side by `RequireAuth`.
- `lib/api.ts` is the API wrapper that attaches the Neon Auth JWT to every
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
