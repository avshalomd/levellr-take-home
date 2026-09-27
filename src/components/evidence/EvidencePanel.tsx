"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useReducedMotion } from "motion/react";
import { ChevronLeft, ListTree, X } from "lucide-react";
import type { CorroboratedClaim, MoreItem } from "@/lib/agent/corroborate";
import { plainClaim } from "@/lib/claims";
import type { MessageRow } from "@/lib/data/types";
import type { Thread, ThreadNode } from "@/lib/data/read";
import { msgTag, refOfTag } from "@/lib/refs";
import { cn } from "@/lib/utils";
import { shortDate, supportLevel, type Evidence, type Ref } from "@/components/chat/evidence";
import { Engagement, MessageCard, MessageLine, type MessageProps } from "./MessageCard";
import { plainMessage } from "./message-text";
import { moreWords, placeWords, topicNamesOf, type Source } from "./source-words";
import { ThreadMap } from "./ThreadMap";
import { answerCache } from "./answer-cache";
import { nearestScroll, stripScrollBehavior } from "./panel-focus";
import {
  branchOf,
  focusView,
  layout,
  mapGeometry,
  replyCounts,
  REPLY_PREVIEW,
  sessionOf,
  shapeOf,
  spanWords,
  threadFacts,
  type Laid,
  type Shape,
} from "./thread-tree";

// Where an answer comes from. At the top, fixed: where the conversation sits (the community, #channel), its title and
// size, and a picture of it (ThreadMap) - every message a dot, the cited ones numbered like their chips, the path to
// the open message lit, a hovered claim's messages glowing. Below, scrolling: only what the reader needs to judge the
// open message - the message itself and what it answers in full, anything further up as one-liners, its replies as
// one-liners (thread-tree.ts focusView). The rest is one tap away, in the picture or "Show the whole thread". Every
// message shows its platform's signals, engagement first (MessageCard). Nodes are keyed by their citation tag
// (msg1234), the handle the answer, the verifier and this panel share.

