"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { apiFetch, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Once there's a session (email/password OR an OAuth redirect back to here),
  // confirm the identity is actually an authorized operator before forwarding —
  // the backend allow-list is the real gate, /whoami 403s if not allowed.
  const verifyAndForward = useCallback(async () => {
    try {
      await apiFetch("/admin/whoami");
      router.replace("/balls");
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        await getSupabase().auth.signOut();
        setError("This account isn't authorized for admin access.");
      } else if (!(e instanceof ApiError && e.status === 401)) {
        setError(e instanceof ApiError ? e.message : String(e));
      }
    }
  }, [router]);

  // Fires INITIAL_SESSION on mount (covers an existing session and the OAuth
  // return) and SIGNED_IN after login.
  useEffect(() => {
    const { data: sub } = getSupabase().auth.onAuthStateChange((_event, session) => {
      if (session) verifyAndForward();
    });
    return () => sub.subscription.unsubscribe();
  }, [verifyAndForward]);

  // Surface the "bounced by RequireAuth" case (?denied=1).
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("denied")) {
      setError("This account isn't authorized for admin access.");
    }
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const { error } = await getSupabase().auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (error) {
      setError(error.message);
      return;
    }
    await verifyAndForward();
  };

  const onGoogle = async () => {
    setError(null);
    const { error } = await getSupabase().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/login` },
    });
    if (error) setError(error.message);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>Garra admin console</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={onGoogle}
          >
            Continue with Google
          </Button>

          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">or</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <form onSubmit={onSubmit} className="space-y-3">
            <Input
              type="email"
              placeholder="email@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              autoComplete="email"
            />
            <Input
              type="password"
              placeholder="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
