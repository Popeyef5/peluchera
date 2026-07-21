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

type Versions = {
  vps_proto: number;
  pi_proto: number | null;
  esp_proto: number | null;
  esp_fw: string | null;
  pi_fw: string | null;
  pi_vps_ok: boolean;
  esp_pi_ok: boolean;
};

type CabinetStatus = {
  pi_connected: boolean;
  current_player: string | null;
  queue_length: number;
  cabinet_fault: { kind: string; reason: string | null } | null;
  version_fault: { kind: string; problems: string[] } | null;
  inventory_fault: { kind: string; reason?: string | null } | null;
  versions?: Versions;
};

type EspHealth = {
  ok: boolean;
  esp: {
    connected: boolean;
    fw: string | null;
    latched_fault: string | null;
    ping_ok: boolean;
  };
  central_connected: boolean;
};

type TestResult = {
  outcome: string;
  ball_serial?: string | null;
  fault_kind?: string | null;
  detail?: string;
};

export default function OpsPage() {
  const [status, setStatus] = useState<CabinetStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [voidOpen, setVoidOpen] = useState(false);
  const [esp, setEsp] = useState<EspHealth | null>(null);
  const [espMsg, setEspMsg] = useState<string | null>(null);
  const [checkingEsp, setCheckingEsp] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testMsg, setTestMsg] = useState<string | null>(null);

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

  const checkEsp = async () => {
    setCheckingEsp(true);
    setEspMsg(null);
    try {
      setEsp(await apiFetch<EspHealth>("/admin/cabinet/esp"));
    } catch (e) {
      setEsp(null);
      setEspMsg(e instanceof ApiError ? e.message : String(e));
    } finally {
      setCheckingEsp(false);
    }
  };

  const runTestWin = async () => {
    setTesting(true);
    setTestResult(null);
    setTestMsg(null);
    try {
      const r = await apiFetch<{ ok: boolean; result: TestResult }>(
        "/admin/cabinet/test-arm",
        { method: "POST" },
      );
      setTestResult(r.result);
    } catch (e) {
      setTestMsg(e instanceof ApiError ? e.message : String(e));
    } finally {
      setTesting(false);
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
          <CardTitle className="text-base">Protocol chain</CardTitle>
          <CardDescription>
            Each link must speak the same integer. A mismatch pauses the queue
            until the lagging piece is redeployed (VPS/Pi) or reflashed (ESP).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ProtocolChain status={status} />
          {status?.version_fault && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-900">
              <p className="font-medium">Version mismatch — queue paused</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {status.version_fault.problems?.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Chute ESP</CardTitle>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={checkingEsp || testing}
                onClick={checkEsp}
              >
                {checkingEsp ? "Checking…" : "Check status"}
              </Button>
              <Button
                size="sm"
                disabled={testing || checkingEsp}
                onClick={runTestWin}
              >
                {testing ? "Arming — drop now…" : "Test win (drop a ball)"}
              </Button>
            </div>
          </div>
          {espMsg && (
            <CardDescription className="text-destructive">
              {espMsg}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {testMsg && (
            <p className="mb-3 text-sm text-destructive">{testMsg}</p>
          )}
          {testing && (
            <p className="mb-3 text-sm">
              Chute armed —{" "}
              <span className="font-medium text-foreground">
                drop a ball into the chute now
              </span>
              . Waiting for the ESP (entry → RFID → solenoid → exit)…
            </p>
          )}
          {testResult && !testing && (
            <div className="mb-3 rounded-md border p-3">
              <div className="flex items-center gap-2">
                <TestOutcomePill outcome={testResult.outcome} />
                {testResult.ball_serial && (
                  <span className="font-mono text-xs">
                    {testResult.ball_serial}
                  </span>
                )}
              </div>
              {testResult.detail && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {testResult.detail}
                </p>
              )}
            </div>
          )}
          {esp === null ? (
            <p className="text-sm text-muted-foreground">
              Probe the firmware over the serial link (live ping) — link state,
              version, and any latched fault.
            </p>
          ) : (
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="ESP link">
                <Dot ok={esp.esp.connected} />
                {esp.esp.connected ? "connected" : "offline"}
              </Stat>
              <Stat label="Ping">
                <Dot ok={esp.esp.ping_ok} />
                {esp.esp.ping_ok ? "responsive" : "no reply"}
              </Stat>
              <Stat label="Firmware">
                <span className="font-mono text-xs">{esp.esp.fw ?? "—"}</span>
              </Stat>
              <Stat label="Latched fault">
                {esp.esp.latched_fault ? (
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-900">
                    {esp.esp.latched_fault}
                  </span>
                ) : (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-900">
                    none
                  </span>
                )}
              </Stat>
            </dl>
          )}
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
            disabled={busy !== null || (!faulted && !esp?.esp.latched_fault)}
            onClick={async () => {
              await action("/admin/cabinet/clear_fault", "Clear fault");
              checkEsp();
            }}
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

function ProtocolChain({ status }: { status: CabinetStatus | null }) {
  const v = status?.versions;
  if (!v) {
    return (
      <p className="text-sm text-muted-foreground">
        No protocol snapshot yet — waiting for the Pi handshake.
      </p>
    );
  }
  // The ESP/Pi numbers only mean something while the Pi link is up; on
  // disconnect the backend nulls them, so gate on live connectivity too.
  const online = !!status?.pi_connected && v.pi_proto != null;
  return (
    <div className="flex items-stretch gap-1 sm:gap-2">
      <ChainNode label="VPS" proto={v.vps_proto} known />
      <ChainLink ok={v.pi_vps_ok} known={online} />
      <ChainNode label="Pi" proto={online ? v.pi_proto : null} sub={online ? v.pi_fw : null} known={online} />
      <ChainLink ok={v.esp_pi_ok} known={online} />
      <ChainNode label="ESP" proto={online ? v.esp_proto : null} sub={online ? v.esp_fw : null} known={online} />
    </div>
  );
}

function ChainNode({
  label,
  proto,
  sub,
  known,
}: {
  label: string;
  proto: number | null;
  sub?: string | null;
  known: boolean;
}) {
  return (
    <div className="flex min-w-[60px] flex-col items-center justify-center rounded-md border px-3 py-2 text-center">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="font-mono text-sm">
        {known && proto != null ? `v${proto}` : "—"}
      </span>
      {sub && (
        <span className="max-w-[88px] truncate font-mono text-[10px] text-muted-foreground">
          {sub}
        </span>
      )}
    </div>
  );
}

function ChainLink({ ok, known }: { ok: boolean; known: boolean }) {
  const state = !known ? "unknown" : ok ? "ok" : "bad";
  const bar =
    state === "ok"
      ? "bg-green-500"
      : state === "bad"
        ? "bg-red-500"
        : "bg-muted-foreground/30";
  const label = state === "ok" ? "match" : state === "bad" ? "mismatch" : "—";
  return (
    <div className="flex min-w-[44px] flex-1 flex-col items-center justify-center gap-1">
      <div className={`h-0.5 w-full ${bar}`} />
      <span
        className={`text-[10px] ${state === "bad" ? "font-medium text-red-700" : "text-muted-foreground"}`}
      >
        {label}
      </span>
    </div>
  );
}

function TestOutcomePill({ outcome }: { outcome: string }) {
  const style =
    outcome === "prize_won"
      ? "bg-green-100 text-green-900"
      : outcome === "no_fall"
        ? "bg-secondary text-secondary-foreground"
        : "bg-red-100 text-red-900";
  const label =
    outcome === "prize_won"
      ? "WIN — grabbed"
      : outcome === "no_fall"
        ? "no ball detected"
        : outcome;
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${style}`}
    >
      {label}
    </span>
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
