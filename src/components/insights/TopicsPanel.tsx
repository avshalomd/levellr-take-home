"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useId, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { fmtInt } from "@/lib/data/insights-model";
import {
  addToDraft,
  buildDraft,
  dropFromDraft,
  eta,
  formatUsd,
  isNewKey,
  isOther,
  nameTaken,
  nextNewKey,
  proposalWords,
  shownDescription,
  sourceLine,
  topicCountWords,
  viewLabels,
  type ViewLabel,
} from "@/lib/data/insights-labels";
import type { MoodTarget } from "@/lib/data/mood-target";
import { SPRING } from "./Segmented";
import { inGridOrder } from "./topic-order";
import type { Proposal, useTaxonomy } from "./use-taxonomy";

type Tax = ReturnType<typeof useTaxonomy>;

const field =
  "w-full rounded-lg border border-foreground/12 bg-background px-3 py-2 text-[14px] text-foreground outline-none transition-shadow placeholder:text-muted-foreground focus:border-pulse/60 focus:ring-3 focus:ring-pulse/15";
const quiet =
  "pressable inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13.5px] font-medium text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground disabled:pointer-events-none disabled:opacity-40";
// White on the dark theme's light-blue accent is 2.8:1; a solid button sits on the --pulse-solid token instead, as Ask
// does (globals.css; QA 2026-09-26, one token since review 2026-09-26).
const primary =
  "pressable inline-flex items-center justify-center gap-1.5 rounded-full bg-pulse-solid px-4 py-2 text-[14px] font-semibold text-white disabled:pointer-events-none disabled:opacity-40";
const secondary =
  "pressable inline-flex items-center justify-center gap-1.5 rounded-full border border-foreground/12 px-4 py-2 text-[14px] font-medium text-foreground hover:bg-foreground/[0.04] disabled:pointer-events-none disabled:opacity-40";

/**
 * The topic labels behind the grid, and the way to change them. A conversation can have several topics, each its own
 * yes or no (D46). Renaming, combining and rewording apply at once; adding or redefining a topic means asking about
 * that topic again, so those collect into one pending change, priced for those topics alone before it starts; removing
 * a topic asks nothing and is free, but waits in the same change so it is confirmed.
 */