// A 404 is an answer ("not in the data"); a network error or a 5xx is not, and answerCache forgets it so the next
// open asks again.
const fetchThread = answerCache(async (id: string): Promise<Thread | null> => {
  const r = await fetch(`/api/thread/${encodeURIComponent(id)}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
});
const fetchFull = answerCache(async (id: string): Promise<MessageRow | undefined> => {
  const r = await fetch(`/api/messages?ids=${encodeURIComponent(id)}`);
  if (!r.ok) throw new Error(String(r.status));
  return ((await r.json()) as MessageRow[])[0];
});

const tagOf = (n: { ref: number }) => msgTag(n.ref);
const count = (n: number, one: string, many: string) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;

export function EvidencePanel({
  evidence,
  focusId,
  highlight,
  onFocus,
  onClose,
  handle,
  source,
  more,
  listOpen = false,
  onList,
  topicNames,
}: {
  evidence: Evidence;
  focusId: string;
  highlight: string[];
  onFocus: (tag: string) => void;
  onClose: () => void;
  handle?: ReactNode;
  source?: Source;
  more?: CorroboratedClaim; // opened from a claim's "+N more"
  listOpen?: boolean;
  onList?: (open: boolean) => void;
  topicNames?: Map<string, string>; // key -> the name the customer gave it, for the conversation's topics line
}) {
  // A cited message no tool returned (the verifier marks it "not retrieved") is looked up by its ref, once.
  const [extra, setExtra] = useState<Map<string, Ref>>(new Map());
  const asked = useRef(new Set<string>());
  useEffect(() => {
    const missing = evidence.cited.filter((t) => !evidence.refs.has(t) && !asked.current.has(t));
    const refs = missing.map(refOfTag).filter((r): r is number => r !== null);
    if (!refs.length) return;
    missing.forEach((t) => asked.current.add(t));
    fetch(`/api/messages?refs=${refs.join(",")}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: MessageRow[]) => setExtra((m) => new Map([...m, ...rows.map((r) => [tagOf(r), r] as const)])))
      .catch(() => {});
  }, [evidence.cited, evidence.refs]);

  const threads = useMemo(() => {
    const refOf = (tag: string) => evidence.refs.get(tag) ?? extra.get(tag);
    const out: { threadId: string; title: string; cited: string[] }[] = [];
    for (const tag of evidence.cited) {
      const r = refOf(tag);
      const threadId = r?.thread_id ?? r?.conversation_id;
      if (!r || !threadId) continue;
      let t = out.find((x) => x.threadId === threadId);
      if (!t) out.push((t = { threadId, title: r.threadTitle ?? "", cited: [] }));
      t.cited.push(tag);
    }
    return out;
  }, [evidence.cited, evidence.refs, extra]);

  const activeThread = (evidence.refs.get(focusId) ?? extra.get(focusId))?.thread_id ?? threads[0]?.threadId;

  // The open conversation's tab is kept in view in the strip, however it was reached (a chip, j / k, the tree, the
  // "+N more" list). The strip element itself is the trigger: the list replaces the strip while it is open, and a
  // message picked from it in the same conversation brought back a new strip at its start with the active tab off
  // screen, since nothing the old trigger watched had changed (review 2026-09-26). A strip just put on the page
  // jumps to its tab; one already showing scrolls there.
  const [strip, setStrip] = useState<HTMLDivElement | null>(null);
  const scrolled = useRef<HTMLDivElement | null>(null);
  const reduce = useReducedMotion();
  useEffect(() => {
    const tab = strip?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!strip || !tab) return;
    const left = nearestScroll(strip.getBoundingClientRect(), tab.getBoundingClientRect(), 20); // 20px: the strip's own padding
    if (left) strip.scrollBy({ left, behavior: stripScrollBehavior(scrolled.current !== strip, Boolean(reduce)) });
    scrolled.current = strip;
  }, [strip, activeThread, threads.length, reduce]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {handle}
      <header className={cn("flex items-center gap-3 px-5 pb-2 pr-[var(--corner-clear,1.25rem)]", handle ? "pt-1" : "pt-4")}>
        {more && !listOpen ? (
          <button
            type="button"
            onClick={() => onList?.(true)}
            className="pressable -ml-1.5 flex flex-1 items-center gap-1 text-left text-[13px] font-medium text-pulse hover:text-pulse/80"
          >
            <ChevronLeft className="size-4" aria-hidden />
            All {more.moreTotal.toLocaleString("en-GB")} that say this
          </button>
        ) : (
          <p className="flex-1 text-[13px] font-medium text-muted-foreground">{more ? "More conversations that say this" : "Where this comes from"}</p>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close (Esc)"
          className="pressable grid size-8 place-items-center rounded-full bg-foreground/[0.05] text-foreground/70 hover:bg-foreground/[0.09] hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </header>

      {more && listOpen ? (
        <MoreList c={more} source={source} onPick={onFocus} />
      ) : (
        <>
      {threads.length > 1 && (
        <div ref={setStrip} className="no-scrollbar flex shrink-0 gap-1.5 overflow-x-auto px-5 pb-3" role="tablist" aria-label="Conversations this answer cites">
          {threads.map((t, i) => {
            const on = t.threadId === activeThread;
            const lit = !on && t.cited.some((c) => highlight.includes(c));
            return (
              <button
                type="button"
                role="tab"
                aria-selected={on}
                key={t.threadId}
                onClick={() => onFocus(t.cited[0])}
                title={t.title}
                className={cn(
                  "pressable flex max-w-56 shrink-0 items-center gap-2 rounded-full border px-3 py-1 text-[13px]",
                  on ? "border-pulse/30 bg-pulse-soft text-foreground" : "border-foreground/[0.09] text-foreground/70 hover:bg-foreground/[0.03]",
                  lit && "border-pulse/50",
                )}
              >
                <span className="truncate">{t.title || `Conversation ${i + 1}`}</span>
                <span className="shrink-0 text-[12px] text-muted-foreground">{t.cited.length}</span>
              </button>
            );
          })}
        </div>
      )}

      {activeThread ? (
        <ThreadView
          key={activeThread}
          threadId={activeThread}
          evidence={evidence}
          focusId={focusId}
          highlight={highlight}
          onFocus={onFocus}
          source={source}
          topicNames={topicNames}
        />
      ) : (
        <TreeSkeleton />
      )}
        </>
      )}
    </div>
  );
}

