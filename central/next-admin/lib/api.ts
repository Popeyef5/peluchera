"use client";

// Base URL of the FastAPI admin endpoints. In dev the nginx proxy routes
// admin.localhost → next-admin (this app) for the UI and the same host's
// /admin/* paths to fastapi via the existing upstream — so a relative URL
// works there. Override via env for cross-host setups.
const ADMIN_API_BASE = process.env.NEXT_PUBLIC_ADMIN_API_BASE ?? "";

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

// FastAPI can't read the Neon Auth session cookie (different service), so it
// gets a JWT instead: EdDSA, 15-minute lifetime, fetched from /api/auth/token
// with the session cookie. Reused until a minute before it expires.
//
// Fetched directly rather than via authClient.token(): the SDK routes /token
// through its session cache and can hand back the cached session instead of a
// token.
const REFRESH_EARLY_SEC = 60;
let cached: { token: string; exp: number } | null = null;
let inFlight: Promise<string | null> | null = null;

async function fetchToken(): Promise<string | null> {
  const res = await fetch("/api/auth/token", { credentials: "same-origin" });
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as { token?: string } | null;
  const token = body?.token;
  if (!token) return null;
  cached = { token, exp: jwtExp(token) };
  return token;
}

export async function getAdminToken(): Promise<string | null> {
  if (cached && cached.exp - REFRESH_EARLY_SEC > Date.now() / 1000) {
    return cached.token;
  }
  inFlight ??= fetchToken().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

// Drop the cached JWT (sign-out, or FastAPI rejected it).
export function forgetAdminToken() {
  cached = null;
}

function jwtExp(token: string): number {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return Number(JSON.parse(atob(part)).exp) || 0;
  } catch {
    return 0;
  }
}

export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  let res = await send(path, init);
  // A token can die early (clock skew, key rotation): fetch a fresh one once.
  if (res.status === 401) {
    forgetAdminToken();
    res = await send(path, init);
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      if (body?.detail) detail = body.detail;
    } catch {
      /* non-JSON body — keep statusText */
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

async function send(path: string, init: RequestInit): Promise<Response> {
  const token = await getAdminToken();
  if (!token) {
    throw new ApiError(401, "Not signed in");
  }
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`${ADMIN_API_BASE}${path}`, { ...init, headers });
}

export { ApiError };
