"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { uploadAsset } from "@/lib/upload";
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
import { Help } from "@/components/HelpTip";

type OpenedBooster = {
  id: string;
  sku: string;
  closed_booster_sku: string | null;
  status: string;
  // Derived (not stored): free / bound / reserved / consumed, plus the LOADED
  // ball currently occupying it (if bound).
  effective_status: string;
  bound_ball: string | null;
  video_url: string | null;
  filmed_at: string | null;
  cards_count: number;
  card_count_needed: number | null;
  is_complete: boolean;
};
type ClosedBooster = {
  sku: string;
  name: string | null;
  image_front_url: string | null;
  image_back_url: string | null;
  card_count: number | null;
  reveal_card_count: number | null;
  in_stock: boolean;
  is_complete: boolean;
};
type CardRow = {
  id: string;
  sku: string;
  name: string | null;
  image_url: string | null;
  type: string | null;
  rarity: string | null;
  set: string | null;
  number: string | null;
  is_complete: boolean;
};

type ObCard = {
  id: string;
  position: number | null;
  card_type_sku: string | null;
  name: string | null;
  image_url: string | null;
  rarity: string | null;
};

// Managed vocabularies (admin: Inventory → Types). The card-type form's
// dropdowns and the Types tab both read from these.
type HoloTypeRow = { id: string; name: string; sort_order: number };
type RarityRow = {
  id: string;
  name: string;
  resell_price_cents: number;
  sort_order: number;
};

type Tab = "opened" | "closed" | "cards" | "types";
const TABS: { key: Tab; label: string }[] = [
  { key: "opened", label: "Opened boosters" },
  { key: "closed", label: "Closed boosters" },
  { key: "cards", label: "Card types" },
  { key: "types", label: "Types" },
];

