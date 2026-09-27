"use client";

import { Children, cloneElement, createContext, Fragment, isValidElement, useContext, type ReactElement, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { BarChart3 } from "lucide-react";
import { CITE_RE, tagsIn } from "@/lib/refs";
import { cn } from "@/lib/utils";
import { sourceWords } from "./activity-words";
import { CitationChip, HIT_AREA } from "./CitationChip";
import { endsWithShownCitation, groupClaims, lastWord, morePillWords, offeredQuestion, splitClosing } from "./claims";
import type { CorroboratedClaim } from "@/lib/agent/corroborate";
import { beforeDroppedCitation, corroborationFor, PUNCTUATION_NEXT, splitToolTags as toolTagPieces, supportLevel, type Evidence } from "./evidence";

// The answer as markdown, read as claims. Every sentence or bullet that cites something is a claim: hovering it lights
// its citations here and its messages in the thread tree; clicking it opens the tree there. Every [msg1234] becomes a
// numbered chip. The claim split is claims.ts; this file only renders it.

type NodeProps = { children?: ReactNode; node?: { tagName?: string } };

// A message or conversation handle that did not become a chip: "[conv12]", a bare "msg40", a "[msg…]" cut short, or
// one left unclosed at the end. The answer's text is tidied before it gets here (lib/refs.ts normalizeCitations,
// evidence.ts); this is the last line of defence, so no raw handle ever reaches the reader (QA 2026-09-26). A full
// "[msg12]" group is not touched here: it is a chip, or dropped as an unshown citation, by splitCitations.
// A bracketed tool name or other snake_case token ("[dataset_overview]") is not a citation either (production QA
// 2026-09-26: "…the 43.1 release on 2026-09-09 [dataset_overview]."); the step tags ([scan]) are one word and stay.
const STRAY_REF = /\s*(?:\[\s*(?:msg|conv)(?:\d+|…|\.{3})[^[\]\n]{0,40}?(?:\]|$)|\b(?:msg|conv)\d+\b|\[\s*[a-z][a-z0-9]*(?:_[a-z0-9]+)+\s*\])/gi;
// Only text that holds a handle-shaped token is touched (review 2026-09-26: /msg|conv/ matched every answer that said
// "conversation", and the space-before-punctuation tidy below then ran on text that had no handle in it).
const HAS_STRAY = /\b(?:msg|conv)\d|\[\s*(?:msg|conv)|\[\s*[a-z][a-z0-9]*_[a-z0-9]/i;

/** Text with any stray handle taken out, and the space it leaves before punctuation. */
export function stripStrayRefs(s: string): string {
  if (!HAS_STRAY.test(s)) return s;
  return s.replace(STRAY_REF, "").replace(/[ \t]+([.,;:!?])/g, "$1");
}

// The plain text of rendered markdown children, for reading the citations inside bold text or a link.
const textOf = (n: ReactNode): string =>
  typeof n === "string" || typeof n === "number"
    ? String(n)
    : Array.isArray(n)
      ? n.map(textOf).join("")
      : isValidElement<NodeProps>(n)
        ? textOf(n.props.children)
        : "";

// A list item in a loose list holds paragraphs, which split themselves; only an inline-only item is split here.
const BLOCK = new Set(["p", "ul", "ol", "blockquote", "pre", "table"]);
const hasBlock = (children: ReactNode) =>
  Children.toArray(children).some(
    (c) => isValidElement<NodeProps>(c) && BLOCK.has(typeof c.type === "string" ? c.type : (c.props.node?.tagName ?? "")),
  );

// The markdown's pieces are made once, here, and read this answer's claim and chip renderers from context. Made inline
// in Answer they were new functions on every render, and React remounts everything under a component whose function
// changed: opening the panel re-rendered the answer, replaced the chip that had focus, and focus fell to the page, so
// neither moving it into the panel nor bringing it back to the chip could work (QA 2026-09-25).
// `ask` is set only on an answer that cites nothing: its bulleted questions are offers to ask (claims.ts offeredQuestion).
type Renderers = { claims: (children: ReactNode) => ReactNode; withChips: (children: ReactNode) => ReactNode; ask?: (q: string) => void };
const RenderersContext = createContext<Renderers>({ claims: (c) => c, withChips: (c) => c });

function Para({ children }: NodeProps) {
  return <p className="my-3 first:mt-0 last:mb-0">{useContext(RenderersContext).claims(children)}</p>;
}
function Item({ children }: NodeProps) {
  const { claims, ask } = useContext(RenderersContext);
  const offer = ask && !hasBlock(children) ? offeredQuestion(textOf(children)) : null;
  if (offer)
    return (
      <li className="my-1.5 pl-1 marker:text-muted-foreground/70">
        <button
          type="button"
          data-ask
          onClick={() => ask?.(offer)}
          className="text-left text-pulse underline decoration-pulse/30 underline-offset-2 transition-colors hover:decoration-pulse"
        >
          {offer}
        </button>
      </li>
    );
  return <li className="my-1.5 pl-1 marker:text-muted-foreground/70">{hasBlock(children) ? children : claims(children)}</li>;
}
function Title({ children }: NodeProps) {
  return <h3 className="mt-6 mb-2 text-[17px] font-semibold text-foreground">{useContext(RenderersContext).withChips(children)}</h3>;
}
function Subtitle({ children }: NodeProps) {
  return <h4 className="mt-5 mb-1.5 text-[16px] font-semibold text-foreground">{useContext(RenderersContext).withChips(children)}</h4>;
}
function HeadCell({ children }: NodeProps) {
  return <th className="border-b border-foreground/10 px-2 py-1.5 text-left font-medium">{useContext(RenderersContext).withChips(children)}</th>;
}
function Cell({ children }: NodeProps) {
  return <td className="border-b border-foreground/[0.06] px-2 py-1.5">{useContext(RenderersContext).withChips(children)}</td>;
}

const components: Components = {
  p: Para,
  li: Item,
  ul: ({ children }) => <ul className="my-3 list-disc space-y-0.5 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-3 list-decimal space-y-0.5 pl-5">{children}</ol>,
  h1: Title,
  h2: Title,
  h3: Subtitle,
  blockquote: ({ children }) => <blockquote className="my-3 border-l-2 border-pulse/40 pl-4 text-foreground/75">{children}</blockquote>,
  // A code span is shown as written: it is code, and "const msg1 = …" is not a handle (review 2026-09-26).
  code: ({ children }) => <code className="rounded bg-foreground/[0.05] px-1 font-mono text-[14px]">{children}</code>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-pulse underline decoration-pulse/30 underline-offset-2 hover:decoration-pulse">
      {typeof children === "string" ? stripStrayRefs(children) : children}
    </a>
  ),
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto">
      <table className="w-full text-[14px]">{children}</table>
    </div>
  ),
  th: HeadCell,
  td: Cell,
};

export function Answer({
  evidence,
  activeId,
  onOpen,
  onHoverClaim,
  onShowStep,
  onOpenMore,
  onAsk,
}: {
  evidence: Evidence;
  activeId?: string | null;
  onOpen: (citeId: string, claimTags: string[]) => void;
  onHoverClaim: (tags: string[] | null) => void;
  onShowStep: (tag: string) => void;
  onOpenMore: (c: CorroboratedClaim) => void;
  /** Asks a question in this chat: a question the answer offers (an answer that cites nothing) is a tap away. */
  onAsk?: (question: string) => void;
}) {
  const withChips = (children: ReactNode): ReactNode =>
    Children.map(children, (child) => {
      if (typeof child === "string") return splitCitations(child).flatMap((part) => (typeof part === "string" ? splitToolTags(part) : [part]));
      // A code span is shown as written (review 2026-09-26): no chips and no stray-handle strip inside it.
      if (isValidElement<NodeProps>(child) && child.props.node?.tagName === "code") return child;
      if (isValidElement<NodeProps>(child) && child.props.children) return cloneElement(child, undefined, withChips(child.props.children));
      return child;
    });

  // Each citation group becomes chips, bound to the word before them (lastWord) so they never wrap onto a line alone.
  const splitCitations = (s: string): ReactNode[] => {
    const out: ReactNode[] = [];
    let last = 0;
    for (const m of s.matchAll(CITE_RE)) {
      const shown = tagsIn(m[1]).filter((id) => evidence.cited.includes(id)); // a hidden citation (evidence.ts): never shown
      // The last chip hugs punctuation after it, as a tool glyph does (evidence.ts splitToolTags).
      const hug = PUNCTUATION_NEXT.test(s.slice(m.index + m[0].length));
      const chips = shown.map((id, i) => (
        <CitationChip
          key={`${m.index}-${id}`}
          n={evidence.cited.indexOf(id) + 1}
          id={id}
          info={evidence.refs.get(id)}
          level={supportLevel(evidence.support.get(id))}
          active={activeId === id}
          hug={hug && i === shown.length - 1}
          onOpen={(citeId) => onOpen(citeId, [citeId])}
        />
      ));
      const before = stripStrayRefs(s.slice(last, m.index));
      if (chips.length) {
        const [head, word] = lastWord(before);
        out.push(
          head,
          <span key={`w-${m.index}`} className="whitespace-nowrap">
            {splitToolTags(word)}
            {chips}
          </span>,
        );
      } else out.push(beforeDroppedCitation(before, stripStrayRefs(s.slice(m.index + m[0].length))));
      last = m.index + m[0].length;
    }
    out.push(stripStrayRefs(s.slice(last)));
    return out;
  };

  // "[scan]" after a number marks where it was counted: a small chart glyph that opens the steps at that one.
  // Each glyph is bound to the word before it and the punctuation after it, as a citation chip is: a glyph at a
  // sentence's end otherwise let the full stop wrap onto the next line alone (QA 2026-09-27).
  const splitToolTags = (s: string): ReactNode[] => {
    const pieces = toolTagPieces(s);
    const out: ReactNode[] = [];
    let carry = ""; // punctuation already bound to the glyph before it
    pieces.forEach(({ text, tag, hug }, i) => {
      if (text !== undefined) {
        const rest = text.slice(carry.length);
        carry = "";
        if (pieces[i + 1]?.tag !== undefined) {
          const [head, word] = lastWord(rest);
          out.push(head);
          pieces[i] = { text: word }; // the word rides with the glyph after it
        } else out.push(rest);
        return;
      }
      const before = pieces[i - 1]?.text !== undefined ? (pieces[i - 1].text as string) : "";
      const after = pieces[i + 1]?.text ?? "";
      const punct = hug ? (/^[.,;:!?)]+/.exec(after)?.[0] ?? "") : "";
      carry = punct;
      out.push(
        <span key={`tag-${i}`} className="whitespace-nowrap">
          {before}
          <button
            type="button"
            title={sourceWords(tag!)}
            aria-label={sourceWords(tag!)}
            onClick={(e) => {
              e.stopPropagation();
              onShowStep(tag!);
            }}
            className={cn(
              "inline-grid size-[18px] -translate-y-[1px] place-items-center rounded-full align-middle text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground",
              HIT_AREA,
              // The glyph sits 3px inside its circle; before punctuation that room goes too, so ", and" hugs it.
              hug ? "ml-0.5 -mr-[3px]" : "mx-0.5",
            )}
          >
            <BarChart3 className="size-3" />
          </button>
          {punct}
        </span>,
      );
    });
    return out;
  };

  // A block's text as claims. Only citations still shown count toward a claim. A claim's "+N more" goes before its
  // full stop, bound to it so the two never wrap apart (claims.ts splitClosing).
  const claims = (children: ReactNode): ReactNode =>
    groupClaims(Children.toArray(children) as (string | ReactElement)[], textOf).map((c, i) => {
      const tags = c.tags.filter((t) => evidence.cited.includes(t));
      if (!tags.length) return <Fragment key={i}>{withChips(c.pieces)}</Fragment>;
      // The chips shown and the sentence's own words: two sentences citing the same message are two claims (review
      // 2026-09-26).
      const said = c.pieces.map((p) => (typeof p === "string" ? p : textOf(p))).join("");
      // The "+N more" rides only right after a numbered chip, never on its own (claims.ts endsWithShownCitation).
      const backing = endsWithShownCitation(said, evidence.cited) ? corroborationFor(evidence, tags, said) : undefined;
      const [body, mark, space] = backing && backing.moreTotal > 0 ? splitClosing(c.pieces) : [c.pieces, "", ""];
      return (
        <span
          key={i}
          className="claim"
          onPointerEnter={(e) => e.pointerType === "mouse" && onHoverClaim(tags)}
          onPointerLeave={(e) => e.pointerType === "mouse" && onHoverClaim(null)}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("a,button")) return;
            onOpen(tags[0], tags);
          }}
        >
          {withChips(body)}
          {backing && backing.moreTotal > 0 && (
            <span className="whitespace-nowrap">
              <MorePill c={backing} hug={Boolean(mark)} onOpen={() => onOpenMore(backing)} />
              {mark}
            </span>
          )}
          {space}
        </span>
      );
    });

  return (
    <div data-answer className="answer">
      <RenderersContext value={{ claims, withChips, ask: evidence.cited.length ? undefined : onAsk }}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {evidence.text}
        </ReactMarkdown>
      </RenderersContext>
    </div>
  );
}

// "+23 more": how many other conversations this turn found say the same thing, beyond the ones cited (D22). It opens
// them as a list in the evidence panel. Quiet on purpose: it adds weight to a claim, it is not a second citation.
function MorePill({ c, hug, onOpen }: { c: CorroboratedClaim; hug: boolean; onOpen: () => void }) {
  const words = morePillWords(c);
  return (
    <button
      type="button"
      data-more
      title={words}
      aria-label={`${words}. Show them.`}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      className={cn(
        "pressable inline-flex h-[18px] -translate-y-[1px] items-center rounded-full border border-pulse/25 px-1.5 align-middle text-[11px] leading-none font-semibold whitespace-nowrap text-pulse transition-colors hover:bg-pulse-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pulse",
        HIT_AREA,
        hug ? "ml-1" : "mx-1",
      )}
    >
      +{c.moreTotal.toLocaleString("en-GB")} more
    </button>
  );
}
