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
import { cn } from "@/lib/utils";

type OpenedBooster = {
  id: string;
  sku: string;
  status: string;
  video_url: string;
  filmed_at: string | null;
};
type ClosedBooster = { sku: string; in_stock: boolean };
type CardRow = {
  id: string;
  set: string;
  number: string;
  rarity: string;
  status: string;
};

const RARITIES = [
  "COMMON",
  "UNCOMMON",
  "RARE",
  "HOLO_RARE",
  "ULTRA_RARE",
  "CHASE",
];

type Tab = "opened" | "closed" | "cards";
const TABS: { key: Tab; label: string }[] = [
  { key: "opened", label: "Opened boosters" },
  { key: "closed", label: "Closed boosters" },
  { key: "cards", label: "Cards" },
];

export default function InventoryPage() {
  const [tab, setTab] = useState<Tab>("opened");
  const [opened, setOpened] = useState<OpenedBooster[] | null>(null);
  const [closed, setClosed] = useState<ClosedBooster[] | null>(null);
  const [cards, setCards] = useState<CardRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [newOpen, setNewOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editCard, setEditCard] = useState<CardRow | null>(null);

  const toggleClosed = useCallback(
    async (sku: string, next: boolean) => {
      try {
        await apiFetch(`/admin/inventory/closed-boosters/${encodeURIComponent(sku)}`, {
          method: "PATCH",
          body: JSON.stringify({ in_stock: next }),
        });
        setClosed(
          (prev) =>
            prev?.map((c) => (c.sku === sku ? { ...c, in_stock: next } : c)) ??
            prev,
        );
      } catch (e) {
        setError(e instanceof ApiError ? e.message : String(e));
      }
    },
    [],
  );

  const refresh = useCallback(async () => {
    try {
      if (tab === "opened") {
        const r = await apiFetch<{ opened_boosters: OpenedBooster[] }>(
          "/admin/inventory/opened-boosters",
        );
        setOpened(r.opened_boosters);
      } else if (tab === "closed") {
        const r = await apiFetch<{ closed_boosters: ClosedBooster[] }>(
          "/admin/inventory/closed-boosters",
        );
        setClosed(r.closed_boosters);
      } else {
        const r = await apiFetch<{ cards: CardRow[] }>(
          "/admin/inventory/cards",
        );
        setCards(r.cards);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }, [tab]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const count =
    tab === "opened"
      ? opened?.length
      : tab === "closed"
        ? closed?.length
        : cards?.length;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Inventory</h1>
          <p className="text-sm text-muted-foreground">
            Opened/closed booster pools and the single-card pool.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            Import JSON
          </Button>
          <Button onClick={() => setNewOpen(true)}>New</Button>
        </div>
      </div>

      <nav className="flex items-center gap-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm transition-colors",
              tab === t.key
                ? "bg-secondary text-secondary-foreground"
                : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {count === undefined ? "Loading…" : `${count} rows`}
          </CardTitle>
          {error && (
            <CardDescription className="text-destructive">
              {error}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {tab === "opened" && opened && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Video</TableHead>
                  <TableHead>Filmed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {opened.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="font-mono">{o.sku}</TableCell>
                    <TableCell>
                      <StatusPill value={o.status} />
                    </TableCell>
                    <TableCell className="max-w-[16rem] truncate text-xs">
                      {o.video_url}
                    </TableCell>
                    <TableCell className="text-xs">
                      {o.filmed_at?.slice(0, 10) ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {tab === "closed" && closed && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Availability</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {closed.map((c) => (
                  <TableRow key={c.sku}>
                    <TableCell className="font-mono">{c.sku}</TableCell>
                    <TableCell>
                      <StatusPill value={c.in_stock ? "IN_STOCK" : "OUT"} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => toggleClosed(c.sku, !c.in_stock)}
                      >
                        {c.in_stock ? "Mark out of stock" : "Mark in stock"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {tab === "cards" && cards && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Set</TableHead>
                  <TableHead>Number</TableHead>
                  <TableHead>Rarity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cards.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono">{c.set}</TableCell>
                    <TableCell>{c.number}</TableCell>
                    <TableCell>{c.rarity}</TableCell>
                    <TableCell>
                      <StatusPill value={c.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={c.status !== "IN_POOL"}
                        onClick={() => setEditCard(c)}
                      >
                        Edit
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <NewDialog
        tab={tab}
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={() => {
          setNewOpen(false);
          refresh();
        }}
      />
      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onDone={() => {
          setImportOpen(false);
          refresh();
        }}
      />
      <EditCardDialog
        card={editCard}
        onClose={() => setEditCard(null)}
        onSaved={() => {
          setEditCard(null);
          refresh();
        }}
      />
    </div>
  );
}

function StatusPill({ value }: { value: string }) {
  const style =
    value === "AVAILABLE" || value === "IN_POOL" || value === "IN_STOCK"
      ? "bg-green-100 text-green-900"
      : value === "RESERVED"
        ? "bg-yellow-100 text-yellow-900"
        : value === "CONSUMED" || value === "SHIPPED" || value === "RESOLD"
          ? "bg-secondary text-secondary-foreground"
          : value === "RETIRED" || value === "OUT"
            ? "bg-red-100 text-red-900"
            : "bg-secondary text-secondary-foreground";
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs ${style}`}>
      {value}
    </span>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}

function NewDialog({
  tab,
  open,
  onClose,
  onCreated,
}: {
  tab: Tab;
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setForm({});
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (tab === "opened") {
        await apiFetch("/admin/inventory/opened-boosters", {
          method: "POST",
          body: JSON.stringify({
            sku: form.sku,
            video_url: form.video_url,
            filmed_at: form.filmed_at || null,
          }),
        });
      } else if (tab === "closed") {
        await apiFetch("/admin/inventory/closed-boosters", {
          method: "POST",
          body: JSON.stringify({
            sku: form.sku,
            in_stock: form.in_stock !== "false",
          }),
        });
      } else {
        await apiFetch("/admin/inventory/cards", {
          method: "POST",
          body: JSON.stringify({
            set: form.set,
            number: form.number,
            rarity: form.rarity || "COMMON",
            image_url: form.image_url,
            condition: form.condition || null,
          }),
        });
      }
      onCreated();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const title =
    tab === "opened"
      ? "New opened booster"
      : tab === "closed"
        ? "New closed booster"
        : "New card";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <form onSubmit={submit}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Creates a row in the {tab} pool (status AVAILABLE / IN_POOL).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {tab === "opened" && (
            <>
              <Field label="SKU">
                <Input
                  value={form.sku ?? ""}
                  onChange={(e) => set("sku", e.target.value)}
                  placeholder="SV-OBF"
                  autoFocus
                  required
                />
              </Field>
              <Field label="Video URL">
                <Input
                  value={form.video_url ?? ""}
                  onChange={(e) => set("video_url", e.target.value)}
                  placeholder="https://…/booster.mp4"
                  required
                />
              </Field>
              <Field label="Filmed at (optional)">
                <Input
                  type="datetime-local"
                  value={form.filmed_at ?? ""}
                  onChange={(e) => set("filmed_at", e.target.value)}
                />
              </Field>
            </>
          )}
          {tab === "closed" && (
            <>
              <Field label="SKU">
                <Input
                  value={form.sku ?? ""}
                  onChange={(e) => set("sku", e.target.value)}
                  placeholder="SV-OBF"
                  autoFocus
                  required
                />
              </Field>
              <Field label="Availability">
                <select
                  value={form.in_stock ?? "true"}
                  onChange={(e) => set("in_stock", e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="true">In stock</option>
                  <option value="false">Out of stock</option>
                </select>
              </Field>
              <p className="text-xs text-muted-foreground">
                Sealed packs are tracked per SKU by availability, not by unit.
                Re-submitting a SKU just updates its flag.
              </p>
            </>
          )}
          {tab === "cards" && (
            <>
              <Field label="Set">
                <Input
                  value={form.set ?? ""}
                  onChange={(e) => set("set", e.target.value)}
                  placeholder="SV01"
                  autoFocus
                  required
                />
              </Field>
              <Field label="Number">
                <Input
                  value={form.number ?? ""}
                  onChange={(e) => set("number", e.target.value)}
                  placeholder="025/198"
                  required
                />
              </Field>
              <Field label="Rarity">
                <RaritySelect
                  value={form.rarity ?? "COMMON"}
                  onChange={(v) => set("rarity", v)}
                />
              </Field>
              <Field label="Image URL">
                <Input
                  value={form.image_url ?? ""}
                  onChange={(e) => set("image_url", e.target.value)}
                  placeholder="https://…/card.png"
                  required
                />
              </Field>
              <Field label="Condition (optional)">
                <Input
                  value={form.condition ?? ""}
                  onChange={(e) => set("condition", e.target.value)}
                  placeholder="NM"
                />
              </Field>
            </>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

function RaritySelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
    >
      {RARITIES.map((r) => (
        <option key={r} value={r}>
          {r}
        </option>
      ))}
    </select>
  );
}

function EditCardDialog({
  card,
  onClose,
  onSaved,
}: {
  card: CardRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (card) {
      setForm({
        set: card.set,
        number: card.number,
        rarity: card.rarity,
      });
      setError(null);
    }
  }, [card]);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!card) return;
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch(`/admin/inventory/cards/${card.id}`, {
        method: "PATCH",
        body: JSON.stringify(form),
      });
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={card !== null} onOpenChange={(o) => !o && onClose()}>
      <form onSubmit={submit}>
        <DialogHeader>
          <DialogTitle>Edit card</DialogTitle>
          <DialogDescription>
            Only IN_POOL cards are editable. Image URL and condition can be set
            here too.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Set">
            <Input
              value={form.set ?? ""}
              onChange={(e) => set("set", e.target.value)}
            />
          </Field>
          <Field label="Number">
            <Input
              value={form.number ?? ""}
              onChange={(e) => set("number", e.target.value)}
            />
          </Field>
          <Field label="Rarity">
            <RaritySelect
              value={form.rarity ?? "COMMON"}
              onChange={(v) => set("rarity", v)}
            />
          </Field>
          <Field label="Image URL (optional)">
            <Input
              value={form.image_url ?? ""}
              onChange={(e) => set("image_url", e.target.value)}
              placeholder="leave blank to keep"
            />
          </Field>
          <Field label="Condition (optional)">
            <Input
              value={form.condition ?? ""}
              onChange={(e) => set("condition", e.target.value)}
              placeholder="leave blank to keep"
            />
          </Field>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

const IMPORT_EXAMPLE = `[
  { "type": "card", "set": "SV01", "number": "025/198", "rarity": "RARE", "image_url": "https://…/pikachu.png" },
  { "type": "closed_booster", "sku": "SV-OBF" },
  { "type": "opened_booster", "sku": "SV-OBF", "video_url": "https://…/obf.mp4" }
]`;

function ImportDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setText("");
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  const submit = async () => {
    setError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      setError(`Invalid JSON: ${String(e)}`);
      return;
    }
    if (!Array.isArray(parsed)) {
      setError("Body must be a JSON array of items.");
      return;
    }
    setSubmitting(true);
    try {
      const r = await apiFetch<{ ok: boolean; counts: Record<string, number> }>(
        "/admin/inventory/import",
        { method: "POST", body: JSON.stringify(parsed) },
      );
      void r;
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogHeader>
        <DialogTitle>Import inventory</DialogTitle>
        <DialogDescription>
          Paste a JSON array. Each item needs a <code>type</code> of card,
          opened_booster, or closed_booster. All-or-nothing.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={IMPORT_EXAMPLE}
          spellCheck={false}
          className="h-56 w-full rounded-md border border-input bg-background p-3 font-mono text-xs"
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" onClick={submit} disabled={submitting || !text}>
          {submitting ? "Importing…" : "Import"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
