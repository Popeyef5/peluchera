"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import type { Session } from "@supabase/supabase-js";

// Gate every protected page behind a valid Supabase session. Renders nothing
// while resolving so we never flash protected UI before the redirect.
export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [resolved, setResolved] = useState(false);
  const [session, setSession] = useState<Session | null>(null);

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

  useEffect(() => {
    if (resolved && !session && pathname !== "/login") {
      router.replace("/login");
    }
  }, [resolved, session, pathname, router]);

  if (!resolved) return null;
  if (!session) return null;
  return <>{children}</>;
}