// The conversations behind a claim's "+N more", best first: the claim, then one row per conversation with the message
// that says it, its author, when, and its engagement. A row opens that message in its thread; the header leads back.
function MoreList({ c, source, onPick }: { c: CorroboratedClaim; source?: Source; onPick: (tag: string) => void }) {
  const cited = c.conversations - c.moreTotal;
  // relative: its sr-only engagement words are placed against this scroller, not against main, which they made scroll
  // (QA 2026-09-26).
  return (
    <div className="relative min-h-0 flex-1 overflow-y-auto px-5 pb-8">
      <p className="text-[15px] leading-snug text-foreground">{plainClaim(c.claim)}</p>
      <p className="mt-1.5 text-[13px] text-muted-foreground">{moreWords(c.conversations, cited, c.more.length, c.moreTotal)}</p>
      <ul className="mt-4 space-y-2">
        {c.more.map((m) => (
          <MoreRow key={m.ref} m={m} source={source} onPick={onPick} />
        ))}
      </ul>
    </div>
  );
}

function MoreRow({ m, source, onPick }: { m: MoreItem; source?: Source; onPick: (tag: string) => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onPick(msgTag(m.ref))}
        className="pressable w-full rounded-2xl border border-foreground/[0.07] p-3.5 text-left transition-colors hover:border-pulse/30 hover:bg-pulse-soft/40"
      >
        <span className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <Engagement node={m} source={source} size="sm" />
          <span className="truncate font-medium text-foreground/85">{m.author}</span>
          <span className="shrink-0" title={shortDate(m.ts, true)}>{shortDate(m.ts)}</span>
        </span>
        {m.threadTitle && <span className="mt-1.5 block truncate text-[12px] text-muted-foreground">in {m.threadTitle}</span>}
        <span className="mt-1 line-clamp-3 block text-[14px] leading-relaxed text-foreground/90">{plainMessage(m.text) || "This message was removed."}</span>
      </button>
    </li>
  );
}

