"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { apiFetch, ApiError } from "@/lib/api";
import type { Session } from "@supabase/supabase-js";

// Gate every protected page behind (1) a valid Supabase session AND (2) an
// authorized operator identity. The second check matters once OAuth login is on:
// a valid session no longer implies admin rights — the backend allow-list does.
// Renders nothing while resolving so we never flash protected UI.
export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [resolved, setResolved] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [authorized, setAuthorized] = useState<boolean | null>(null);

  useEffect(() => {
    const supabase = getSupabase();
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setResolved(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      if (!mounted) return;
      setSession(s);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // No session → bounce to login.
  useEffect(() => {
    if (resolved && !session && pathname !== "/login") {
      router.replace("/login");
    }
  }, [resolved, session, pathname, router]);

  // Session present → verify it's an authorized operator (backend allow-list).
  // A signed-in identity that isn't allowed is signed out and bounced with a
  // reason, so social login can't grant admin to just any Google account.
  useEffect(() => {
    if (!resolved || !session) {
      setAuthorized(null);
      return;
    }
    let mounted = true;
    apiFetch("/admin/whoami")
      .then(() => {
        if (mounted) setAuthorized(true);
      })
      .catch((e) => {
        if (!mounted) return;
        if (e instanceof ApiError && e.status === 403) {
          setAuthorized(false);
          getSupabase().auth.signOut();
          router.replace("/login?denied=1");
        } else {
          // transient/network error — don't lock out a valid operator
          setAuthorized(true);
        }
      });
    return () => {
      mounted = false;
    };
  }, [resolved, session, router]);

  if (!resolved) return null;
  if (!session) return null;
  if (authorized !== true) return null; // verifying, or denied (redirecting)
  return <>{children}</>;
}
