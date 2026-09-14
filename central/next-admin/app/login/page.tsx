"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

// Seconds before "Resend code" re-enables. Supabase rate-limits auth emails
// hard (and answers 429), so this is about not burning the allowance on
// impatient clicking rather than about security.
const RESEND_COOLDOWN_SEC = 60;

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [submitting, setSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const codeInput = useRef<HTMLInputElement>(null);

  // Once there's a session (one-time code OR an OAuth redirect back to here),
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
  // return) and SIGNED_IN after a code is verified.
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

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const sendCode = async (resend = false) => {
    setSubmitting(true);
    setError(null);
    setNotice(null);
    const { error } = await getSupabase().auth.signInWithOtp({
      email,
      options: {
        // Do NOT provision an account for whoever asks. Without this, anyone
        // could mint a Supabase user in the project just by requesting a code
        // for an address. The backend allow-list would still refuse them, but
        // the user table and the email allowance are not theirs to spend.
        shouldCreateUser: false,
      },
    });
    setSubmitting(false);
    if (error) {
      // Deliberately neutral: don't confirm which addresses have accounts.
      setError("Could not send a code to that address.");
      return;
    }
    setStep("code");
    setCooldown(RESEND_COOLDOWN_SEC);
    setNotice(resend ? "New code sent." : "Check your email for a 6-digit code.");
    setTimeout(() => codeInput.current?.focus(), 0);
  };

  const onSubmitEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    await sendCode();
  };

  const onSubmitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const { error } = await getSupabase().auth.verifyOtp({
      email,
      token: code.trim(),
      type: "email",
    });
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

          {step === "email" ? (
            <form onSubmit={onSubmitEmail} className="space-y-3">
              <Input
                type="email"
                placeholder="email@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                autoComplete="email"
              />
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? "Sending…" : "Email me a code"}
              </Button>
            </form>
          ) : (
            <form onSubmit={onSubmitCode} className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Sent to <span className="font-medium">{email}</span>
              </p>
              <Input
                ref={codeInput}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                required
                autoComplete="one-time-code"
                className="text-center font-mono tracking-[0.4em]"
              />
              {notice && !error && (
                <p className="text-sm text-muted-foreground">{notice}</p>
              )}
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button
                type="submit"
                className="w-full"
                disabled={submitting || code.length < 6}
              >
                {submitting ? "Verifying…" : "Sign in"}
              </Button>
              <div className="flex items-center justify-between text-xs">
                <button
                  type="button"
                  className="text-muted-foreground underline-offset-2 hover:underline"
                  onClick={() => {
                    setStep("email");
                    setCode("");
                    setError(null);
                    setNotice(null);
                  }}
                >
                  Use a different email
                </button>
                <button
                  type="button"
                  className="text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
                  disabled={cooldown > 0 || submitting}
                  onClick={() => sendCode(true)}
                >
                  {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
                </button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
