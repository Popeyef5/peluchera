"use client";

import { useState, type ReactNode } from "react";
import { HelpCircle } from "lucide-react";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// A small "?" icon button that opens a modal explaining a domain term. Use
// <Help term="void" /> for a glossary entry, or <HelpTip title=…>…</HelpTip>
// for one-off copy. Keeps operators who don't know the data-model nuances in the
// loop without cluttering the UI.
export function HelpTip({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label={`What is ${title}?`}
        title={`What is ${title}?`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className={
          "inline-flex align-middle text-muted-foreground/70 hover:text-foreground " +
          (className ?? "")
        }
      >
        <HelpCircle className="h-3.5 w-3.5" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">
          {children}
        </div>
      </Dialog>
    </>
  );
}

export function Help({ term }: { term: keyof typeof GLOSSARY }) {
  const g = GLOSSARY[term];
  return <HelpTip title={g.title}>{g.body}</HelpTip>;
}

export const GLOSSARY: Record<string, { title: string; body: ReactNode }> = {
  "closed-booster": {
    title: "Closed booster",
    body: (
      <>
        <p>
          A <b>sealed pack</b> of cards, as sold — identified by its SKU. This is
          the catalog entry: its name, the two face images (front &amp; back) the
          win reveal shows, and how many cards a pack contains.
        </p>
        <p>
          Sealed packs are fungible: we only track whether a SKU is <b>in stock</b>{" "}
          to ship, not individual packs.
        </p>
        <p>
          A booster must be <b>complete</b> (name + both images + card count)
          before a ball can be bound to it.
        </p>
      </>
    ),
  },
  "opened-booster": {
    title: "Opened booster",
    body: (
      <>
        <p>
          One <b>filmed opening</b> of a sealed pack: it links to a closed-booster
          SKU, has the opening <b>video</b>, and an <b>ordered set of cards</b>{" "}
          (the reveal sequence a winner sees).
        </p>
        <p>
          It&apos;s <b>complete</b> when it has a complete closed booster, a video,
          and exactly the pack&apos;s number of cards. Only then can a ball be
          bound to it.
        </p>
      </>
    ),
  },
  "card-type": {
    title: "Card type",
    body: (
      <>
        <p>
          The <b>catalog entry</b> for a card — the &ldquo;what card is
          this&rdquo;: SKU, name, image, holo/foil <b>type</b> and <b>rarity</b>.
        </p>
        <p>
          Individual won cards are <i>instances</i> that point to a card type. A
          type must be complete (name, image, type, rarity) to be used as a prize.
        </p>
      </>
    ),
  },
  completeness: {
    title: "The completeness dot",
    body: (
      <>
        <p>
          <span className="text-green-600">●</span> green — every required field is
          filled, so this item can be <b>bound to a ball</b>.
        </p>
        <p>
          <span className="text-amber-600">●</span> amber — still missing fields.
          The machine refuses to hand out a prize it can&apos;t fully describe, so
          incomplete items can&apos;t be bound.
        </p>
      </>
    ),
  },
  void: {
    title: "Voiding a ball",
    body: (
      <>
        <p>
          Every physical ball in the machine is <b>bound</b> to a prize (a booster
          pair or a card). <b>Voiding</b> a ball releases its prize back to the
          pool and marks the ball <b>VOIDED</b> — effectively taking it out of the
          machine.
        </p>
        <p>
          Void a ball when it&apos;s damaged, lost, or you need to reassign its
          prize. Only a <b>LOADED</b> (not-yet-grabbed) ball can be voided.
        </p>
      </>
    ),
  },
  bind: {
    title: "Binding a ball",
    body: (
      <>
        <p>
          <b>Binding</b> ties a physical ball (by its RFID serial) to a specific
          prize — an opened booster or a single card — so that when a player grabs
          that ball, they win that prize.
        </p>
        <p>The prize must be <b>complete</b>; the machine won&apos;t bind an incomplete one.</p>
      </>
    ),
  },
  "ball-status": {
    title: "Ball statuses",
    body: (
      <>
        <p><b>LOADED</b> — in the machine, bound to a prize, waiting to be grabbed.</p>
        <p><b>GRABBED</b> — a player won it; its prize has been handed out.</p>
        <p><b>VOIDED</b> — taken out of play; its prize was released back to the pool.</p>
      </>
    ),
  },
  "inventory-fault": {
    title: "Inventory fault (queue paused)",
    body: (
      <>
        <p>
          The machine <b>pauses the queue</b> when a loaded ball&apos;s prize
          can&apos;t be honoured — e.g. its booster SKU went out of stock, or its
          prize became incomplete.
        </p>
        <p>
          It won&apos;t take money (or a free play) for a prize it can&apos;t hand
          over. Fix by voiding/rebinding the flagged balls or restocking, then the
          queue resumes.
        </p>
      </>
    ),
  },
  "version-chain": {
    title: "Protocol chain (VPS · Pi · ESP)",
    body: (
      <>
        <p>
          The three parts of the system — the server (VPS), the cabinet controller
          (Pi) and the chute firmware (ESP) — each speak a numbered <b>protocol</b>,
          and they must all match.
        </p>
        <p>
          A mismatch (e.g. after deploying one but not reflashing another){" "}
          <b>pauses the queue</b> until resolved. Green links = matched; a red link
          shows which piece is out of date.
        </p>
      </>
    ),
  },
};
