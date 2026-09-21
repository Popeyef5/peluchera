import { createNeonAuth } from "@neondatabase/auth/next/server";

// Same-origin proxy to Neon Auth. The browser client (lib/auth.ts) talks to
// /api/auth/*; this forwards each call to NEON_AUTH_BASE_URL and rewrites the
// session cookies onto the admin origin.
//
// Both env vars are read at runtime (compose env_file), not baked at build.
// Built on first request so `next build` doesn't need the secret.
type Handlers = ReturnType<ReturnType<typeof createNeonAuth>["handler"]>;
type Ctx = { params: Promise<{ path: string[] }> };

let handlers: Handlers | null = null;

function neonAuth(): Handlers {
  handlers ??= createNeonAuth({
    baseUrl: process.env.NEON_AUTH_BASE_URL!,
    cookies: { secret: process.env.NEON_AUTH_COOKIE_SECRET! },
  }).handler();
  return handlers;
}

export const dynamic = "force-dynamic";

export const GET = (req: Request, ctx: Ctx) => neonAuth().GET(req, ctx);
export const POST = (req: Request, ctx: Ctx) => neonAuth().POST(req, ctx);
export const PUT = (req: Request, ctx: Ctx) => neonAuth().PUT(req, ctx);
export const DELETE = (req: Request, ctx: Ctx) => neonAuth().DELETE(req, ctx);
export const PATCH = (req: Request, ctx: Ctx) => neonAuth().PATCH(req, ctx);