function ThreadView({
  threadId,
  evidence,
  focusId,
  highlight,
  onFocus,
  source,
  topicNames,
}: {
  threadId: string;
  evidence: Evidence;
  focusId: string;
  highlight: string[];
  onFocus: (tag: string) => void;
  source?: Source;
  topicNames?: Map<string, string>;
}) {
  // undefined = loading, null = not in the data (404), "error" = the request failed and can be retried.
  const [got, setGot] = useState<{ id: string; thread: Thread | null | "error" }>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    fetchThread(threadId).then(
      (t) => live && setGot({ id: threadId, thread: t }),
      () => live && setGot({ id: threadId, thread: "error" }),
    );
    return () => {
      live = false;
    };
  }, [threadId, attempt]);
  const loaded = got?.id === threadId ? got.thread : undefined;
  const thread = loaded === "error" ? null : loaded;

  // The picture: the whole thread as a tree, or - for a chat session - the session around the open message as a
  // timeline. Everything below is derived from the thread and the open message.
  const focusRaw = thread?.nodes.find((n) => tagOf(n) === focusId)?.id;
  const shape: Shape = useMemo(() => (thread ? shapeOf(thread.nodes) : "tree"), [thread]);
  const laid = useMemo(() => {
    if (!thread) return [];
    return layout(shape === "timeline" && focusRaw ? sessionOf(thread.nodes, focusRaw) : thread.nodes);
  }, [thread, shape, focusRaw]);
  const geometry = useMemo(() => mapGeometry(laid), [laid]);
  const byTag = useMemo(() => new Map(laid.map((n) => [tagOf(n), n])), [laid]);
  const citedNum = useMemo(() => new Map(evidence.cited.map((t, i) => [t, i + 1])), [evidence.cited]);
  const levelOf = useCallback((tag: string) => supportLevel(evidence.support.get(tag)), [evidence.support]);
  const lit = useMemo(() => new Set(highlight), [highlight]);
  const branch = useMemo(() => {
    const ids = [focusRaw, ...highlight.map((t) => byTag.get(t)?.id)].filter((x): x is string => !!x);
    return branchOf(laid, ids, shape);
  }, [laid, shape, focusRaw, highlight, byTag]);
  const replies = useMemo(() => replyCounts(laid), [laid]);
  const topId = useMemo(() => {
    const comments = laid.filter((n) => n.score > 0);
    return comments.length >= 3 ? comments.reduce((a, b) => (b.score > a.score ? b : a)).id : null;
  }, [laid]);
  const view = useMemo(() => (focusRaw ? focusView(laid, focusRaw, shape) : null), [laid, focusRaw, shape]);

  // What the reader opened beyond the default, remembered for this message only: a new focus starts collapsed again.
  const [opened, setOpened] = useState<{ focus: string; ids: Set<string>; allReplies: boolean; whole: boolean }>();
  const mine = opened?.focus === focusId ? opened : { focus: focusId, ids: new Set<string>(), allReplies: false, whole: false };
  const change = (patch: Partial<typeof mine>) => setOpened({ ...mine, ...patch });

  const focusText = useFullText(view?.focus.id);
  const parentText = useFullText(view?.parent?.id);

  // Keep the open message in view: from the top when everything above it fits, else from the message it answers (so
  // "Replying to" is never cut in half), else from the open message itself when even that pair is taller than the list.
  // Placed again whenever the content changes size until the reader takes over (QA 2026-09-26: placed once, before
  // the full texts landed, the list stopped at ~300px while the full opening post pushed the cited reply 25,000px
  // down). A wheel, a touch, a key or a press in the list is the reader taking over, so opening "Show the whole post"
  // never yanks the list back to the reply.
  const list = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  useEffect(() => {
    const box = list.current;
    const content = box?.firstElementChild;
    if (!box || !content) return;
    const place = (behavior: ScrollBehavior) => {
      const card = box.querySelector<HTMLElement>('[data-tag-card="focus"], [data-row-focused]');
      if (!card) return;
      const origin = box.getBoundingClientRect().top - box.scrollTop; // where scrollTop 0 sits on screen
      const at = (el: HTMLElement) => el.getBoundingClientRect().top - origin;
      const bottom = at(card) + Math.min(card.offsetHeight, 220);
      const context = box.querySelector<HTMLElement>('[data-tag-card="context"]');
      const pad = mine.whole ? 56 : 16; // the whole-thread list has a sticky bar over its top
      const top =
        bottom <= box.clientHeight ? 0 : context && bottom - at(context) + pad <= box.clientHeight ? at(context) - pad : at(card) - pad;
      box.scrollTo({ top: Math.max(0, top), behavior });
    };
    place(reduce ? "auto" : "smooth");
    let taken = false;
    const takeOver = () => {
      taken = true;
      ro.disconnect();
    };
    const ro = new ResizeObserver(() => !taken && place("auto"));
    ro.observe(content);
    void document.fonts?.ready.then(() => !taken && place("auto"));
    const events = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
    events.forEach((t) => box.addEventListener(t, takeOver, { passive: true }));
    return () => {
      taken = true;
      ro.disconnect();
      events.forEach((t) => box.removeEventListener(t, takeOver));
    };
  }, [focusId, mine.whole, laid.length, reduce]);

  if (loaded === undefined) return <TreeSkeleton />;
  if (loaded === "error")
    return (
      <p className="px-5 py-6 text-[14px] text-muted-foreground">
        This conversation did not load.{" "}
        <button type="button" className="font-medium text-pulse hover:underline" onClick={() => {
            setGot(undefined); // back to the skeleton while it asks again
            setAttempt((x) => x + 1);
          }}>
          Try again
        </button>
      </p>
    );
  if (!thread) return <p className="px-5 py-6 text-[14px] text-muted-foreground">This conversation is not in the data any more.</p>;

  const facts = threadFacts(laid, new Set(evidence.cited), msgTag);
  const place = placeWords(source, thread.channel);
  // The open message's conversation keeps every topic it discusses (D46); they are shown primary first. A thread can
  // hold several conversations, so the line follows the open message rather than the thread.
  const topics = topicNamesOf(thread.nodes.find((n) => tagOf(n) === focusId)?.topics, topicNames ?? new Map());
  // A message from another session than the open one was attached as context (a reply here answers it): shown, dimmed
  // and labelled, never counted as this conversation's.
  const focusConv = thread.nodes.find((n) => tagOf(n) === focusId)?.conversation_id ?? null;
  const props = (n: ThreadNode) => {
    const tag = tagOf(n);
    const context = focusConv !== null && n.conversation_id !== focusConv;
    return { node: n, source, num: citedNum.get(tag) ?? 0, level: levelOf(tag), replies: replies.get(n.id) ?? 0, top: n.id === topId, lit: lit.has(tag), context };
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 pb-3">
        <div className="px-5 pb-3">
          <p className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted-foreground">
            {place.where && <span className="truncate font-medium text-foreground/75">{place.where}</span>}
            {place.tag && <span className="shrink-0 rounded-full bg-foreground/[0.06] px-2 py-px text-[12px]">{place.tag}</span>}
          </p>
          <h3 className="mt-1 line-clamp-2 text-[17px] leading-snug font-semibold tracking-[-0.01em] text-balance">{thread.title}</h3>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
            {count(facts.messages, "message", "messages")} from {count(facts.people, "person", "people")}
            {facts.messages > 1 && <> {spanWords(facts.startedAt, facts.endedAt)}</>}
            {shape === "timeline" && " in this session"}
            {facts.cited > 0 && <> · this answer cites {facts.cited}</>}
          </p>
          {topics.length > 0 && (
            <ul
              className="mt-2 flex flex-wrap gap-1.5"
              aria-label={topics.length === 1 ? "Topic of this conversation" : "Topics of this conversation, the main one first"}
            >
              {topics.map((name, i) => (
                <li
                  key={name}
                  className={
                    i === 0
                      ? "rounded-full bg-pulse-soft px-2.5 py-0.5 text-[12px] font-medium text-foreground/85"
                      : "rounded-full bg-foreground/[0.05] px-2.5 py-0.5 text-[12px] text-muted-foreground"
                  }
                >
                  {name}
                </li>
              ))}
            </ul>
          )}
        </div>
        <ThreadMap
          laid={laid}
          geometry={geometry}
          shape={shape}
          source={source}
          channel={thread.channel}
          focusConv={focusConv}
          citedNum={citedNum}
          levelOf={levelOf}
          lit={lit}
          branch={branch}
          focusTag={focusId}
          onFocus={onFocus}
        />
      </div>

      <div ref={list} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-foreground/[0.06] [scrollbar-width:thin]">
        {mine.whole ? (
          <WholeThread laid={laid} shape={shape} focusId={focusId} props={props} onFocus={onFocus} onBack={() => change({ whole: false })} />
        ) : view ? (
          <div className="space-y-2.5 px-4 pt-4 pb-10">
            {view.chain.length > 0 && (
              <section aria-label="Earlier in the thread">
                <p className="px-1 pb-1 text-[12px] font-medium text-muted-foreground">Earlier in the thread</p>
                {view.chain.map((n) =>
                  mine.ids.has(n.id) ? (
                    <div key={n.id} className="py-1">
                      <MessageCard {...props(n)} clamp />
                    </div>
                  ) : (
                    <MessageLine key={n.id} {...props(n)} hint="Show this message" onClick={() => change({ ids: new Set(mine.ids).add(n.id) })} />
                  ),
                )}
              </section>
            )}
            {view.parentMissing && !view.parent && (
              <p className="px-1 pb-1 text-[12px] text-muted-foreground">A reply to a message that is not in the data (deleted or not collected).</p>
            )}
            {view.parent && (
              <MessageCard
                key={view.parent.id}
                {...props(view.parent)}
                fullText={parentText}
                label={view.parentIs === "just-before" ? "Just before" : "Replying to"}
                clamp
              />
            )}
            <div className={cn(view.parent && "pl-3")}>
              <MessageCard {...props(view.focus)} fullText={focusText} focused label={view.parent ? undefined : "The message"} />
            </div>
            {view.replies.length > 0 && (
              <section aria-label="Replies" className={cn("pt-2", view.parent && "pl-3")}>
                <p className="px-1 pb-1 text-[12px] font-medium text-muted-foreground">
                  {count(view.replies.length, "reply", "replies")}
                  {view.replies.length > 1 && ", most engaged first"}
                </p>
                {(mine.allReplies ? view.replies : view.replies.slice(0, REPLY_PREVIEW)).map((n) => (
                  <MessageLine key={n.id} {...props(n)} hint="Open this reply" onClick={() => onFocus(tagOf(n))} />
                ))}
                {!mine.allReplies && view.replies.length > REPLY_PREVIEW && (
                  <button type="button" onClick={() => change({ allReplies: true })} className="px-2.5 py-1.5 text-[13px] font-medium text-pulse hover:underline">
                    Show {view.replies.length - REPLY_PREVIEW} more {view.replies.length - REPLY_PREVIEW === 1 ? "reply" : "replies"}
                  </button>
                )}
              </section>
            )}
            {laid.length > 2 && (
              <button
                type="button"
                onClick={() => change({ whole: true })}
                className="pressable mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl border border-foreground/[0.08] py-2.5 text-[13px] font-medium text-foreground/80 hover:bg-foreground/[0.03]"
              >
                <ListTree className="size-4" aria-hidden /> Show the whole {shape === "timeline" ? "session" : "thread"} ({count(laid.length, "message", "messages")})
              </button>
            )}
          </div>
        ) : (
          <p className="px-5 py-6 text-[14px] text-muted-foreground">This message is not in the conversation any more.</p>
        )}
      </div>
    </div>
  );
}