export function TopicsPanel({
  taxonomy,
  onError,
  onDone,
  totalConversations,
  gridOrder,
}: {
  taxonomy: Tax;
  onError: (message: string) => void;
  onDone: (message: string) => void;
  totalConversations: number;
  gridOrder: string[]; // the grid's topic keys, top row first
}) {
  const { tax, unavailable, pending, setPending } = taxonomy;
  const [picked, setPicked] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);

  const active = useMemo(() => tax?.active.labels ?? [], [tax]);
  const view = useMemo(() => inGridOrder(viewLabels(active, pending), gridOrder), [active, pending, gridOrder]);
  const draft = useMemo(() => buildDraft(active, pending), [active, pending]);
  const job = tax?.job ?? null;
  const running = job?.status === "running";
  const left = tax ? Math.max(0, tax.budget.capUsd - tax.budget.spentUsd) : 0;

  const fail = (e: unknown) => onError(e instanceof Error ? e.message : String(e));

  const rename = (l: ViewLabel, name: string) => {
    const n = name.trim();
    if (!n || n === l.name) return;
    if (nameTaken(view, n, l.key)) return onError(`There is already a topic called “${n}”.`);
    if (isNewKey(l.key)) setPending((p) => addToDraft(p, { op: "rename", key: l.key, name: n }));
    else taxonomy.edit({ op: "rename", key: l.key, name: n }).catch(fail);
  };

  const reword = (l: ViewLabel, description: string, relabel: boolean) => {
    const d = description.trim();
    // The catch-all's editor opens on its shown wording, not the stored one the labeller reads (D32): saving that
    // unchanged is not an edit.
    if (d === shownDescription(l) && d !== l.description) return;
    if (isNewKey(l.key)) setPending((p) => addToDraft(p, { op: "describe", key: l.key, description: d }));
    else if (relabel) setPending((p) => addToDraft(p, { op: "redefine", key: l.key, description: d }));
    else taxonomy.edit({ op: "describe", key: l.key, description: d }).catch(fail);
  };

  const combine = (name: string) => {
    const keys = picked;
    setPicked([]);
    taxonomy
      .edit({ op: "merge", keys, name: name.trim() })
      .then(() => onDone(`Combined into “${name.trim()}”.`))
      .catch(fail);
  };

  const finish = (status: string) => {
    if (status === "done") onDone("Done. The grid now uses your topics.");
    else if (status === "failed") onError("Sorting stopped with an error. Nothing was lost; you can try again.");
    else if (status === "cancelled") onDone("Sorting cancelled. The previous topics are still in use.");
    else if (status === "error") onError("Lost contact while sorting. It will pick up where it stopped when you resume.");
  };

  if (unavailable && !tax) {
    return (
      <Shell>
        <p className="text-[14px] text-muted-foreground">Topics cannot be edited right now.</p>
      </Shell>
    );
  }
  if (!tax) {
    return (
      <Shell>
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-xl bg-foreground/[0.04]" />
          ))}
        </div>
      </Shell>
    );
  }

  const pickable = (l: ViewLabel) => !isOther(l.key) && !isNewKey(l.key) && l.status !== "removed";

  return (
    <Shell
      // Where the topics came from and when. What is left of the relabelling budget is not a reader's business until a
      // relabel is priced, so it is said there (the review under "changes waiting"), not on the page.
      meta={sourceLine(tax.active.source, tax.active.createdAt)}
      moodTarget={tax.moodTarget ?? null}
    >
      <AnimatePresence initial={false}>
        {job && (running || taxonomy.driving) && (
          <Progress key="progress" taxonomy={taxonomy} onFinish={finish} />
        )}
      </AnimatePresence>

      <fieldset disabled={running} className={cn("flex flex-col gap-5 transition-opacity", running && "opacity-60")}>
        <ul className="flex flex-col divide-y divide-foreground/[0.06] rounded-2xl border border-foreground/[0.07] bg-card">
          {view.map((l) => (
            <LabelRow
              key={l.key}
              label={l}
              total={totalConversations}
              picked={picked.includes(l.key)}
              onPick={pickable(l) ? (on) => setPicked((p) => (on ? [...p, l.key] : p.filter((k) => k !== l.key))) : undefined}
              onRename={(n) => rename(l, n)}
              onReword={(d, relabel) => reword(l, d, relabel)}
              onRemove={() => setPending((p) => addToDraft(p, { op: "remove", key: l.key }))}
              onUndo={() => setPending((p) => dropFromDraft(p, l.key))}
            />
          ))}
        </ul>
        {/* The counts overlap (D46); said once under the list rather than on every row. */}
        <p className="-mt-2 text-[13px] text-muted-foreground">
          A conversation can touch several topics, so these counts can add up to more than the {fmtInt(totalConversations)} conversations.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={quiet} onClick={() => setAdding((x) => !x)}>
            <Plus className="size-4" />
            Add a topic
          </button>
        </div>

        <AnimatePresence initial={false}>
          {adding && (
            <AddForm
              key="add"
              taken={(n) => nameTaken(view, n)}
              onAdd={(name, description) => {
                setPending((p) => addToDraft(p, { op: "add", key: nextNewKey(p), name, description }));
                setAdding(false);
              }}
              onCancel={() => setAdding(false)}
            />
          )}
        </AnimatePresence>
      </fieldset>

      {/* What is waiting on the reader stays in reach however long the list is. */}
      <div className="sticky bottom-4 z-20 flex flex-col gap-3 empty:hidden">
      <AnimatePresence initial={false}>
        {picked.length >= 2 && !running && (
          <CombineBar
            key={picked.join()}
            names={picked.map((k) => view.find((l) => l.key === k)?.name ?? k)}
            taken={(n) => nameTaken(view.filter((l) => !picked.includes(l.key)), n)}
            onCombine={combine}
            onCancel={() => setPicked([])}
          />
        )}
        {pending.length > 0 && !running && (
          <DraftTray
            key="draft"
            changes={draft.changes}
            problems={draft.problems}
            budgetLeft={left}
            onPropose={() => taxonomy.propose(draft.labels)}
            onStart={(p) => taxonomy.start(p.draftId).then(finish, fail)}
            onDiscard={() => setPending([])}
            onError={fail}
          />
        )}
      </AnimatePresence>
      </div>

      {job && job.status === "failed" && !taxonomy.driving && (
        <p className="text-[13px] text-neg">The last sort stopped with an error{job.error ? `: ${job.error}` : "."}</p>
      )}
    </Shell>
  );
}

