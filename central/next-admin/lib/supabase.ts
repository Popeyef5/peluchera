"use client";

import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Singleton client — Supabase's createClient is cheap but we want a stable
// reference so React effects don't re-subscribe to auth state changes on
// every render.
let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY — see .env.admin.example",
    );
  }
  _client = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // Disable URL hash detection — we use email/password only, no OAuth
      // redirect handling that would benefit from it.
      detectSessionInUrl: false,
    },
  });
  return _client;
}