/** Every message of the conversation as one-line rows, replies indented under what they answer, the open one ringed. */
function WholeThread({
  laid,
  shape,
  focusId,
  props,
  onFocus,
  onBack,
}: {
  laid: Laid<ThreadNode>[];
  shape: Shape;
  focusId: string;
  props: (n: ThreadNode) => MessageProps;
  onFocus: (tag: string) => void;
  onBack: () => void;
}) {
  const rows = shape === "timeline" ? [...laid].sort((a, b) => a.ts.localeCompare(b.ts)) : laid;
  return (
    <div className="pb-10">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 bg-background/90 px-5 py-2.5 backdrop-blur">
        <p className="text-[12px] font-medium text-muted-foreground">
          The whole {shape === "timeline" ? "session" : "thread"}, {count(laid.length, "message", "messages")}
        </p>
        <button type="button" onClick={onBack} className="text-[13px] font-medium text-pulse hover:underline">
          Back to the message
        </button>
      </div>
      <ol className="px-3">
        {rows.map((n) => {
          const tag = tagOf(n);
          const indent = shape === "tree" ? Math.min(n.depth, 6) * 12 : 0;
          return (
            <li
              key={tag}
              data-tag={tag}
              data-lit={props(n).lit || undefined}
              data-row-focused={tag === focusId || undefined}
              className="relative"
              style={{ paddingLeft: indent }}
            >
              {indent > 0 && <span aria-hidden className="tree-guides absolute inset-y-0 left-[16px]" style={{ width: indent }} />}
              <MessageLine {...props(n)} hint="Open this message" onClick={() => onFocus(tag)} current={tag === focusId} />
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** A message's full text (the thread carries 400-character previews), fetched once and cached. */
function useFullText(id: string | undefined): string | undefined {
  const [got, setGot] = useState<{ id: string; text?: string }>();
  useEffect(() => {
    if (!id) return;
    let live = true;
    fetchFull(id).then(
      (m) => live && setGot({ id, text: m?.text }),
      () => undefined, // the preview stays; the next open of this message asks again
    );
    return () => {
      live = false;
    };
  }, [id]);
  return got && got.id === id ? got.text : undefined;
}

function TreeSkeleton() {
  return (
    <div className="space-y-3 px-5 pt-2" aria-busy="true" aria-label="Loading the conversation">
      <div className="h-5 w-3/4 animate-pulse rounded bg-foreground/[0.06]" />
      <div className="h-3.5 w-full animate-pulse rounded bg-foreground/[0.04]" />
      {[0, 1, 2, 1, 2].map((d, i) => (
        <div key={i} className="h-14 animate-pulse rounded-xl bg-foreground/[0.04]" style={{ marginLeft: d * 14 }} />
      ))}
    </div>
  );
}
