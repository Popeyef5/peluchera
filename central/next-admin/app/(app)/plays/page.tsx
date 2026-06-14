"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
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

type Prize = {
  win_id: string;
  win_status: string;
  prize_kind: string;
  resell_price_cents: number;
  expires_at: string | null;
  label: string;
  sku?: string | null;
  card?: { set: string; number: string; rarity: string; image_url: string };
};

type Play = {
  id: number;
  address: string | null;
  status: string;
  created_at: string | null;
  played_at: string | null;
  ended_at: string | null;
  onchain_win: boolean;
  outcome: "won" | "lost" | "cancelled" | "in_progress";
  prize: Prize | null;
};

export default function PlaysPage() {
  const [plays, setPlays] = useState<Play[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await apiFetch<{ plays: Play[] }>("/admin/plays");
      setPlays(r.plays);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      setPlays([]);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const wins = plays?.filter((p) => p.outcome === "won").length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Plays</h1>
          <p className="text-sm text-muted-foreground">
            Turn history — who played, won or lost, and the prize on a win.
          </p>
        </div>
        <Button variant="outline" onClick={refresh}>
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {plays === null
              ? "Loading…"
              : `${plays.length} plays · ${wins} won`}
          </CardTitle>
          {error && (
            <CardDescription className="text-destructive">
              {error}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {plays && plays.length === 0 && !error ? (
            <p className="text-sm text-muted-foreground">No plays yet.</p>
          ) : (
            plays && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Player</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead>Prize</TableHead>
                    <TableHead>Settlement</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plays.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {fmt(p.played_at ?? p.created_at)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {p.address ? shortAddr(p.address) : "—"}
                      </TableCell>
                      <TableCell>
                        <OutcomePill outcome={p.outcome} />
                      </TableCell>
                      <TableCell>
                        {p.prize ? (
                          <PrizeCell prize={p.prize} />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {p.prize ? (
                          <WinStatusPill value={p.prize.win_status} />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PrizeCell({ prize }: { prize: Prize }) {
  return (
    <div className="flex items-center gap-2">
      {prize.card?.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={prize.card.image_url}
          alt=""
          className="h-8 w-8 rounded object-cover"
        />
      ) : null}
      <div className="leading-tight">
        <div className="text-sm">{prize.label}</div>
        <div className="text-xs text-muted-foreground">
          {prize.prize_kind === "SINGLE_CARD" ? "card" : "booster pair"} ·{" "}
          {dollars(prize.resell_price_cents)} buyback
        </div>
      </div>
    </div>
  );
}

function OutcomePill({ outcome }: { outcome: Play["outcome"] }) {
  const map: Record<Play["outcome"], [string, string]> = {
    won: ["Won", "bg-green-100 text-green-900"],
    lost: ["Lost", "bg-secondary text-secondary-foreground"],
    cancelled: ["Cancelled", "bg-red-100 text-red-900"],
    in_progress: ["In progress", "bg-yellow-100 text-yellow-900"],
  };
  const [label, style] = map[outcome];
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${style}`}
    >
      {label}
    </span>
  );
}

function WinStatusPill({ value }: { value: string }) {
  const pending = value === "PENDING";
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs ${
        pending
          ? "bg-yellow-100 text-yellow-900"
          : value === "EXPIRED"
            ? "bg-red-100 text-red-900"
            : "bg-green-100 text-green-900"
      }`}
    >
      {value.replace("SETTLED_", "")}
    </span>
  );
}

function shortAddr(a: string) {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

function fmt(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function dollars(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}
