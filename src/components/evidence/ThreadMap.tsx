"use client";

import { memo, useCallback, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import type { ThreadNode } from "@/lib/data/read";
import { msgTag } from "@/lib/refs";
import { cn } from "@/lib/utils";
import type { ChipLevel } from "@/components/chat/CitationChip";
import { ROOT, nearest, type Laid, type MapGeometry, type Shape } from "./thread-tree";
import { shortDate } from "@/components/chat/evidence";
import { engagement, loudness, mapHint, type Source } from "./source-words";

// The picture of a conversation at the top of the evidence panel. Every message is a dot and every reply a line, drawn
// as a reply tree (reading order across, reply depth down; thread-tree.ts mapGeometry). A chat session's top-level
// messages hang from one node for the conversation itself ("#channel · N messages"), which is not a message and is
// not selectable. A parent from an earlier session, carried as context, is drawn hollow and faint. The messages this answer cites are numbered like their chips, the
// path down to the open message lights up, a hovered claim's messages glow, and the open one is ringed. A dot's size
// says how much engagement it drew. Pointing picks the nearest dot, so a 400-message thread is still easy to hit.

const spring = { type: "spring", bounce: 0, duration: 0.4 } as const;
const tagOf = (n: { ref: number }) => msgTag(n.ref);

export const ThreadMap = memo(function ThreadMap({
  laid,
  geometry,
  shape,
  source,
  channel,
  focusConv,
  citedNum,
  levelOf,
  lit,
  branch,
  focusTag,
  onFocus,
}: {
  laid: Laid<ThreadNode>[];
  geometry: MapGeometry;
  shape: Shape;
  source?: Source;
  channel: string;
  focusConv: string | null;
  citedNum: Map<string, number>;
  levelOf: (tag: string) => ChipLevel;
  lit: Set<string>;
  branch: Set<string>;
  focusTag: string;
  onFocus: (tag: string) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<string | null>(null);
  const { width: W, height: H, points, edges, root } = geometry;
  const isContext = useCallback((n: ThreadNode) => focusConv !== null && n.conversation_id !== focusConv, [focusConv]);
  const onBranch = useCallback((e: { from: string; to: string }) => branch.has(e.to) && (e.from === ROOT || branch.has(e.from)), [branch]);
  const byId = useMemo(() => new Map(laid.map((n) => [n.id, n])), [laid]);
  const maxScore = useMemo(() => Math.max(1, ...laid.map((n) => n.score)), [laid]);
  const radius = useCallback((n: ThreadNode) => (citedNum.has(tagOf(n)) ? 6.4 : 1.6 + 2.6 * loudness(n.score, maxScore)), [citedNum, maxScore]);

  // The quiet layer - every reply line and every uncited dot - redrawn only when the focus or the branch changes.
  const base = useMemo(
    () => (
      <>
        {/* Quiet lines share one layer whose opacity is set once, so 200 replies to one post overlap without
            piling up into a black bar; the lit branch is drawn on top at full strength. */}
        <g className="stroke-foreground" opacity={0.16}>
          {edges.map((e) =>
            onBranch(e) ? null : <path key={`${e.from}-${e.to}`} d={e.d} fill="none" strokeWidth={0.8} strokeLinecap="round" />,
          )}
        </g>
        <g className="stroke-pulse" opacity={0.85}>
          {edges.map((e) =>
            onBranch(e) ? <path key={`${e.from}-${e.to}`} d={e.d} fill="none" strokeWidth={1.5} strokeLinecap="round" /> : null,
          )}
        </g>
        {laid.map((n) => {
          if (citedNum.has(tagOf(n))) return null;
          const p = points.get(n.id)!;
          const loud = loudness(n.score, maxScore);
          if (isContext(n))
            return <circle key={n.id} cx={p.x} cy={p.y} r={radius(n)} className="fill-background stroke-foreground/40" strokeWidth={0.8} strokeDasharray="1.5 1" />;
          return (
            <circle
              key={n.id}
              cx={p.x}
              cy={p.y}
              r={radius(n)}
              className={branch.has(n.id) ? "fill-pulse/60" : "fill-foreground"}
              fillOpacity={branch.has(n.id) ? undefined : 0.16 + 0.5 * loud}
            />
          );
        })}
        {root && (
          <g>
            <rect x={root.x - 3.5} y={root.y - 3.5} width={7} height={7} rx={1.5} className="fill-foreground/70" />
            <text x={root.x + 7} y={root.y + 2.6} className="pointer-events-none fill-muted-foreground text-[7.4px] font-medium">
              #{channel.replace(/^#/, "")} · {laid.length} {laid.length === 1 ? "message" : "messages"}
            </text>
          </g>
        )}
      </>
    ),
    [edges, laid, points, branch, citedNum, maxScore, radius, root, channel, isContext, onBranch],
  );

  const toLocal = (e: { clientX: number; clientY: number }) => {
    const r = svg.current!.getBoundingClientRect();
    return nearest(points, ((e.clientX - r.left) * W) / r.width, ((e.clientY - r.top) * H) / r.height);
  };

  const focusNode = laid.find((n) => tagOf(n) === focusTag);
  const focusPoint = focusNode ? points.get(focusNode.id) : undefined;
  const hovered = hover ? byId.get(hover) : undefined;
  const cited = laid.filter((n) => citedNum.has(tagOf(n)));
  const eng = hovered ? engagement(source, hovered.score) : null;

  return (
    <figure className="px-5">
      <div className="rounded-2xl bg-foreground/[0.025] px-2 py-2.5">
        <svg
          ref={svg}
          viewBox={`0 0 ${W} ${H}`}
          className={cn("block h-auto w-full touch-manipulation select-none", hover && "cursor-pointer")}
          role="img"
          aria-label={`A picture of the conversation: ${laid.length} messages, ${cited.length} of them cited by this answer.`}
          onPointerMove={(e) => setHover(toLocal(e))}
          onPointerDown={(e) => setHover(toLocal(e))}
          onPointerLeave={() => setHover(null)}
          // The dot is found from the click itself: on a touch screen pointerleave fires between the finger lifting
          // and the click, so the hover state is already gone by then.
          onClick={(e) => {
            const id = toLocal(e);
            const n = id ? byId.get(id) : undefined;
            if (n) onFocus(tagOf(n));
          }}
        >
          {base}
          {cited.map((n) => {
            const tag = tagOf(n);
            const p = points.get(n.id)!;
            const weak = levelOf(tag) === "weak";
            return (
              <g key={tag}>
                {lit.has(tag) && (
                  <motion.circle data-glow cx={p.x} cy={p.y} className="fill-pulse" initial={{ r: 5, opacity: 0 }} animate={{ r: 12.5, opacity: 0.22 }} transition={spring} />
                )}
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={6.4}
                  className={weak ? "fill-background stroke-pulse/70" : "fill-pulse"}
                  strokeWidth={weak ? 1 : 0}
                  strokeDasharray={weak ? "2 1.5" : undefined}
                />
                <text
                  x={p.x}
                  y={p.y + 2.6}
                  textAnchor="middle"
                  className={cn("pointer-events-none text-[7.4px] font-bold", weak ? "fill-pulse" : "fill-white")}
                >
                  {citedNum.get(tag)}
                </text>
              </g>
            );
          })}
          {hovered && (
            <circle cx={points.get(hovered.id)!.x} cy={points.get(hovered.id)!.y} r={radius(hovered) + 2.6} fill="none" className="stroke-pulse/60" strokeWidth={1.1} />
          )}
          {focusPoint && focusNode && (
            <motion.circle
              initial={false}
              animate={{ cx: focusPoint.x, cy: focusPoint.y, r: radius(focusNode) + 3.2 }}
              transition={spring}
              fill="none"
              className="stroke-foreground"
              strokeWidth={1.5}
            />
          )}
        </svg>
      </div>
      <figcaption className={cn("mt-2 min-h-[18px] text-[12px] leading-snug text-muted-foreground", hovered && "truncate")} aria-live="polite">
        {hovered && eng ? (
          <>
            <span className="font-medium text-foreground">{hovered.author}</span> · <span title={eng.long}>{eng.short} {eng.unit}</span> ·{" "}
            {shortDate(hovered.ts)}
            {hovered.text && <> · {hovered.text.split("\n")[0]}</>}
          </>
        ) : laid.length <= 1 ? (
          "A single message; nobody replied to it."
        ) : (
          mapHint(shape, engagement(source, 0).kind)
        )}
      </figcaption>
    </figure>
  );
});
