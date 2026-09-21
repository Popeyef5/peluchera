"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { authClient } from "@/lib/auth";
import { apiFetch, ApiError, forgetAdminToken } from "@/lib/api";

// Gate every protected page behind (1) a Neon Auth session AND (2) an
// authorized operator identity. Sign-up is open on Neon Auth, so a session
// never implies admin rights — the backend allow-list does.
// Renders nothing while resolving so we never flash protected UI.
export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: session, isPending } = authClient.useSession();
  const userId = session?.user?.id ?? null;
  const [authorized, setAuthorized] = useState<boolean | null>(null);

  // No session → bounce to login. Also covers sign-out in another tab.
  useEffect(() => {
    if (!isPending && !userId && pathname !== "/login") {
      router.replace("/login");
    }
  }, [isPending, userId, pathname, router]);

  // Session present → verify it's an authorized operator (backend allow-list).
  // A signed-in identity that isn't allowed is signed out and bounced with a
  // reason, so Google login can't grant admin to just any Google account.
  useEffect(() => {
    if (!userId) {
      setAuthorized(null);
      return;
    }
    let mounted = true;
    apiFetch("/admin/whoami")
      .then(() => {
        if (mounted) setAuthorized(true);
      })
      .catch(async (e) => {
        if (!mounted) return;
        if (e instanceof ApiError && e.status === 403) {
          setAuthorized(false);
          await authClient.signOut();
          forgetAdminToken();
          router.replace("/login?denied=1");
        } else {
          // transient/network error — don't lock out a valid operator
          setAuthorized(true);
        }
      });
    return () => {
      mounted = false;
    };
  }, [userId, router]);

  if (isPending || !userId) return null;
  if (authorized !== true) return null; // verifying, or denied (redirecting)
  return <>{children}</>;
}