function Shell({ meta, moodTarget, children }: { meta?: ReactNode; moodTarget?: MoodTarget | null; children: ReactNode }) {
  return (
    <section id="topics" aria-labelledby="topics-title" className="flex scroll-mt-6 flex-col gap-5">
      <div>
        <h2 id="topics-title" className="text-[22px] leading-tight font-semibold tracking-[-0.015em] text-foreground">
          Topics
        </h2>
        <p className="mt-1 max-w-2xl text-[14px] leading-relaxed text-muted-foreground">
          Topics are what you want to track, and a conversation can belong to several of them. Rename or combine topics
          and the grid changes at once. Adding a topic, or changing what one means, asks about that topic alone in every
          conversation: that costs a little, and you see the cost and confirm it before anything starts. Removing a
          topic is free.
        </p>
        {meta && <p className="mt-1.5 text-[13px] text-muted-foreground">{meta}</p>}
      </div>
      {moodTarget && <MoodTargetNote target={moodTarget} />}
      {children}
    </section>
  );
}

/**
 * What the mood is measured towards, found when the community was loaded (D46). Read-only: it frames every mood
 * figure on the page, and it is not one of the team's topics. Exported for its test.
 */
export function MoodTargetNote({ target }: { target: MoodTarget }) {
  return (
    <div className="max-w-2xl rounded-2xl border border-foreground/[0.07] bg-card px-4 py-3">
      <p className="text-[14px] text-foreground">
        <span className="font-semibold">Mood is measured towards</span> {target.target}
      </p>
      {target.why && <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{target.why}</p>}
    </div>
  );
}

// ---------- one topic ----------

