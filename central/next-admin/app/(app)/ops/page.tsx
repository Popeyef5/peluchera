"use client";

import { useCallback, useEffect, useState } from "react";
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
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type CabinetStatus = {
  pi_connected: boolean;
  current_player: string | null;
  queue_length: number;
  cabinet_fault: { kind: string; reason: string | null } | null;
};

export default function OpsPage() {
  const [status, setStatus] = useState<CabinetStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [voidOpen, setVoidOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await apiFetch<CabinetStatus>("/admin/cabinet/status");
      setStatus(r);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }, []);

  // Poll every 3s so the panel feels live without a websocket.
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [refresh]);

  const action = async (path: string, label: string) => {
    setBusy(label);
    setError(null);
    setToast(null);
    try {
      await apiFetch(path, { method: "POST" });
      setToast(`${label} OK`);
      refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const faulted = status?.cabinet_fault != null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Cabinet</h1>
        <p className="text-sm text-muted-foreground">
          Live Pi/ESP status and operator overrides.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Status</CardTitle>
          {error && (
            <CardDescription className="text-destructive">
              {error}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Pi link">
              <Dot ok={!!status?.pi_connected} />
              {status?.pi_connected ? "connected" : "offline"}
            </Stat>
            <Stat label="Current player">
              <span className="font-mono text-xs">
                {status?.current_player
                  ? `${status.current_player.slice(0, 6)}…${status.current_player.slice(-4)}`
                  : "—"}
              </span>
            </Stat>
            <Stat label="Queue">{status?.queue_length ?? "—"}</Stat>
            <Stat label="Chute fault">
              {faulted ? (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-900">
                  {status!.cabinet_fault!.kind}
                </span>
              ) : (
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-900">
                  none
                </span>
              )}
            </Stat>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Actions</CardTitle>
          <CardDescription>
            {toast ? (
              <span className="text-green-700">{toast}</span>
            ) : (
              "Overrides take effect on the live cabinet."
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={busy !== null || !faulted}
            onClick={() => action("/admin/cabinet/clear_fault", "Clear fault")}
          >
            {busy === "Clear fault" ? "Clearing…" : "Clear fault"}
          </Button>
          <Button
            variant="outline"
            disabled={busy !== null || !status?.current_player}
            onClick={() =>
              action("/admin/queue/force_turn_end", "Force turn end")
            }
          >
            {busy === "Force turn end" ? "Ending…" : "Force turn end"}
          </Button>
          <Button
            variant="outline"
            disabled={busy !== null}
            onClick={() => setVoidOpen(true)}
          >
            Void ball…
          </Button>
        </CardContent>
      </Card>

      <VoidDialog
        open={voidOpen}
        onClose={() => setVoidOpen(false)}
        onDone={() => {
          setVoidOpen(false);
          setToast("Ball voided OK");
        }}
      />
    </div>
  );
}

function Stat({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="flex items-center gap-2 text-sm">{children}</dd>
    </div>
  );
}

function Dot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${ok ? "bg-green-500" : "bg-red-500"}`}
    />
  );
}

function VoidDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [serial, setSerial] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setSerial("");
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch(`/admin/balls/${encodeURIComponent(serial)}/void`, {
        method: "POST",
      });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <form onSubmit={submit}>
        <DialogHeader>
          <DialogTitle>Void ball</DialogTitle>
          <DialogDescription>
            Releases the ball&apos;s bound prize back to the pool and marks it
            VOIDED. Only works on a LOADED ball.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-sm font-medium">Ball serial</label>
            <Input
              value={serial}
              onChange={(e) => setSerial(e.target.value)}
              placeholder="E007000012345601"
              autoFocus
              required
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="destructive" disabled={submitting || !serial}>
            {submitting ? "Voiding…" : "Void"}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
