"use client";

import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { ArrowUp, RotateCcw, Square } from "lucide-react";
import type { CorroboratedClaim } from "@/lib/agent/corroborate";
import type { ChatMessage } from "@/lib/agent/ui-types";
import type { Overview } from "@/lib/data/read";
import { EvidencePanel } from "@/components/evidence/EvidencePanel";
import { EvidenceSheet } from "@/components/evidence/EvidenceSheet";
import type { Source } from "@/components/evidence/source-words";
import { questionInContext } from "@/lib/agent/flags";
import { Activity } from "./Activity";
import { answerLead, haltSteps, stepsSettled } from "./activity-words";
import { corroborationWords, answeredIn } from "./verification-words";
import { Answer } from "./Answer";
import { centredTop, clearStopped, markStopped, turnEnd } from "./chat-state";
import { evidenceOf } from "./evidence";
import { VerificationBar } from "./VerificationBar";
import { Welcome } from "./Welcome";
import { chatErrorWords } from "./error-words";

type ToolPart = Extract<ChatMessage["parts"][number], { type: `tool-${string}` }>;
const isToolPart = (p: ChatMessage["parts"][number]): p is ToolPart => p.type.startsWith("tool-");

// One conversation with the agent. `id` is the chat's id: useChat sends it with every request (the body's `id`). Chats
// are not saved (history is cut tonight), so a reload starts a new one. Clicking a citation - or a claim - opens the
// evidence sheet on that message; hovering a claim lights its messages there.

const transport = new DefaultChatTransport<ChatMessage>({ api: "/api/chat" });

