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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Ball = {
  id: string;
  serial: string;
  status: string;
  prize_kind: string;
  opened_booster_id: string | null;
  opened_booster_sku: string | null;
  prize_card_id: string | null;
};

type OpenedBooster = {
  id: string;
  sku: string;
  status: string;
  video_url: string;
  filmed_at: string | null;
};

export default function BallsPage() {
  const [balls, setBalls] = useState<Ball[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bindOpen, setBindOpen] = useState(false);
  const [enrollOpen, setEnrollOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await apiFetch<{ balls: Ball[] }>("/admin/balls");
      setBalls(r.balls);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      setBalls([]);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Balls</h1>
          <p className="text-sm text-muted-foreground">
            Physical tags and their current OpenedBooster binding.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setEnrollOpen(true)}>
            Add ball physically
          </Button>
          <Button onClick={() => setBindOpen(true)}>Bind tag</Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {balls === null ? "Loading…" : `${balls.length} balls`}
          </CardTitle>
          {error && (
            <CardDescription className="text-destructive">
              {error}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {balls && balls.length === 0 && !error ? (
            <p className="text-sm text-muted-foreground">
              No balls yet. Click "Bind tag" to add one, or run the seed
              script in fastapi (see README) for a starter set.
            </p>
          ) : (
            balls && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Serial</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Prize</TableHead>
                    <TableHead>Bound SKU</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {balls.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell className="font-mono">{b.serial}</TableCell>
                      <TableCell>
                        <StatusPill value={b.status} />
                      </TableCell>
                      <TableCell>{b.prize_kind}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {b.opened_booster_sku ??
                          (b.prize_card_id ? "—" : "(unbound)")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )
          )}
        </CardContent>
      </Card>

      <BindDialog
        open={bindOpen}
        onClose={() => setBindOpen(false)}
        onBound={() => {
          setBindOpen(false);
          refresh();
        }}
      />

      <EnrollDialog
        open={enrollOpen}
        onClose={() => setEnrollOpen(false)}
        onCreated={() => {
          setEnrollOpen(false);
          refresh();
        }}
      />
    </div>
  );
}

function StatusPill({ value }: { value: string }) {
  const style =
    value === "LOADED"
      ? "bg-green-100 text-green-900"
      : value === "GRABBED"
        ? "bg-yellow-100 text-yellow-900"
        : value === "VOIDED"
          ? "bg-red-100 text-red-900"
          : "bg-secondary text-secondary-foreground";
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs ${style}`}>
      {value}
    </span>
  );
}

type EnrollStatus =
  | { status: "idle" }
  | { status: "waiting"; remaining_seconds: number }
  | { status: "scanned"; ball_serial: string }
  | { status: "timeout" };

function EnrollDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  // Phases:
  //  - "armed": dialog open, no /enroll/start sent yet; "Start scan" button.
  //  - "waiting": /enroll/start sent, polling /enroll/status for a tag.
  //  - "scanned": tag captured; "Save to DB" button posts /admin/balls.
  //  - "timeout": window elapsed without a tag.
  //  - "error": something went wrong (start refused, save failed, etc.).
  const [phase, setPhase] = useState<
    "armed" | "waiting" | "scanned" | "timeout" | "error"
  >("armed");
  const [remaining, setRemaining] = useState<number | null>(null);
  const [scanned, setScanned] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Reset on close so a fresh open starts in the armed phase.
  useEffect(() => {
    if (open) return;
    setPhase("armed");
    setRemaining(null);
    setScanned(null);
    setError(null);
    setSaving(false);
  }, [open]);

  // Poll /enroll/status while waiting. 500ms is snappy enough to feel live
  // without hammering the API; the window is only 10s so this is at most
  // ~20 requests per enrollment.
  useEffect(() => {
    if (phase !== "waiting") return;
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await apiFetch<EnrollStatus>("/admin/balls/enroll/status");
        if (cancelled) return;
        if (r.status === "waiting") setRemaining(r.remaining_seconds);
        else if (r.status === "scanned") {
          setScanned(r.ball_serial);
          setPhase("scanned");
        } else if (r.status === "timeout") {
          setPhase("timeout");
        } else if (r.status === "idle") {
          // Backend cleared it on us — treat as a timeout/cancel.
          setPhase("timeout");
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof ApiError ? e.message : String(e));
        setPhase("error");
      }
    };
    const id = setInterval(tick, 500);
    tick();
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [phase]);

  const startScan = async () => {
    setError(null);
    try {
      const r = await apiFetch<{ ok: boolean; timeout_ms: number }>(
        "/admin/balls/enroll/start",
        { method: "POST" },
      );
      setRemaining(Math.ceil(r.timeout_ms / 1000));
      setPhase("waiting");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      setPhase("error");
    }
  };

  const save = async () => {
    if (!scanned) return;
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/admin/balls", {
        method: "POST",
        body: JSON.stringify({ serial: scanned }),
      });
      onCreated();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      setSaving(false);
    }
  };

  const cancel = async () => {
    if (phase === "waiting") {
      try {
        await apiFetch("/admin/balls/enroll/cancel", { method: "POST" });
      } catch {
        // ignore — closing the dialog is the user's intent regardless.
      }
    }
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && cancel()}>
      <DialogHeader>
        <DialogTitle>Add ball physically</DialogTitle>
        <DialogDescription>
          Open a 10-second window where the next tag presented to the
          antenna will be captured. Cabinet must be idle (no current
          player, queue empty).
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3">
        {phase === "armed" && (
          <p className="text-sm text-muted-foreground">
            Press <span className="font-medium text-foreground">Start scan</span>{" "}
            when ready.
          </p>
        )}
        {phase === "waiting" && (
          <div className="space-y-2 text-center">
            <p className="text-sm">Waiting for tag…</p>
            <p className="font-mono text-3xl tabular-nums">
              {remaining ?? "—"}s
            </p>
          </div>
        )}
        {phase === "scanned" && scanned && (
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Scanned tag:</p>
            <p className="font-mono text-lg">{scanned}</p>
          </div>
        )}
        {phase === "timeout" && (
          <p className="text-sm text-destructive">
            No tag detected within the window.
          </p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      <DialogFooter>
        {phase === "armed" && (
          <>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" onClick={startScan}>
              Start scan
            </Button>
          </>
        )}
        {phase === "waiting" && (
          <Button type="button" variant="outline" onClick={cancel}>
            Cancel
          </Button>
        )}
        {phase === "scanned" && (
          <>
            <Button type="button" variant="outline" onClick={cancel}>
              Discard
            </Button>
            <Button type="button" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save to DB"}
            </Button>
          </>
        )}
        {(phase === "timeout" || phase === "error") && (
          <>
            <Button type="button" variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button type="button" onClick={() => setPhase("armed")}>
              Try again
            </Button>
          </>
        )}
      </DialogFooter>
    </Dialog>
  );
}

function BindDialog({
  open,
  onClose,
  onBound,
}: {
  open: boolean;
  onClose: () => void;
  onBound: () => void;
}) {
  const [serial, setSerial] = useState("");
  const [obId, setObId] = useState("");
  const [obs, setObs] = useState<OpenedBooster[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch bindable OpenedBoosters when the dialog opens (cheap, fine to
  // refetch each time so a binding made in another tab is reflected).
  useEffect(() => {
    if (!open) {
      setSerial("");
      setObId("");
      setError(null);
      return;
    }
    apiFetch<{ opened_boosters: OpenedBooster[] }>(
      "/admin/inventory/opened-boosters?bindable=true",
    )
      .then((r) => setObs(r.opened_boosters))
      .catch((e) => setError(e instanceof ApiError ? e.message : String(e)));
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch(`/admin/balls/${encodeURIComponent(serial)}/bind`, {
        method: "POST",
        body: JSON.stringify({ opened_booster_id: obId }),
      });
      onBound();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <form onSubmit={submit}>
        <DialogHeader>
          <DialogTitle>Bind tag</DialogTitle>
          <DialogDescription>
            Scan or type a tag UID, then pick an OpenedBooster to bind.
            Creates a new Ball if the serial is new, or rebinds an existing
            one if it's already settled / voided.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-sm font-medium">Tag UID</label>
            <Input
              value={serial}
              onChange={(e) => setSerial(e.target.value)}
              placeholder="BALL-B007"
              autoFocus
              required
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">OpenedBooster</label>
            <select
              value={obId}
              onChange={(e) => setObId(e.target.value)}
              required
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="" disabled>
                {obs === null
                  ? "Loading…"
                  : obs.length === 0
                    ? "(no bindable OpenedBoosters)"
                    : "Choose one…"}
              </option>
              {obs?.map((ob) => (
                <option key={ob.id} value={ob.id}>
                  {ob.sku} — {ob.id.slice(0, 8)}…
                </option>
              ))}
            </select>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting || !serial || !obId}>
            {submitting ? "Binding…" : "Bind"}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