/** One topic in the editor. Exported for its test (TopicsPanel.test.tsx). */
export function LabelRow({
  label: l,
  total,
  picked,
  onPick,
  onRename,
  onReword,
  onRemove,
  onUndo,
}: {
  label: ViewLabel;
  total: number;
  picked: boolean;
  onPick?: (on: boolean) => void;
  onRename: (name: string) => void;
  onReword: (description: string, relabel: boolean) => void;
  onRemove: () => void;
  onUndo: () => void;
}) {
  const [naming, setNaming] = useState(false);
  const [wording, setWording] = useState(false);
  const other = isOther(l.key);
  const isNew = l.status === "new";
  const removed = l.status === "removed";
  const count = topicCountWords(l.name, l.n, total);
  const descId = useId();
  const described = shownDescription(l);

  return (
    <li className={cn("flex gap-3 px-4 py-3.5", removed && "opacity-55")}>
      <div className="pt-0.5">
        {onPick ? (
          // A box drawn in the page's colours: the browser's own is a light grey square on the dark theme (QA
          // 2026-09-26). The input is still the real control; the tick is drawn over it.
          <span className="relative grid size-4 place-items-center">
            <input
              type="checkbox"
              checked={picked}
              onChange={(e) => onPick(e.target.checked)}
              aria-label={`Choose ${l.name} to combine`}
              className="peer size-4 cursor-pointer appearance-none rounded-[5px] border border-foreground/30 bg-background transition-colors hover:border-foreground/50 checked:border-pulse checked:bg-pulse disabled:cursor-default"
            />
            <Check aria-hidden strokeWidth={3} className="pointer-events-none absolute size-3 text-white opacity-0 peer-checked:opacity-100" />
          </span>
        ) : (
          <span className="block size-4" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          {naming && !other && !removed ? (
            <InlineName
              initial={l.name}
              onDone={(n) => {
                setNaming(false);
                if (n !== null) onRename(n);
              }}
            />
          ) : (
            // The name and the description are the editor's controls, live whenever the list is (this section is the
            // topic editor; "Edit topics" only brings it into view). They say what they do: a name for a screen reader,
            // and a pencil on hover or focus, always shown on a touch screen, which has no hover (QA 2026-09-26: the
            // only hint was a "Rename" tooltip). The catch-all's name cannot change, so it gets neither.
            <button
              type="button"
              disabled={other || removed}
              onClick={() => setNaming(true)}
              aria-label={other || removed ? undefined : `Rename ${l.name}`}
              title={other ? "Conversations that fit no other topic" : undefined}
              className={cn(
                "group inline-flex items-center gap-1.5 rounded-md text-left text-[15px] font-semibold text-foreground",
                removed && "line-through",
              )}
            >
              {l.name}
              {!other && !removed && <EditMark />}
            </button>
          )}
          {!isNew && (
            // The share of all conversations that touch this topic (the title says so in full). No alpha on it: faded
            // it read 3.1:1 (QA 2026-09-26).
            <span className="text-[13px] text-muted-foreground" title={count.title}>
              {count.text}
            </span>
          )}
          {l.status !== "kept" && (
            <span
              className={cn(
                "rounded-full px-2 py-px text-[12px] font-medium",
                isNew && "bg-pulse/10 text-pulse",
                removed && "bg-neg/10 text-neg",
                l.status === "redefined" && "bg-foreground/[0.06] text-foreground/80",
              )}
            >
              {isNew ? "New" : removed ? "Will be removed" : "New wording"}
            </span>
          )}
        </div>

        {wording ? (
          <DescriptionEditor
            initial={shownDescription(l)}
            canRelabel={!isNew && !other}
            onSave={(d, relabel) => {
              setWording(false);
              onReword(d, relabel);
            }}
            onCancel={() => setWording(false)}
          />
        ) : (
          <button
            type="button"
            disabled={removed}
            onClick={() => setWording(true)}
            aria-label={described ? `Edit the description of ${l.name}` : `Add a description to ${l.name}`}
            aria-describedby={described ? descId : undefined}
            className={cn(
              "group mt-1 block max-w-2xl text-left text-[13.5px] leading-relaxed",
              described ? "text-muted-foreground hover:text-foreground" : "text-pulse hover:underline",
            )}
          >
            <span id={descId}>
              {described && !removed ? (
                <MarkedText text={described} />
              ) : (
                described || (other ? "Describe what belongs nowhere else" : "Add a description")
              )}
            </span>
          </button>
        )}
      </div>
      <div className="flex shrink-0 items-start gap-1">
        {l.status !== "kept" ? (
          <button type="button" onClick={isNew ? onRemove : onUndo} className={quiet} aria-label={`Undo the change to ${l.name}`}>
            <RotateCcw className="size-3.5" />
            Undo
          </button>
        ) : (
          !other && (
            <button type="button" onClick={onRemove} className={quiet} aria-label={`Remove ${l.name}`}>
              <Trash2 className="size-3.5" />
              <span className="hidden sm:inline">Remove</span>
            </button>
          )
        )}
      </div>
    </li>
  );
}

/** The pencil beside an editable name or description: shown while the pointer or the keyboard is on it, and always on a
 * touch screen. Decoration only; the button's own name says what it does. */
function EditMark({ className }: { className?: string }) {
  return (
    <Pencil
      aria-hidden
      className={cn(
        "size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 [@media(hover:none)]:opacity-100",
        className,
      )}
    />
  );
}

/**
 * A description with the pencil after its last word, kept on that word's line. Loose after the text, the hidden pencil
 * wrapped onto a line of its own whenever the last line was nearly full, and that card stood a line taller than its
 * neighbours with nothing to show for it (QA 2026-09-26). Exported for its test.
 */
export function MarkedText({ text }: { text: string }) {
  const cut = text.trimEnd().lastIndexOf(" ") + 1; // 0 when it is one word
  return (
    <>
      {text.slice(0, cut)}
      <span className="whitespace-nowrap">
        {text.slice(cut)}
        <EditMark className="ml-1.5 inline align-[-1px]" />
      </span>
    </>
  );
}

function InlineName({ initial, onDone }: { initial: string; onDone: (name: string | null) => void }) {
  const [v, setV] = useState(initial);
  return (
    <input
      autoFocus
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => onDone(v)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onDone(v);
        if (e.key === "Escape") {
          e.preventDefault();
          onDone(null);
        }
      }}
      aria-label="Topic name"
      className={cn(field, "max-w-xs py-1 text-[15px] font-semibold")}
    />
  );
}

