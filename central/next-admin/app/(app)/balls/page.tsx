"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { Help } from "@/components/HelpTip";
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
  closed_booster_sku: string | null;
  prize_card_id: string | null;
  prize_card_sku: string | null;
};

type OpenedBooster = {
  id: string;
  sku: string;
  status: string;
  video_url: string;
  filmed_at: string | null;
};

type CardRow = {
  id: string;
  set: string;
  number: string;
  rarity: string;
  status: string;
};

export default function BallsPage() {
  const [balls, setBalls] = useState<Ball[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bindOpen, setBindOpen] = useState(false);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [voiding, setVoiding] = useState<string | null>(null);
  const [hideVoided, setHideVoided] = useState(true);

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

  const voidBall = async (serial: string) => {
    setVoiding(serial);
    setError(null);
    try {
      await apiFetch(`/admin/balls/${encodeURIComponent(serial)}/void`, {
        method: "POST",
      });
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setVoiding(null);
    }
  };

  const voidedCount = balls?.filter((b) => b.status === "VOIDED").length ?? 0;
  const visible = (balls ?? []).filter(
    (b) => !hideVoided || b.status !== "VOIDED",
  );

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            Balls
            <Help term="ball-status" />
          </h1>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            Physical tags and their current prize binding.
            <Help term="bind" />
            <Help term="void" />
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setEnrollOpen(true)}>
            Add ball physically
          </Button>
          <Button onClick={() => setBindOpen(true)}>Bind</Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">
              {balls === null
                ? "Loading…"
                : `${visible.length} balls${
                    hideVoided && voidedCount
                      ? ` · ${voidedCount} voided hidden`
                      : ""
                  }`}
            </CardTitle>
            <label className="flex cursor-pointer items-center gap-2 text-sm font-normal text-muted-foreground">
              <input
                type="checkbox"
                checked={hideVoided}
                onChange={(e) => setHideVoided(e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              Hide voided
            </label>
          </div>
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
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell className="font-mono">{b.serial}</TableCell>
                      <TableCell>
                        <StatusPill value={b.status} />
                      </TableCell>
                      <TableCell>{b.prize_kind}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {b.opened_booster_sku ??
                          b.closed_booster_sku ??
                          b.prize_card_sku ??
                          (b.prize_card_id ? "(card)" : "(unbound)")}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={b.status !== "LOADED" || voiding === b.serial}
                          onClick={() => voidBall(b.serial)}
                        >
                          {voiding === b.serial ? "Voiding…" : "Void"}
                        </Button>
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

// A searchable single-select: a filter box over a scrollable option list.
function SearchSelect({
  options,
  value,
  onChange,
  placeholder,
  empty,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  empty: string;
}) {
  const [q, setQ] = useState("");
  const filtered = options.filter((o) =>
    o.label.toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <div className="space-y-1">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} />
      <div className="max-h-40 overflow-y-auto rounded-md border">
        {options.length === 0 ? (
          <div className="px-3 py-2 text-sm text-muted-foreground">{empty}</div>
        ) : filtered.length === 0 ? (
          <div className="px-3 py-2 text-sm text-muted-foreground">No matches</div>
        ) : (
          filtered.map((o) => (
            <button
              type="button"
              key={o.value}
              onClick={() => onChange(o.value)}
              className={
                "block w-full px-3 py-2 text-left text-sm hover:bg-accent " +
                (o.value === value ? "bg-accent font-medium" : "")
              }
            >
              {o.label}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

type BindKind = "BOOSTER_PAIR" | "CLOSED_BOOSTER" | "SINGLE_CARD";
type ClosedBoosterRow = {
  sku: string;
  name: string | null;
  in_stock: boolean;
  is_complete: boolean;
};
type CardTypeRow = { sku: string; name: string | null; is_complete: boolean };
type BindableBall = { serial: string; status: string };

// One bind flow for all three prize kinds. Pick a ball (an existing free one or
// a freshly scanned tag), choose the prize kind, then search-pick the target.
function BindDialog({
  open,
  onClose,
  onBound,
}: {
  open: boolean;
  onClose: () => void;
  onBound: () => void;
}) {
  const [ballMode, setBallMode] = useState<"existing" | "scan">("existing");
  const [serial, setSerial] = useState("");
  const [kind, setKind] = useState<BindKind>("BOOSTER_PAIR");
  const [target, setTarget] = useState(""); // ob id / closed sku / card-type sku

  const [freeBalls, setFreeBalls] = useState<BindableBall[] | null>(null);
  const [obs, setObs] = useState<OpenedBooster[]>([]);
  const [closed, setClosed] = useState<ClosedBoosterRow[]>([]);
  const [cardTypes, setCardTypes] = useState<CardTypeRow[]>([]);

  // Scan sub-flow (reuses the enroll scanner used by "Add ball physically").
  const [scanning, setScanning] = useState(false);
  const [scanErr, setScanErr] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setBallMode("existing");
      setSerial("");
      setKind("BOOSTER_PAIR");
      setTarget("");
      setError(null);
      setScanning(false);
      setScanErr(null);
      return;
    }
    // Load everything the picker needs.
    Promise.all([
      apiFetch<{ balls: BindableBall[] }>("/admin/balls/bindable"),
      apiFetch<{ opened_boosters: OpenedBooster[] }>(
        "/admin/inventory/opened-boosters?bindable=true",
      ),
      apiFetch<{ closed_boosters: ClosedBoosterRow[] }>("/admin/inventory/closed-boosters"),
      apiFetch<{ card_types: CardTypeRow[] }>("/admin/inventory/card-types"),
    ])
      .then(([b, o, c, ct]) => {
        setFreeBalls(b.balls);
        setObs(o.opened_boosters);
        setClosed(c.closed_boosters.filter((x) => x.is_complete && x.in_stock));
        setCardTypes(ct.card_types.filter((x) => x.is_complete));
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : String(e)));
  }, [open]);

  // Reset the chosen target when the kind changes (options differ per kind).
  useEffect(() => setTarget(""), [kind]);

  // Poll the enroll scanner while scanning; adopt the scanned serial.
  useEffect(() => {
    if (!scanning) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await apiFetch<{
          status: string;
          ball_serial?: string;
        }>("/admin/balls/enroll/status");
        if (cancelled) return;
        if (r.status === "scanned" && r.ball_serial) {
          setSerial(r.ball_serial);
          setScanning(false);
        } else if (r.status === "timeout" || r.status === "idle") {
          setScanErr("Scan timed out — try again.");
          setScanning(false);
        }
      } catch (e) {
        if (cancelled) return;
        setScanErr(e instanceof ApiError ? e.message : String(e));
        setScanning(false);
      }
    };
    const id = setInterval(tick, 500);
    tick();
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [scanning]);

  const startScan = async () => {
    setScanErr(null);
    setSerial("");
    try {
      await apiFetch("/admin/balls/enroll/start", { method: "POST" });
      setScanning(true);
    } catch (e) {
      setScanErr(e instanceof ApiError ? e.message : String(e));
    }
  };

  const targetOptions =
    kind === "BOOSTER_PAIR"
      ? obs.map((o) => ({ value: o.id, label: `${o.sku} — ${o.id.slice(0, 8)}…` }))
      : kind === "CLOSED_BOOSTER"
        ? closed.map((c) => ({ value: c.sku, label: `${c.sku}${c.name ? ` — ${c.name}` : ""}` }))
        : cardTypes.map((c) => ({ value: c.sku, label: `${c.sku}${c.name ? ` — ${c.name}` : ""}` }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const body: Record<string, string> = { serial, kind };
    if (kind === "BOOSTER_PAIR") body.opened_booster_id = target;
    else if (kind === "CLOSED_BOOSTER") body.closed_booster_sku = target;
    else body.card_type_sku = target;
    try {
      await apiFetch("/admin/balls/bind", {
        method: "POST",
        body: JSON.stringify(body),
      });
      onBound();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const KINDS: { key: BindKind; label: string }[] = [
    { key: "BOOSTER_PAIR", label: "Booster pair" },
    { key: "CLOSED_BOOSTER", label: "Closed booster" },
    { key: "SINGLE_CARD", label: "Card" },
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <form onSubmit={submit}>
        <DialogHeader>
          <DialogTitle>Bind a ball</DialogTitle>
          <DialogDescription>
            Pick a free ball (or scan a new tag), choose the prize kind, then
            search-pick the prize.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Ball */}
          <div className="space-y-1">
            <label className="text-sm font-medium">Ball</label>
            <div className="mb-2 flex gap-2 text-sm">
              <button
                type="button"
                onClick={() => setBallMode("existing")}
                className={`rounded-md border px-2 py-1 ${ballMode === "existing" ? "bg-accent font-medium" : ""}`}
              >
                Pick existing
              </button>
              <button
                type="button"
                onClick={() => setBallMode("scan")}
                className={`rounded-md border px-2 py-1 ${ballMode === "scan" ? "bg-accent font-medium" : ""}`}
              >
                Scan new tag
              </button>
            </div>

            {ballMode === "existing" ? (
              <SearchSelect
                options={(freeBalls ?? []).map((b) => ({
                  value: b.serial,
                  label: `${b.serial} · ${b.status}`,
                }))}
                value={serial}
                onChange={setSerial}
                placeholder="Search free balls…"
                empty={freeBalls === null ? "Loading…" : "No free balls — scan a new tag."}
              />
            ) : (
              <div className="space-y-2">
                {serial ? (
                  <p className="font-mono text-sm">
                    Scanned: <span className="font-semibold">{serial}</span>
                  </p>
                ) : (
                  <Button type="button" variant="outline" onClick={startScan} disabled={scanning}>
                    {scanning ? "Waiting for tag…" : "Start scan"}
                  </Button>
                )}
                {scanErr && <p className="text-sm text-destructive">{scanErr}</p>}
              </div>
            )}
          </div>

          {/* Prize kind */}
          <div className="space-y-1">
            <label className="text-sm font-medium">Prize</label>
            <div className="flex flex-wrap gap-2 text-sm">
              {KINDS.map((k) => (
                <button
                  type="button"
                  key={k.key}
                  onClick={() => setKind(k.key)}
                  className={`rounded-md border px-3 py-1 ${kind === k.key ? "bg-accent font-medium" : ""}`}
                >
                  {k.label}
                </button>
              ))}
            </div>
          </div>

          {/* Target */}
          <div className="space-y-1">
            <label className="text-sm font-medium">
              {kind === "BOOSTER_PAIR"
                ? "Opened booster"
                : kind === "CLOSED_BOOSTER"
                  ? "Closed booster (in stock)"
                  : "Card type"}
            </label>
            <SearchSelect
              options={targetOptions}
              value={target}
              onChange={setTarget}
              placeholder="Search…"
              empty="Nothing available — create/complete one first."
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting || !serial || !target}>
            {submitting ? "Binding…" : "Bind"}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