export default function InventoryPage() {
  const [tab, setTab] = useState<Tab>("opened");
  const [opened, setOpened] = useState<OpenedBooster[] | null>(null);
  const [closed, setClosed] = useState<ClosedBooster[] | null>(null);
  const [cards, setCards] = useState<CardRow[] | null>(null);
  const [holoTypes, setHoloTypes] = useState<HoloTypeRow[] | null>(null);
  const [rarities, setRarities] = useState<RarityRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [newOpen, setNewOpen] = useState(false);
  const [editingClosed, setEditingClosed] = useState<ClosedBooster | null>(null);
  const [editingOpened, setEditingOpened] = useState<OpenedBooster | null>(null);
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
        // Also load the closed-booster catalog so the create/edit dialog's
        // picker is populated on this tab.
        const [r, cb, ct] = await Promise.all([
          apiFetch<{ opened_boosters: OpenedBooster[] }>(
            "/admin/inventory/opened-boosters",
          ),
          apiFetch<{ closed_boosters: ClosedBooster[] }>(
            "/admin/inventory/closed-boosters",
          ),
          apiFetch<{ card_types: CardRow[] }>("/admin/inventory/card-types"),
        ]);
        setOpened(r.opened_boosters);
        setClosed(cb.closed_boosters);
        setCards(ct.card_types);
      } else if (tab === "closed") {
        const r = await apiFetch<{ closed_boosters: ClosedBooster[] }>(
          "/admin/inventory/closed-boosters",
        );
        setClosed(r.closed_boosters);
      } else if (tab === "cards") {
        // The card-type form's Type/Rarity dropdowns read from the vocab.
        const [ct, ht, rr] = await Promise.all([
          apiFetch<{ card_types: CardRow[] }>("/admin/inventory/card-types"),
          apiFetch<{ holo_types: HoloTypeRow[] }>("/admin/inventory/holo-types"),
          apiFetch<{ rarities: RarityRow[] }>("/admin/inventory/rarities"),
        ]);
        setCards(ct.card_types);
        setHoloTypes(ht.holo_types);
        setRarities(rr.rarities);
      } else {
        const [ht, rr] = await Promise.all([
          apiFetch<{ holo_types: HoloTypeRow[] }>("/admin/inventory/holo-types"),
          apiFetch<{ rarities: RarityRow[] }>("/admin/inventory/rarities"),
        ]);
        setHoloTypes(ht.holo_types);
        setRarities(rr.rarities);
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
        {tab !== "types" && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              Import JSON
            </Button>
            <Button onClick={() => setNewOpen(true)}>New</Button>
          </div>
        )}
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
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">
              {count === undefined ? "Loading…" : `${count} rows`}
            </CardTitle>
            {tab === "opened" && <Help term="opened-booster" />}
            {tab === "closed" && <Help term="closed-booster" />}
            {tab === "cards" && <Help term="card-type" />}
            <Help term="completeness" />
          </div>
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
                  <TableHead className="w-8" title="Green = complete (ClosedBooster + video + all cards); amber = incomplete"></TableHead>
                  <TableHead>Closed booster</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Video</TableHead>
                  <TableHead>Cards</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {opened.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell>
                      <CompletenessDot complete={o.is_complete} />
                    </TableCell>
                    <TableCell className="font-mono">
                      {o.closed_booster_sku ?? <span className="text-muted-foreground">— unlinked</span>}
                    </TableCell>
                    <TableCell className="text-xs">
                      <StatusPill value={o.effective_status} />
                      {o.effective_status === "bound" && o.bound_ball && (
                        <span className="ml-1.5 font-mono text-muted-foreground">
                          {o.bound_ball}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {o.video_url ? "✓" : <span className="text-muted-foreground">none</span>}
                    </TableCell>
                    <TableCell className="text-xs">
                      {o.cards_count}
                      {o.card_count_needed != null ? ` / ${o.card_count_needed}` : ""}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => setEditingOpened(o)}>
                        Edit
                      </Button>
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
                  <TableHead className="w-8" title="Green = complete (can bind a ball); amber = still missing fields"></TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Faces</TableHead>
                  <TableHead>Cards</TableHead>
                  <TableHead>Availability</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {closed.map((c) => (
                  <TableRow key={c.sku}>
                    <TableCell>
                      <CompletenessDot complete={c.is_complete} />
                    </TableCell>
                    <TableCell className="font-mono">{c.sku}</TableCell>
                    <TableCell>{c.name ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Thumb url={c.image_front_url} label="front" />
                        <Thumb url={c.image_back_url} label="back" />
                      </div>
                    </TableCell>
                    <TableCell>{c.card_count ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell>
                      <StatusPill value={c.in_stock ? "IN_STOCK" : "OUT"} />
                    </TableCell>
                    <TableCell className="space-x-2 text-right">
                      <Button variant="outline" size="sm" onClick={() => setEditingClosed(c)}>
                        Edit
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => toggleClosed(c.sku, !c.in_stock)}
                      >
                        {c.in_stock ? "Out of stock" : "In stock"}
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
                  <TableHead className="w-8" title="Green = complete (name, image, type, rarity); amber = incomplete"></TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Image</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Rarity</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cards.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <CompletenessDot complete={c.is_complete} />
                    </TableCell>
                    <TableCell className="font-mono">{c.sku}</TableCell>
                    <TableCell>
                      <Thumb url={c.image_url} label="card" />
                    </TableCell>
                    <TableCell>{c.name ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-xs">{c.type ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-xs">{c.rarity ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => setEditCard(c)}>
                        Edit
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {tab === "types" && (
            <TypesManager
              holoTypes={holoTypes}
              rarities={rarities}
              onChanged={refresh}
              onError={setError}
            />
          )}
        </CardContent>
      </Card>

      {/* Card types: catalog entries (sku, name, image, holo type, rarity). */}
      <CardTypeDialog
        open={(newOpen && tab === "cards") || editCard !== null}
        editing={editCard}
        holoTypeNames={(holoTypes ?? []).map((h) => h.name)}
        rarityNames={(rarities ?? []).map((r) => r.name)}
        onClose={() => {
          setNewOpen(false);
          setEditCard(null);
        }}
        onSaved={() => {
          setNewOpen(false);
          setEditCard(null);
          refresh();
        }}
      />
      {/* Closed boosters get a richer create/edit dialog (name, faces, count). */}
      <ClosedBoosterDialog
        open={(newOpen && tab === "closed") || editingClosed !== null}
        editing={editingClosed}
        onClose={() => {
          setNewOpen(false);
          setEditingClosed(null);
        }}
        onSaved={() => {
          setNewOpen(false);
          setEditingClosed(null);
          refresh();
        }}
      />
      {/* Opened boosters: pick a ClosedBooster + attach the opening video. */}
      <OpenedBoosterDialog
        open={(newOpen && tab === "opened") || editingOpened !== null}
        editing={editingOpened}
        closedBoosters={closed ?? []}
        cardTypes={cards ?? []}
        onClose={() => {
          setNewOpen(false);
          setEditingOpened(null);
        }}
        onSaved={() => {
          setNewOpen(false);
          setEditingOpened(null);
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
    </div>
  );
}

function CompletenessDot({ complete }: { complete: boolean }) {
  return (
    <span
      title={complete ? "Complete — can bind a ball" : "Incomplete — missing fields"}
      className={cn(
        "inline-block h-2.5 w-2.5 rounded-full",
        complete ? "bg-green-500" : "bg-amber-500",
      )}
    />
  );
}

function Thumb({ url, label }: { url: string | null; label: string }) {
  if (!url)
    return (
      <span className="flex h-9 w-9 items-center justify-center rounded border border-dashed text-[9px] text-muted-foreground">
        {label}
      </span>
    );
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt={label} title={label} className="h-9 w-9 rounded border object-cover" />
  );
}

// URL input + upload button; upload writes to Supabase Storage and fills the URL.
function ImageField({
  label,
  value,
  folder,
  accept = "image/*",
  onChange,
}: {
  label: string;
  value: string;
  folder: "boosters" | "cards" | "videos";
  accept?: string;
  onChange: (url: string) => void;
}) {
  const isImage = accept.startsWith("image");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      onChange(await uploadAsset(file, folder));
    } catch (x) {
      setErr(x instanceof Error ? x.message : String(x));
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  };
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://… or upload →"
        />
        <label className="shrink-0 cursor-pointer rounded-md border px-2 py-2 text-xs hover:bg-accent">
          {busy ? "…" : "Upload"}
          <input
            type="file"
            accept={accept}
            className="hidden"
            onChange={onFile}
            disabled={busy}
          />
        </label>
        {value && isImage ? <Thumb url={value} label={label} /> : null}
        {value && !isImage ? <span className="text-xs text-green-600">✓ set</span> : null}
      </div>
      {err && <p className="mt-1 text-xs text-destructive">{err}</p>}
    </Field>
  );
}

// Create/edit a closed booster. SKU is immutable on edit. Partial is fine —
// the row dot shows completeness; only complete boosters can be bound to a ball.
function ClosedBoosterDialog({
  open,
  editing,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: ClosedBooster | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [cardCount, setCardCount] = useState("");
  const [revealCardCount, setRevealCardCount] = useState("");
  const [inStock, setInStock] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSku(editing?.sku ?? "");
    setName(editing?.name ?? "");
    setFront(editing?.image_front_url ?? "");
    setBack(editing?.image_back_url ?? "");
    setCardCount(editing?.card_count != null ? String(editing.card_count) : "");
    setRevealCardCount(
      editing?.reveal_card_count != null ? String(editing.reveal_card_count) : "",
    );
    setInStock(editing?.in_stock ?? true);
    setError(null);
    setSubmitting(false);
  }, [open, editing]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const payload: Record<string, unknown> = {
      name: name || null,
      image_front_url: front || null,
      image_back_url: back || null,
      card_count: cardCount ? Number(cardCount) : null,
      reveal_card_count: revealCardCount ? Number(revealCardCount) : null,
      in_stock: inStock,
    };
    try {
      if (editing) {
        await apiFetch(
          `/admin/inventory/closed-boosters/${encodeURIComponent(editing.sku)}`,
          { method: "PATCH", body: JSON.stringify(payload) },
        );
      } else {
        await apiFetch("/admin/inventory/closed-boosters", {
          method: "POST",
          body: JSON.stringify({ sku, ...payload }),
        });
      }
      onSaved();
    } catch (x) {
      setError(x instanceof ApiError ? x.message : String(x));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <form onSubmit={submit}>
        <DialogHeader>
          <DialogTitle>
            {editing ? `Edit ${editing.sku}` : "New closed booster"}
          </DialogTitle>
          <DialogDescription>
            A sealed-pack SKU. Fill in name, both face images (used by the win
            reveal) and cards-per-pack to make it complete — only complete
            boosters can be bound to a ball.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Field label="SKU">
            <Input
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              placeholder="pkmn-151"
              autoFocus={!editing}
              required
              disabled={!!editing}
            />
          </Field>
          <Field label="Name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Pokémon 151"
            />
          </Field>
          <ImageField label="Front image" value={front} folder="boosters" onChange={setFront} />
          <ImageField label="Back image" value={back} folder="boosters" onChange={setBack} />
          <Field label="Cards per pack">
            <Input
              type="number"
              min={1}
              value={cardCount}
              onChange={(e) => setCardCount(e.target.value)}
              placeholder="e.g. 10"
            />
          </Field>
          <Field label="Reveal cards (open animation)">
            <Input
              type="number"
              min={1}
              value={revealCardCount}
              onChange={(e) => setRevealCardCount(e.target.value)}
              placeholder="face-down cards fanned out — defaults to cards per pack"
            />
          </Field>
          <Field label="Availability">
            <select
              value={inStock ? "true" : "false"}
              onChange={(e) => setInStock(e.target.value === "true")}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="true">In stock</option>
              <option value="false">Out of stock</option>
            </select>
          </Field>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting || (!editing && !sku)}>
            {submitting ? "Saving…" : editing ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

// Create/edit an opened booster: pick the ClosedBooster it came from + attach
// the opening video (upload or URL). Cards are managed separately.
function OpenedBoosterDialog({
  open,
  editing,
  closedBoosters,
  cardTypes,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: OpenedBooster | null;
  closedBoosters: ClosedBooster[];
  cardTypes: CardRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [closedSku, setClosedSku] = useState("");
  const [video, setVideo] = useState("");
  const [filmedAt, setFilmedAt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [obCards, setObCards] = useState<ObCard[]>([]);
  const [addSku, setAddSku] = useState("");
  const [cardBusy, setCardBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setClosedSku(editing?.closed_booster_sku ?? "");
    setVideo(editing?.video_url ?? "");
    setFilmedAt(editing?.filmed_at ? editing.filmed_at.slice(0, 16) : "");
    setError(null);
    setSubmitting(false);
    setAddSku("");
  }, [open, editing]);

  const reloadCards = useCallback(async () => {
    if (!editing) return;
    try {
      const r = await apiFetch<{ cards: ObCard[] }>(
        `/admin/inventory/opened-boosters/${editing.id}/cards`,
      );
      setObCards(r.cards);
    } catch {
      /* keep prior list on transient error */
    }
  }, [editing]);

  useEffect(() => {
    if (open && editing) reloadCards();
    else setObCards([]);
  }, [open, editing, reloadCards]);

  const withCardBusy = async (fn: () => Promise<void>) => {
    setCardBusy(true);
    setError(null);
    try {
      await fn();
      await reloadCards();
    } catch (x) {
      setError(x instanceof ApiError ? x.message : String(x));
    } finally {
      setCardBusy(false);
    }
  };

  const addCard = () =>
    editing &&
    addSku &&
    withCardBusy(async () => {
      await apiFetch(`/admin/inventory/opened-boosters/${editing.id}/cards`, {
        method: "POST",
        body: JSON.stringify({ card_type_sku: addSku }),
      });
      setAddSku("");
    });

  const removeCard = (id: string) =>
    withCardBusy(async () => {
      await apiFetch(`/admin/inventory/cards/${id}`, { method: "DELETE" });
    });

  const move = (i: number, dir: number) => {
    const j = i + dir;
    if (!editing || j < 0 || j >= obCards.length) return;
    const order = obCards.map((c) => c.id);
    [order[i], order[j]] = [order[j], order[i]];
    return withCardBusy(async () => {
      await apiFetch(`/admin/inventory/opened-boosters/${editing.id}/cards/reorder`, {
        method: "POST",
        body: JSON.stringify({ card_ids: order }),
      });
    });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const payload = {
      closed_booster_sku: closedSku || null,
      video_url: video || null,
      filmed_at: filmedAt || null,
    };
    try {
      if (editing) {
        await apiFetch(`/admin/inventory/opened-boosters/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } else {
        await apiFetch("/admin/inventory/opened-boosters", {
          method: "POST",
          body: JSON.stringify({ ...payload, closed_booster_sku: closedSku }),
        });
      }
      onSaved();
    } catch (x) {
      setError(x instanceof ApiError ? x.message : String(x));
    } finally {
      setSubmitting(false);
    }
  };

  const needed = closedBoosters.find((c) => c.sku === closedSku)?.card_count ?? null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <form onSubmit={submit}>
        <DialogHeader>
          <DialogTitle>
            {editing ? "Edit opened booster" : "New opened booster"}
          </DialogTitle>
          <DialogDescription>
            One filmed opening of a sealed pack: pick the closed booster it came
            from and attach the opening video. It becomes complete once it also
            has {needed ?? "the pack's"} cards (added separately).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Field label="Closed booster (SKU)">
            <select
              value={closedSku}
              onChange={(e) => setClosedSku(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              required
            >
              <option value="">— select —</option>
              {closedBoosters.map((c) => (
                <option key={c.sku} value={c.sku}>
                  {c.sku}
                  {c.name ? ` · ${c.name}` : ""}
                  {c.is_complete ? "" : " (incomplete)"}
                </option>
              ))}
            </select>
          </Field>
          <ImageField
            label="Opening video"
            value={video}
            folder="videos"
            accept="video/*"
            onChange={setVideo}
          />
          <Field label="Filmed at (optional)">
            <Input
              type="datetime-local"
              value={filmedAt}
              onChange={(e) => setFilmedAt(e.target.value)}
            />
          </Field>
          {editing ? (
            <div className="space-y-2 rounded-md border p-3">
              <p className="text-sm font-medium">
                Reveal cards ({obCards.length}
                {needed != null ? ` / ${needed}` : ""})
              </p>
              {obCards.length > 0 && (
                <ol className="space-y-1">
                  {obCards.map((c, i) => (
                    <li key={c.id} className="flex items-center gap-2 text-sm">
                      <span className="w-4 text-right text-xs text-muted-foreground">{i + 1}</span>
                      <Thumb url={c.image_url} label="card" />
                      <span className="flex-1 truncate">
                        {c.name ?? c.card_type_sku ?? "—"}
                        {c.rarity ? ` · ${c.rarity}` : ""}
                      </span>
                      <button type="button" disabled={i === 0 || cardBusy} onClick={() => move(i, -1)} className="px-1 text-muted-foreground disabled:opacity-30">↑</button>
                      <button type="button" disabled={i === obCards.length - 1 || cardBusy} onClick={() => move(i, 1)} className="px-1 text-muted-foreground disabled:opacity-30">↓</button>
                      <button type="button" disabled={cardBusy} onClick={() => removeCard(c.id)} className="px-1 text-destructive disabled:opacity-30">✕</button>
                    </li>
                  ))}
                </ol>
              )}
              <div className="flex gap-2">
                <select
                  value={addSku}
                  onChange={(e) => setAddSku(e.target.value)}
                  className="flex h-9 flex-1 rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="">— add card type —</option>
                  {cardTypes.map((t) => (
                    <option key={t.sku} value={t.sku}>
                      {t.sku}
                      {t.name ? ` · ${t.name}` : ""}
                      {t.is_complete ? "" : " (incomplete)"}
                    </option>
                  ))}
                </select>
                <Button type="button" size="sm" variant="outline" disabled={!addSku || cardBusy} onClick={addCard}>
                  Add
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Create the opened booster first, then edit it to add the reveal cards.
            </p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting || !closedSku}>
            {submitting ? "Saving…" : editing ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

// Create/edit a card TYPE (catalog): sku, name, image, holo/foil type, rarity.
function CardTypeDialog({
  open,
  editing,
  holoTypeNames,
  rarityNames,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: CardRow | null;
  holoTypeNames: string[];
  rarityNames: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [image, setImage] = useState("");
  const [type, setType] = useState("");
  const [rarity, setRarity] = useState("");
  const [setName_, setSetName] = useState("");
  const [number, setNumber] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSku(editing?.sku ?? "");
    setName(editing?.name ?? "");
    setImage(editing?.image_url ?? "");
    setType(editing?.type ?? "");
    setRarity(editing?.rarity ?? "");
    setSetName(editing?.set ?? "");
    setNumber(editing?.number ?? "");
    setError(null);
    setSubmitting(false);
  }, [open, editing]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const payload: Record<string, unknown> = {
      name: name || null,
      image_url: image || null,
      type: type || null,
      rarity: rarity || null,
      set: setName_ || null,
      number: number || null,
    };
    try {
      if (editing) {
        await apiFetch(
          `/admin/inventory/card-types/${encodeURIComponent(editing.sku)}`,
          { method: "PATCH", body: JSON.stringify(payload) },
        );
      } else {
        await apiFetch("/admin/inventory/card-types", {
          method: "POST",
          body: JSON.stringify({ sku, ...payload }),
        });
      }
      onSaved();
    } catch (x) {
      setError(x instanceof ApiError ? x.message : String(x));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <form onSubmit={submit}>
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${editing.sku}` : "New card type"}</DialogTitle>
          <DialogDescription>
            A card in the catalog. Fill in name, image, holo/foil type and rarity
            to make it complete — only complete card types can be a prize.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Field label="SKU">
            <Input
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              placeholder="151-025"
              autoFocus={!editing}
              required
              disabled={!!editing}
            />
          </Field>
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Pikachu" />
          </Field>
          <ImageField label="Image" value={image} folder="cards" onChange={setImage} />
          <Field label="Type (holo / foil)">
            <VocabSelect
              value={type}
              onChange={setType}
              options={holoTypeNames}
              placeholder="— select type —"
            />
          </Field>
          <Field label="Rarity">
            <VocabSelect
              value={rarity}
              onChange={setRarity}
              options={rarityNames}
              placeholder="— select rarity —"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Set (optional)">
              <Input value={setName_} onChange={(e) => setSetName(e.target.value)} placeholder="151" />
            </Field>
            <Field label="Number (optional)">
              <Input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="025" />
            </Field>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting || (!editing && !sku)}>
            {submitting ? "Saving…" : editing ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

function StatusPill({ value }: { value: string }) {
  const style =
    value === "AVAILABLE" || value === "IN_POOL" || value === "IN_STOCK" || value === "free"
      ? "bg-green-100 text-green-900"
      : value === "RESERVED" || value === "reserved"
        ? "bg-yellow-100 text-yellow-900"
        : value === "bound"
          ? "bg-blue-100 text-blue-900"
          : value === "CONSUMED" || value === "SHIPPED" || value === "RESOLD" || value === "consumed"
            ? "bg-secondary text-secondary-foreground"
            : value === "RETIRED" || value === "OUT"
              ? "bg-red-100 text-red-900"
              : "bg-secondary text-secondary-foreground";
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs capitalize ${style}`}>
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

// A select bound to a managed vocabulary (holo types / rarities). Includes the
// current value even if it's not in `options` (e.g. a value whose vocab row was
// removed) so editing an existing card type never silently drops its type.
function VocabSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder: string;
}) {
  const all = value && !options.includes(value) ? [value, ...options] : options;
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
    >
      <option value="">{placeholder}</option>
      {all.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

// ── Types tab: manage the holo-type + rarity vocabularies ──────────────────
function TypesManager({
  holoTypes,
  rarities,
  onChanged,
  onError,
}: {
  holoTypes: HoloTypeRow[] | null;
  rarities: RarityRow[] | null;
  onChanged: () => void;
  onError: (msg: string) => void;
}) {
  const [newType, setNewType] = useState("");
  const [newRarity, setNewRarity] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      onChanged();
    } catch (e) {
      onError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const addType = () => {
    const name = newType.trim();
    if (!name) return;
    run(async () => {
      await apiFetch("/admin/inventory/holo-types", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      setNewType("");
    });
  };
  const delType = (name: string) =>
    run(() =>
      apiFetch(`/admin/inventory/holo-types/${encodeURIComponent(name)}`, {
        method: "DELETE",
      }),
    );

  const addRarity = () => {
    const name = newRarity.trim();
    if (!name) return;
    const cents = Math.round(parseFloat(newPrice || "0") * 100);
    run(async () => {
      await apiFetch("/admin/inventory/rarities", {
        method: "POST",
        body: JSON.stringify({
          name,
          resell_price_cents: Number.isFinite(cents) ? cents : 0,
        }),
      });
      setNewRarity("");
      setNewPrice("");
    });
  };
  const setRarityPrice = (name: string, dollars: string) => {
    const cents = Math.round(parseFloat(dollars || "0") * 100);
    run(() =>
      apiFetch(`/admin/inventory/rarities/${encodeURIComponent(name)}`, {
        method: "PATCH",
        body: JSON.stringify({ resell_price_cents: Number.isFinite(cents) ? cents : 0 }),
      }),
    );
  };
  const delRarity = (name: string) =>
    run(() =>
      apiFetch(`/admin/inventory/rarities/${encodeURIComponent(name)}`, {
        method: "DELETE",
      }),
    );

  return (
    <div className="grid gap-8 md:grid-cols-2">
      {/* Holo / foil types */}
      <div>
        <h3 className="mb-2 text-sm font-semibold">Holo / foil types</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          The rendering categories a card type can use. A type in use by a card
          type can&apos;t be removed.
        </p>
        <div className="mb-3 flex gap-2">
          <Input
            value={newType}
            onChange={(e) => setNewType(e.target.value)}
            placeholder="e.g. galaxy-holo"
            onKeyDown={(e) => e.key === "Enter" && addType()}
          />
          <Button onClick={addType} disabled={busy || !newType.trim()}>
            Add
          </Button>
        </div>
        <ul className="divide-y rounded-md border">
          {(holoTypes ?? []).map((h) => (
            <li key={h.id} className="flex items-center justify-between px-3 py-2">
              <span className="text-sm">{h.name}</span>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => delType(h.name)}
              >
                Remove
              </Button>
            </li>
          ))}
          {holoTypes && holoTypes.length === 0 && (
            <li className="px-3 py-2 text-sm text-muted-foreground">None yet.</li>
          )}
        </ul>
      </div>

      {/* Rarities */}
      <div>
        <h3 className="mb-2 text-sm font-semibold">Rarities</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          Each rarity sets the resale price paid when a won card of that rarity
          is sold back. In use = can&apos;t be removed.
        </p>
        <div className="mb-3 flex gap-2">
          <Input
            value={newRarity}
            onChange={(e) => setNewRarity(e.target.value)}
            placeholder="e.g. SECRET_RARE"
          />
          <Input
            value={newPrice}
            onChange={(e) => setNewPrice(e.target.value)}
            placeholder="$ price"
            inputMode="decimal"
            className="w-24"
          />
          <Button onClick={addRarity} disabled={busy || !newRarity.trim()}>
            Add
          </Button>
        </div>
        <ul className="divide-y rounded-md border">
          {(rarities ?? []).map((r) => (
            <li key={r.id} className="flex items-center gap-2 px-3 py-2">
              <span className="flex-1 text-sm">{r.name}</span>
              <span className="text-xs text-muted-foreground">$</span>
              <Input
                defaultValue={(r.resell_price_cents / 100).toFixed(2)}
                inputMode="decimal"
                className="h-8 w-20"
                disabled={busy}
                onBlur={(e) => {
                  const next = Math.round(parseFloat(e.target.value || "0") * 100);
                  if (next !== r.resell_price_cents) setRarityPrice(r.name, e.target.value);
                }}
              />
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => delRarity(r.name)}
              >
                Remove
              </Button>
            </li>
          ))}
          {rarities && rarities.length === 0 && (
            <li className="px-3 py-2 text-sm text-muted-foreground">None yet.</li>
          )}
        </ul>
      </div>
    </div>
  );
}

const IMPORT_EXAMPLE = `[
  { "type": "closed_booster", "sku": "pkmn-151", "name": "Pokémon 151", "card_count": 10 },
  { "type": "opened_booster", "closed_booster_sku": "pkmn-151", "video_url": "https://…/151.mp4" }
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