function DescriptionEditor({
  initial,
  canRelabel,
  onSave,
  onCancel,
}: {
  initial: string;
  canRelabel: boolean;
  onSave: (description: string, relabel: boolean) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState(initial);
  return (
    <div className="mt-2 flex max-w-2xl flex-col gap-2">
      <textarea
        autoFocus
        rows={2}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        placeholder="What counts as this topic, and what does not, in a sentence or two"
        aria-label="Description"
        className={cn(field, "resize-y leading-relaxed")}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={secondary} onClick={() => onSave(v, false)} title="Changes the wording only; no conversation is asked again">
          Save wording
        </button>
        {canRelabel && (
          <button
            type="button"
            className={secondary}
            onClick={() => onSave(v, true)}
            title="Adds this to the changes waiting: once you start, every conversation is asked about this topic again, and only this one"
          >
            Save and ask again
          </button>
        )}
        <button type="button" className={quiet} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------- combining, adding ----------

const panelMotion = {
  initial: { opacity: 0, y: -6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6, transition: { duration: 0.12 } },
};

function useMotion() {
  const reduce = useReducedMotion();
  return reduce ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.15 } } : { ...panelMotion, transition: SPRING };
}

function CombineBar({
  names,
  taken,
  onCombine,
  onCancel,
}: {
  names: string[];
  taken: (name: string) => boolean;
  onCombine: (name: string) => void;
  onCancel: () => void;
}) {
  const m = useMotion();
  const [v, setV] = useState(names[0] ?? "");
  const clash = v.trim() !== "" && taken(v);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (v.trim() && !clash) onCombine(v);
  };
  return (
    <motion.form {...m} onSubmit={submit} className="flex flex-col gap-3 rounded-2xl bg-background/[0.93] backdrop-blur-xl border border-foreground/[0.08] p-4 shadow-[0_14px_40px_-14px_rgb(0_0_0/0.3)] sm:flex-row sm:items-end">
      <label className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="text-[13.5px] text-muted-foreground">
          Combine {names.length === 2 ? `${names[0]} and ${names[1]}` : `${names.length} topics`} into one called
        </span>
        <input value={v} onChange={(e) => setV(e.target.value)} className={field} aria-invalid={clash} />
        {clash && <span className="text-[12.5px] text-neg">Another topic already has that name.</span>}
      </label>
      <div className="flex gap-2">
        <button type="submit" className={primary} disabled={!v.trim() || clash}>
          <Check className="size-4" />
          Combine
        </button>
        <button type="button" className={quiet} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </motion.form>
  );
}

function AddForm({ taken, onAdd, onCancel }: { taken: (n: string) => boolean; onAdd: (name: string, description: string) => void; onCancel: () => void }) {
  const m = useMotion();
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const clash = name.trim() !== "" && taken(name);
  return (
    <motion.form
      {...m}
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim() && !clash) onAdd(name.trim(), desc.trim());
      }}
      className="flex max-w-2xl flex-col gap-2.5 rounded-2xl border border-foreground/[0.07] bg-card p-4"
    >
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Topic name" aria-label="Topic name" className={field} aria-invalid={clash} />
      {clash && <span className="text-[12.5px] text-neg">Another topic already has that name.</span>}
      <textarea
        rows={2}
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        placeholder="What counts as this topic, and what does not. Each conversation is asked about it by this."
        aria-label="Description"
        className={cn(field, "resize-y leading-relaxed")}
      />
      <div className="flex gap-2">
        <button type="submit" className={secondary} disabled={!name.trim() || clash}>
          Add to the changes waiting
        </button>
        <button type="button" className={quiet} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </motion.form>
  );
}

// ---------- the pending relabel ----------

