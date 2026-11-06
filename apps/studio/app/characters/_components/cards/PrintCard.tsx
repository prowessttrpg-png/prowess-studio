"use client";

import { Fragment, useLayoutEffect, useRef, useState } from "react";
import type { CardDto } from "../../_lib/card-types";
import { CATEGORY_LABELS } from "../../_lib/card-format";
import { BlockList, CardArt, CostStrip, backBlocks, frontBlocks, type CardBlock } from "./CardFace";

/**
 * Physical card output (PAS-10 M6-WO9 Phase C, decision C5). The SAME blocks as the digital viewer are paginated onto
 * provisional 4 × 6 in card pages: whatever does not fit continues on numbered continuation pages — nothing is clipped,
 * hidden, shrunk below the print type size or recomputed. Each card prints as duplex pairs (front i / back i, padded with
 * an intentionally blank page) so fronts and backs stay aligned; the `combined` layout places each pair side by side on
 * a landscape Letter page. Every page carries the card's fixed snapshot identity, Release and revision.
 */
export type PrintLayout = "card" | "combined";

/** One instruction per block, so a long rule list can continue across pages without splitting a sentence. */
function printBlocks(blocks: readonly CardBlock[], card: CardDto, splitKey: string, title: string): CardBlock[] {
  return blocks.flatMap((b) => {
    if (b.key !== splitKey) return b.printItems === undefined ? [b] : b.printItems.map((item, i) => ({ key: `${b.key}.${item.key}`, title: i === 0 ? b.title : "", body: item.body }));
    return card.instructions.blocks.map((ins, i) => ({
      key: `${splitKey}.${i}`,
      title: i === 0 ? title : "",
      body: (
        <ol className="fcard-instructions" start={i + 1}>
          <li className={`fcard-instructions__block fcard-instructions__block--${ins.kind.toLowerCase()}`} data-kind={ins.kind} data-testid="card-instruction">
            {ins.text}
          </li>
        </ol>
      ),
    }));
  });
}

interface Page {
  readonly side: "front" | "back" | "blank";
  readonly blocks: readonly CardBlock[];
  readonly first: boolean;
  /** A single block taller than a card page: it flows across physical pages instead of being clipped. */
  readonly tall: boolean;
}

function paginate(blocks: readonly CardBlock[], heights: readonly number[], capacity: number, side: "front" | "back", firstCapacity: number): Page[] {
  if (blocks.length === 0) return [{ side, blocks: [], first: true, tall: false }];
  // Unmeasured (no layout engine): one page per side, never dropping a block.
  if (!(capacity > 0)) return [{ side, blocks, first: true, tall: false }];
  const pages: Page[] = [];
  let current: CardBlock[] = [];
  let used = 0;
  let limit = firstCapacity;
  blocks.forEach((b, i) => {
    const h = heights[i] ?? 0;
    if (current.length > 0 && used + h > limit) {
      pages.push({ side, blocks: current, first: pages.length === 0, tall: false });
      current = [];
      used = 0;
      limit = capacity;
    }
    current.push(b);
    used += h;
  });
  pages.push({ side, blocks: current, first: pages.length === 0, tall: false });
  return pages.map((p) => ({ ...p, tall: p.blocks.length === 1 && (heights[blocks.indexOf(p.blocks[0] as CardBlock)] ?? 0) > (p.first ? firstCapacity : capacity) }));
}

function PageFrame({ card, page, index, total, release, children }: { card: CardDto; page: Page; index: number; total: number; release: string | null; children: React.ReactNode }) {
  const label = page.side === "blank" ? "Intentionally blank (duplex alignment)" : `${page.side === "front" ? "Front" : "Back"}${page.first ? "" : " — continued"}`;
  const ability = card.provenance.ability;
  return (
    <article className={`fprint-page fprint-page--${page.side}${page.tall ? " fprint-page--tall" : ""} fcard--${card.category.toLowerCase()}`} data-testid="print-page" data-side={page.side} data-card={card.cardKey} aria-label={`${card.name} — ${label}, card page ${index} of ${total}`}>
      <header className="fprint-page__head">
        <span className="fprint-page__type">
          {CATEGORY_LABELS[card.category]} · {label}
        </span>
        <span className="fprint-page__name">{card.name}</span>
      </header>
      <div className="fprint-page__body">{children}</div>
      <footer className="fprint-page__foot" data-testid="print-footer">
        <span>
          Card page {index} / {total}
        </span>
        <span className="fcard-mono">
          {card.snapshot.cardKey}
          {ability && ability.revisionNumber !== null ? ` · r${ability.revisionNumber}` : ""} · contract v{card.snapshot.contractVersion}
        </span>
        {release ? <span>{release}</span> : null}
      </footer>
    </article>
  );
}

