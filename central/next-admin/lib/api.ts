"use client";

import { getSupabase } from "./supabase";

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

export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const supabase = getSupabase();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new ApiError(401, "Not signed in");
  }
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${ADMIN_API_BASE}${path}`, { ...init, headers });
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

export { ApiError };
