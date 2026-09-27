"use client";

import type { ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Image as ImageIcon } from "lucide-react";
import { cardMarkdown, linkLabel, safeHref } from "./message-text";

// A message's text with its formatting, as the platform showed it: headings, emphasis, lists, quotes and links - sized
// for a card, not a document, so a post's "# Schedule" reads as a bold line rather than a banner. Pictures are not
// loaded (the collector kept none, and they would come from someone else's server): each is a small "Image" marker
// where it sat. A link opens in a new tab and only when it is a web address (message-text.ts safeHref); raw HTML in a
// message is never rendered as HTML. The same markdown reader draws the answer (chat/Answer.tsx).

type Props = { children?: ReactNode };

const Heading = ({ children }: Props) => <p className="mt-3 mb-1 font-semibold text-foreground first:mt-0">{children}</p>;

const components: Components = {
  h1: Heading,
  h2: Heading,
  h3: Heading,
  h4: Heading,
  h5: Heading,
  h6: Heading,
  // Soft line breaks stay: a Discord message breaks lines with a single Enter.
  p: ({ children }) => <p className="my-2 whitespace-pre-wrap first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
  li: ({ children }) => <li className="marker:text-muted-foreground/70">{children}</li>,
  blockquote: ({ children }) => <blockquote className="my-2 border-l-2 border-foreground/15 pl-3 text-muted-foreground">{children}</blockquote>,
  code: ({ children }) => <code className="rounded bg-foreground/[0.05] px-1 font-mono text-[13px]">{children}</code>,
  // A box that scrolls sideways takes the keyboard too, so its hidden part can be reached (and Tab counts it).
  pre: ({ children }) => <pre tabIndex={0} className="my-2 overflow-x-auto rounded-lg bg-foreground/[0.04] p-2.5 text-[13px]">{children}</pre>,
  hr: () => <hr className="my-3 border-foreground/10" />,
  table: ({ children }) => (
    <div tabIndex={0} className="my-2 overflow-x-auto">
      <table className="text-[13px]">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-b border-foreground/10 px-2 py-1 text-left font-medium">{children}</th>,
  td: ({ children }) => <td className="border-b border-foreground/[0.06] px-2 py-1">{children}</td>,
  a: ({ href, children }) =>
    href ? (
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-pulse underline decoration-pulse/30 underline-offset-2 hover:decoration-pulse">
        {typeof children === "string" ? (linkLabel(children, href) ?? children) : children}
      </a>
    ) : (
      <>{children}</>
    ),
  img: () => (
    <span
      title="A picture in the original message, not shown here"
      className="inline-flex items-center gap-1 rounded-md bg-foreground/[0.05] px-1.5 py-px align-baseline text-[12px] text-muted-foreground"
    >
      <ImageIcon className="size-3" aria-hidden />
      Image
    </span>
  ),
};

export function MessageText({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} urlTransform={safeHref}>
      {cardMarkdown(text)}
    </ReactMarkdown>
  );
}