/** The paginated pages of ONE card (front pages, back pages, duplex-aligned). Measurement is layout only. */
export function PrintCardPages({ card, names, release, layout }: { card: CardDto; names: Record<string, string>; release: string | null; layout: PrintLayout }) {
  const front = printBlocks(frontBlocks(card, names, { compact: false }), card, "how", "How to Use");
  const back = printBlocks(backBlocks(card, names, release), card, "rules", "Rules");
  const measure = useRef<HTMLDivElement | null>(null);
  const [pages, setPages] = useState<{ front: Page[]; back: Page[] } | null>(null);
  useLayoutEffect(() => {
    const root = measure.current;
    if (root === null) return;
    const probeFirst = root.querySelector<HTMLElement>("[data-probe=first]");
    const probe = root.querySelector<HTMLElement>("[data-probe=next]");
    const capacityOf = (el: HTMLElement | null) => (el === null ? 0 : el.clientHeight);
    const heightsOf = (side: string) =>
      [...root.querySelectorAll<HTMLElement>(`[data-measure=${side}] > [data-block-wrap]`)].map((el) => {
        const style = window.getComputedStyle(el);
        return el.getBoundingClientRect().height + (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0);
      });
    const cap = capacityOf(probe);
    const head = probeFirst?.firstElementChild;
    const firstCap = capacityOf(probeFirst) - (head instanceof HTMLElement ? head.getBoundingClientRect().height : 0);
    setPages({ front: paginate(front, heightsOf("front"), cap, "front", firstCap), back: paginate(back, heightsOf("back"), cap, "back", cap) });
    // Blocks are a pure function of the card; re-measure only when the card (or its labels) changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card, names, release]);

  if (pages === null) {
    return (
      <div className="fprint-measure" ref={measure} aria-hidden="true" data-testid="print-measuring">
        {(["first", "next"] as const).map((probe) => (
          <article key={probe} className="fprint-page">
            <ProbeHead card={card} />
            <div className="fprint-page__body" data-probe={probe}>
              {probe === "first" ? <FrontHead card={card} /> : null}
            </div>
            <footer className="fprint-page__foot">
              <span>Card page 00 / 00</span>
              <span className="fcard-mono">{card.snapshot.cardKey} · r000 · contract v1</span>
              {release ? <span>{release}</span> : null}
            </footer>
          </article>
        ))}
        {(["front", "back"] as const).map((side) => (
          <article key={side} className="fprint-page fprint-measure__page">
            <div className="fprint-page__body" data-measure={side}>
              {(side === "front" ? front : back).map((b) => (
                <div key={b.key} className="fprint-block" data-block-wrap>
                  <BlockList blocks={[b]} collapsible={false} />
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    );
  }
  const pairs = Math.max(pages.front.length, pages.back.length);
  const blank = (): Page => ({ side: "blank", blocks: [], first: false, tall: false });
  const sequence: Page[] = [];
  for (let i = 0; i < pairs; i += 1) sequence.push(pages.front[i] ?? blank(), pages.back[i] ?? blank());
  const total = sequence.length;
  const render = (p: Page, i: number) => (
    <PageFrame key={i} card={card} page={p} index={i + 1} total={total} release={release}>
      {p.side === "front" && p.first ? <FrontHead card={card} /> : null}
      {p.side === "blank" ? (
        <p className="fcard-empty">This side is intentionally blank so the next card&apos;s front prints on a front.</p>
      ) : (
        p.blocks.map((b) => (
          <div key={b.key} className="fprint-block">
            <BlockList blocks={[b]} collapsible={false} />
          </div>
        ))
      )}
    </PageFrame>
  );
  if (layout === "combined") {
    const rows: Page[][] = [];
    for (let i = 0; i < sequence.length; i += 2) rows.push(sequence.slice(i, i + 2));
    return (
      <div className="fprint-card" data-testid="print-card" data-card={card.cardKey} data-pages={total}>
        {rows.map((row, r) => (
          <div key={r} className="fprint-sheet fprint-sheet--combined" data-testid="print-sheet">
            {row.map((p, k) => (
              <Fragment key={k}>{render(p, r * 2 + k)}</Fragment>
            ))}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="fprint-card" data-testid="print-card" data-card={card.cardKey} data-pages={total}>
      {sequence.map(render)}
    </div>
  );
}

/** The page header as every real page renders it (the longest label), so probes reserve the same space. */
function ProbeHead({ card }: { card: CardDto }) {
  return (
    <header className="fprint-page__head">
      <span className="fprint-page__type">{CATEGORY_LABELS[card.category]} · Front — continued</span>
      <span className="fprint-page__name">{card.name}</span>
    </header>
  );
}

function FrontHead({ card }: { card: CardDto }) {
  return (
    <div className="fprint-front-head">
      <CardArt card={card} size="small" />
      <CostStrip card={card} />
    </div>
  );
}