// The dataset overview is the same for every chat. Each chat that opens asks again (the server caches it), and shows the
// last one it had meanwhile: kept for the whole page load, a topic added in Explore had no name in the chat opened
// after it (QA 2026-09-27).
let overviewLast: Overview | null = null;
const loadOverview = (): Promise<Overview | null> =>
  fetch("/api/overview", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((o: Overview | null) => (o ? (overviewLast = o) : overviewLast))
    .catch(() => overviewLast);

// When the free model's daily allowance is spent, retrying in a moment cannot help (api/chat, lib/llm/errors.ts).
const OUT_OF_ALLOWANCE = /allowance is used up/i;

// `more` is set when the panel was opened from a claim's "+N more": the list of those conversations, shown while
// `list` is true and one tap back from any message opened out of it.
type Focus = { messageId: string; citeId: string; tags: string[]; more?: CorroboratedClaim; list?: boolean };

const END_WORDS = {
  stopped: "Stopped before the answer was finished.",
  "stopped-checks": "Stopped before its claims were checked.",
  unfinished: "This answer was not finished.",
} as const;

export function Chat({ id, initialQuestion }: { id: string; initialQuestion?: string }) {
  // Only a press of Stop marks the answer stopped; an abort because the page went needs no note.
  const stopPressed = useRef(false);
  const { messages, setMessages, sendMessage, status, stop, error, regenerate } = useChat<ChatMessage>({
    id,
    transport,
    onFinish: ({ messages: all, isAbort }) => {
      const pressed = stopPressed.current;
      stopPressed.current = false;
      if (isAbort && pressed) setMessages(markStopped(all));
    },
  });
  const [input, setInput] = useState("");
  const [overview, setOverview] = useState<Overview | null>(overviewLast);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [hovered, setHovered] = useState<{ messageId: string; tags: string[] } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true); // follow the stream only while the reader is at the bottom
  const sentInitial = useRef(false);
  const busy = status === "submitted" || status === "streaming";

  // Ready to type on arrival. Not on a touch screen, where it would open the keyboard over the suggestions.
  useEffect(() => {
    if (window.matchMedia("(pointer: fine)").matches) inputRef.current?.focus();
  }, []);

  useEffect(() => {
    let live = true;
    loadOverview().then((o) => live && setOverview(o));
    return () => {
      live = false;
    };
  }, []);

  const ask = useCallback(
    (text: string, { keepDraft = false } = {}) => {
      const t = text.trim();
      if (!t || busy) return;
      stick.current = true;
      sendMessage({ text: t });
      // A question an answer offers is asked with a tap; whatever the reader was typing stays theirs (review 2026-09-26).
      if (!keepDraft) setInput("");
    },
    [busy, sendMessage],
  );

  // The questions an answer offers ask through this. It stays the same function, so asking does not re-render every
  // answer in the chat (AssistantMessage is memoised); it calls whichever `ask` is current.
  const askRef = useRef(ask);
  useEffect(() => {
    askRef.current = ask;
  }, [ask]);
  const askFromAnswer = useCallback((q: string) => askRef.current(q, { keepDraft: true }), []);

  useEffect(() => {
    if (!initialQuestion || sentInitial.current) return;
    // Deferred a tick so a mount that is immediately torn down (React's dev double-mount) sends nothing. The ?q= is
    // dropped at once so a reload does not ask again.
    const t = setTimeout(() => {
      sentInitial.current = true;
      window.history.replaceState(null, "", "/");
      ask(initialQuestion);
    }, 0);
    return () => clearTimeout(t);
  }, [initialQuestion, ask]);

  // Follows the answer down only once there is a conversation. On an empty chat it pinned the welcome page to its
  // bottom, so Home opened with its heading and suggestions scrolled out of view (QA 2026-09-26).
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current && messages.length > 0) el.scrollTop = el.scrollHeight;
  }, [messages, status]);

  const evidenceById = useMemo(() => new Map(messages.filter((m) => m.role === "assistant").map((m) => [m.id, evidenceOf(m)])), [messages]);
  const focusEvidence = focus ? evidenceById.get(focus.messageId) : undefined;
  const topicNames = useMemo(() => new Map((overview?.topics ?? []).map((t) => [t.key, t.name])), [overview]);

  const open = useCallback((messageId: string, citeId: string, tags: string[]) => {
    setHovered(null);
    setFocus({ messageId, citeId, tags });
  }, []);
  const openMore = useCallback((messageId: string, more: CorroboratedClaim) => {
    setHovered(null);
    setFocus({ messageId, citeId: `msg${more.more[0].ref}`, tags: more.tags, more, list: true });
  }, []);
  const hoverClaim = useCallback((messageId: string, tags: string[] | null) => setHovered(tags ? { messageId, tags } : null), []);
  const close = useCallback(() => setFocus(null), []);

  // Keyboard: "/" focuses the input, Esc closes the evidence, j / k walk the open answer's citations.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest("textarea,input");
      if (e.key === "/" && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
      } else if (e.key === "Escape") setFocus(null);
      else if (!typing && focus && focusEvidence && (e.key === "j" || e.key === "k")) {
        const list = focusEvidence.cited;
        const i = list.indexOf(focus.citeId);
        const next = list[(i + (e.key === "j" ? 1 : -1) + list.length) % list.length];
        if (next) setFocus({ ...focus, citeId: next, tags: [next] });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focus, focusEvidence]);

  // The claim under the pointer outranks the claim that was clicked, while it belongs to the same answer.
  const highlight = focus ? (hovered?.messageId === focus.messageId ? hovered.tags : focus.tags) : [];
  const last = messages.at(-1);
  const ended = turnEnd(messages, { busy, failed: Boolean(error) });
  const askAgain = () => {
    setMessages(clearStopped(messages));
    void regenerate();
  };

  return (
    // data-chat: the app shell clips its <main> under a chat, so only this page's own scroller ever moves (AppShell).
    <div data-chat className="flex h-full min-h-0">
      <section className="relative flex min-w-0 flex-1 flex-col">
        <div
          ref={scrollRef}
          data-chat-scroller
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
          // relative: hidden text and hover cards inside are placed against this box, so they scroll and clip with it
          // instead of stretching the page around it (QA 2026-09-26).
          className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto [scrollbar-gutter:stable]"
        >
          {/* chat-column: keeps its right edge clear of the floating theme toggle where the two can meet (globals.css). */}
          <div className="chat-column mx-auto w-full max-w-[720px] px-5 pt-8 pb-44 sm:px-8 sm:pt-12">
            {messages.length === 0 && <Welcome overview={overview} onAsk={ask} />}
            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={m.id} className="mb-8 flex justify-end">
                  <div className="max-w-[85%] rounded-[20px] rounded-br-md bg-foreground/[0.055] px-4 py-2.5 text-[16px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
                    {textOf(m)}
                  </div>
                </div>
              ) : (
                <AssistantMessage
                  key={m.id}
                  message={m}
                  // A follow-up ("And in July?") is read with the question it follows (flags.ts questionInContext).
                  question={questionInContext(messages.slice(0, i).filter((x) => x.role === "user").map(textOf))}
                  topicNames={topicNames}
                  activeCite={focus?.messageId === m.id ? focus.citeId : null}
                  streaming={busy && m.id === last?.id}
                  onOpen={open}
                  onOpenMore={openMore}
                  onHoverClaim={hoverClaim}
                  onAsk={askFromAnswer}
                />
              ),
            )}
            {busy && last?.role === "user" && (
              <p className="mb-8 flex items-center gap-2.5 text-[14px] text-muted-foreground" aria-live="polite">
                <span className="breathe size-1.5 rounded-full bg-pulse" aria-hidden />
                Working out where to look…
              </p>
            )}
            {ended && (
              <div className="mb-8 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-foreground/[0.08] bg-foreground/[0.02] px-4 py-3 text-[14px] text-foreground/80" role="status">
                <span className="min-w-0 flex-1">{END_WORDS[ended]}</span>
                <button type="button" onClick={askAgain} className="pressable inline-flex items-center gap-1.5 rounded-full bg-foreground px-3 py-1 text-[13px] font-medium text-background">
                  <RotateCcw className="size-3.5" /> Ask again
                </button>
              </div>
            )}
            {error && (
              <div className="mb-8 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-foreground/[0.08] bg-foreground/[0.02] px-4 py-3 text-[14px] text-foreground/80" role="status">
                <span className="min-w-0 flex-1">{chatErrorWords(error.message)}</span>
                {!OUT_OF_ALLOWANCE.test(error.message) && (
                  <button type="button" onClick={() => regenerate()} className="pressable inline-flex items-center gap-1.5 rounded-full bg-foreground px-3 py-1 text-[13px] font-medium text-background">
                    <RotateCcw className="size-3.5" /> Try again
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        <Composer
          inputRef={inputRef}
          value={input}
          onChange={setInput}
          onAsk={ask}
          busy={busy}
          onStop={() => {
            stopPressed.current = true;
            void stop();
            // The Stop button gives way to Ask as the answer stops, and focus fell to the page; the next thing a
            // reader does is type, so it goes to the box (QA 2026-09-26). Not on a touch screen, where focusing the
            // box opens the keyboard over the answer just stopped.
            if (window.matchMedia("(pointer: fine)").matches) inputRef.current?.focus();
          }}
        />
      </section>

      <EvidenceSheet open={Boolean(focus && focusEvidence)} onClose={close}>
        {(handle) =>
          focus &&
          focusEvidence && (
            <EvidencePanel
              evidence={focusEvidence}
              focusId={focus.citeId}
              highlight={highlight}
              onFocus={(citeId) => setFocus({ ...focus, citeId, tags: [citeId], list: false })}
              more={focus.more}
              listOpen={Boolean(focus.list)}
              onList={(list) => setFocus({ ...focus, list })}
              onClose={close}
              handle={handle}
              source={overview?.meta.source as Source | undefined}
              topicNames={topicNames}
            />
          )
        }
      </EvidenceSheet>
    </div>
  );
}

// A message's own words: a question as the reader typed it.
const textOf = (m: ChatMessage) => m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");

const AssistantMessage = memo(function AssistantMessage({
  message,
  question,
  topicNames,
  activeCite,
  streaming,
  onOpen,
  onOpenMore,
  onHoverClaim,
  onAsk,
}: {
  message: ChatMessage;
  question: string;
  topicNames: Map<string, string>;
  activeCite: string | null;
  streaming: boolean;
  onOpen: (messageId: string, citeId: string, tags: string[]) => void;
  onOpenMore: (messageId: string, more: CorroboratedClaim) => void;
  onHoverClaim: (messageId: string, tags: string[] | null) => void;
  onAsk: (question: string) => void;
}) {
  const evidence = useMemo(() => evidenceOf(message), [message]);
  const progress = useMemo(
    () => new Map(message.parts.flatMap((p) => (p.type === "data-scanProgress" ? [[p.data.toolCallId, p.data] as const] : []))),
    [message],
  );
  // Once the answer is no longer being written, a step still marked running was cut off by a Stop: it says so.
  const steps = haltSteps(message.parts.filter(isToolPart), streaming);
  // The chart has to agree with what the reader was told the answer covers: the question and the answer's first
  // sentence. It waits for that sentence to be written (answerLead is null until then).
  const lead = answerLead(message.parts, !streaming);
  const took = answeredIn(message.metadata?.ms);
  const [stepsOpen, setStepsOpen] = useState(false);
  const stepsId = useId();
  const article = useRef<HTMLElement>(null);
  // A number's [scan] / [aggregate] glyph opens the steps and brings the one that produced it into view. Scrolled on
  // the chat's own scroller: scrollIntoView moves every scrollable box around it, the page's too (QA 2026-09-26).
  const showStep = (tag: string) => {
    setStepsOpen(true);
    requestAnimationFrame(() => {
      const found = article.current?.querySelectorAll<HTMLElement>(`[data-tool="${tag}"]`);
      const step = found?.[found.length - 1];
      const scroller = article.current?.closest<HTMLElement>("[data-chat-scroller]");
      if (step && scroller) scroller.scrollTo({ top: centredTop(step, scroller), behavior: "smooth" });
    });
  };
  return (
    <article className="mb-12" data-message ref={article}>
      {steps.length > 0 && (
        <Activity
          steps={steps}
          progress={progress}
          topicNames={topicNames}
          open={stepsOpen}
          onOpenChange={setStepsOpen}
          id={stepsId}
          // The chart waits for the answer's text: between two steps it would show a count a later step replaces.
          settled={(!streaming || stepsSettled(message.parts)) && lead !== null}
          told={`${question}\n${lead ?? ""}`}
        />
      )}
      {evidence.text ? (
        <Answer
          evidence={evidence}
          activeId={activeCite}
          onOpen={(citeId, tags) => onOpen(message.id, citeId, tags)}
          onHoverClaim={(tags) => onHoverClaim(message.id, tags)}
          onShowStep={showStep}
          onOpenMore={(more) => onOpenMore(message.id, more)}
          // Offered questions become buttons once the answer is written: tapped mid-answer they did nothing (review
          // 2026-09-26).
          onAsk={streaming ? undefined : onAsk}
        />
      ) : streaming ? (
        <p className="flex items-center gap-2.5 text-[14px] text-muted-foreground">
          <span className="breathe size-1.5 rounded-full bg-pulse" aria-hidden />
          {steps.length ? "Reading…" : "Thinking…"}
        </p>
      ) : null}
      {(evidence.verification || took) && (
        <footer className="mt-5 flex flex-col gap-1.5 border-t border-foreground/[0.06] pt-3">
          <VerificationBar v={evidence.verification} revision={evidence.revision} />
          <CorroborationLine c={evidence.corroboration} />
          {took && <p className="text-[12px] text-muted-foreground">{took}</p>}
        </footer>
      )}
    </article>
  );
});

function Composer({
  inputRef,
  value,
  onChange,
  onAsk,
  busy,
  onStop,
}: {
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (v: string) => void;
  onAsk: (q: string) => void;
  busy: boolean;
  onStop: () => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0">
      <div className="h-8 bg-gradient-to-t from-background to-transparent" />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onAsk(value);
        }}
        className="pointer-events-auto bg-background px-4 pb-4 sm:px-8 sm:pb-6"
      >
        <div className="mx-auto flex max-w-[720px] items-end gap-2 rounded-[26px] border border-foreground/[0.1] bg-background py-1.5 pr-1.5 pl-4 shadow-[0_10px_30px_-14px_rgb(0_0_0/0.22)] transition-[border-color,box-shadow] duration-200 focus-within:border-pulse/40 focus-within:shadow-[0_10px_30px_-14px_color-mix(in_oklch,var(--pulse)_45%,transparent)]">
          <textarea
            ref={inputRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                onAsk(value);
              }
            }}
            rows={1}
            aria-label="Ask a question"
            placeholder="Ask what people are saying…"
            className="grow-field max-h-40 min-h-9 flex-1 resize-none bg-transparent py-1.5 text-[16px] leading-6 outline-none placeholder:text-muted-foreground/80"
          />
          {busy ? (
            <button type="button" onClick={onStop} className="pressable grid size-9 shrink-0 place-items-center rounded-full bg-foreground/[0.08] hover:bg-foreground/[0.12]" aria-label="Stop">
              <Square className="size-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!value.trim()}
              // The solid accent, as on Explore's Ask: white on the dark theme's light blue measured 2.72:1 (QA 2026-09-26).
              className="pressable grid size-9 shrink-0 place-items-center rounded-full bg-pulse-solid text-white disabled:bg-foreground/[0.08] disabled:text-foreground/35"
              aria-label="Ask"
            >
              <ArrowUp className="size-4" strokeWidth={2.5} />
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function CorroborationLine({ c }: { c: ReturnType<typeof evidenceOf>["corroboration"] }) {
  const words = corroborationWords(c);
  if (!words) return null;
  return (
    <p className="flex items-center gap-2 text-[12px] text-muted-foreground" aria-live="polite">
      {words.running && <span className="breathe size-1.5 rounded-full bg-pulse" aria-hidden />}
      {words.text}
    </p>
  );
}
