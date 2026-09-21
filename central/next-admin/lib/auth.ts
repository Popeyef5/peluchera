"use client";

import { createAuthClient } from "@neondatabase/auth/next";

// Neon Auth (Managed Better Auth) browser client. It takes no URL: every call
// goes to this app's own /api/auth/*, which proxies to Neon Auth (see
// app/api/auth/[...path]/route.ts). That keeps the session cookie first-party
// on the admin origin, so browsers that block third-party cookies still work.
export const authClient = createAuthClient();