function DraftTray({
  changes,
  problems,
  budgetLeft,
  onPropose,
  onStart,
  onDiscard,
  onError,
}: {
  changes: string[];
  problems: string[];
  budgetLeft: number;
  onPropose: () => Promise<Proposal>;
  onStart: (p: Proposal) => void;
  onDiscard: () => void;
  onError: (e: unknown) => void;
}) {
  const m = useMotion();
  const [proposal, setProposal] = useState<{ for: string; p: Proposal } | null>(null);
  const [busy, setBusy] = useState(false);
  const sig = changes.join("|");
  const current = proposal && proposal.for === sig ? proposal.p : null; // a change after pricing needs a new price

  const review = async () => {
    setBusy(true);
    try {
      setProposal({ for: sig, p: await onPropose() });
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div {...m} className="flex flex-col gap-3 rounded-2xl bg-background/[0.93] backdrop-blur-xl border border-foreground/[0.08] p-4 shadow-[0_14px_40px_-14px_rgb(0_0_0/0.3)]">
      <div className="flex flex-col gap-1">
        <h3 className="text-[15px] font-semibold text-foreground">
          {changes.length === 1 ? "One change waiting" : `${changes.length} changes waiting`}
        </h3>
        <ul className="text-[13.5px] leading-relaxed text-muted-foreground">
          {changes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        {problems.map((p) => (
          <p key={p} className="text-[13px] text-neg">
            {p}
          </p>
        ))}
      </div>
      {current ? (
        <div className="flex flex-col gap-2.5">
          {/* Only the new and redefined topics are asked again, and only they are priced; a removal is free (D46). */}
          {proposalWords(current).map((line) => (
            <p key={line} className="text-[14px] text-foreground">
              {line}
            </p>
          ))}
          {!current.affordable && (
            <p className="text-[13px] text-neg">Only {formatUsd(budgetLeft)} is left for sorting, so this cannot start.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={primary} disabled={!current.affordable} onClick={() => onStart(current)}>
              {current.asks.length ? "Start" : "Apply"}
            </button>
            <button type="button" className={quiet} onClick={() => setProposal(null)}>
              Not now
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={primary} disabled={problems.length > 0 || busy} onClick={review}>
            {busy ? "Working out the cost…" : "Review"}
          </button>
          <button type="button" className={quiet} onClick={onDiscard}>
            Discard changes
          </button>
        </div>
      )}
    </motion.div>
  );
}

function Progress({ taxonomy, onFinish }: { taxonomy: Tax; onFinish: (status: string) => void }) {
  const m = useMotion();
  const reduce = useReducedMotion();
  const [confirming, setConfirming] = useState(false);
  const job = taxonomy.tax!.job!;
  const frac = job.total ? Math.min(1, job.done / job.total) : 0;
  const s = taxonomy.startedAt;
  // eslint-disable-next-line react-hooks/purity -- a rough "time left" that refreshes with each step is all this needs
  const left = s && taxonomy.driving ? eta(job.done - s.done, job.total - s.done, Date.now() - s.at) : null;

  return (
    <motion.div {...m} className="flex flex-col gap-3 rounded-2xl border border-foreground/[0.07] bg-card p-4" role="status" aria-live="polite">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[15px] font-semibold text-foreground">{taxonomy.driving ? "Sorting conversations" : "Sorting paused"}</h3>
        <span className="text-[13px] text-muted-foreground">
          {fmtInt(job.done)} of {fmtInt(job.total)}, {formatUsd(job.costUsd)} so far{left ? `, ${left}` : ""}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-foreground/[0.07]">
        <motion.div
          className="h-full rounded-full bg-pulse"
          initial={false}
          animate={{ width: `${Math.max(frac * 100, 1.5)}%` }}
          transition={reduce ? { duration: 0 } : { type: "spring", bounce: 0, duration: 0.8 }}
        />
      </div>
      <p className="text-[13px] text-muted-foreground">
        {taxonomy.driving
          ? "Keep this page open while it runs. The grid updates when it finishes."
          : "Resume continues from where it stopped. If it is running in another window, this follows along on its own. Topics can be edited again once it finishes or is cancelled."}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {taxonomy.driving ? (
          <button type="button" className={secondary} onClick={taxonomy.pause}>
            Pause
          </button>
        ) : (
          <button type="button" className={secondary} onClick={() => taxonomy.drive(job.id).then(onFinish)}>
            Resume
          </button>
        )}
        {confirming ? (
          <>
            <span className="text-[13px] text-muted-foreground">Cancel and keep the current topics?</span>
            <button
              type="button"
              className={cn(quiet, "text-neg hover:text-neg")}
              onClick={() => {
                setConfirming(false);
                taxonomy.cancel(job.id).then(() => onFinish("cancelled"), () => onFinish("error"));
              }}
            >
              Yes, cancel
            </button>
            <button type="button" className={quiet} onClick={() => setConfirming(false)}>
              Keep going
            </button>
          </>
        ) : (
          <button type="button" className={quiet} onClick={() => setConfirming(true)}>
            Cancel
          </button>
        )}
      </div>
    </motion.div>
  );
}
