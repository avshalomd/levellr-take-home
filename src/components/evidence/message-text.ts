import { readableText } from "./source-words";

// A message's text, prepared for the two ways the panel shows it: the full card renders its markdown as formatting
// (MessageText.tsx), and the one-line rows and previews show plain words (plainMessage). Reddit and Discord store the
// markdown source, so a post arrives with "# Schedule", "*※*" and "[https://…](https://…)" in it, and a picture the
// collector did not keep as the word "[media]". Pure, so it is unit-tested (message-text.test.ts).

/**
 * The markdown the card renders. "[media]" becomes an image, which the card draws as a small "Image" marker where the
 * picture was. Reddit escapes "&" once more than it should ("&amp;#x200B;", its blank-line filler), so that one layer
 * is undone and the markdown reader decodes what is left.
 */
export function cardMarkdown(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/\[media\]/gi, "![image]()");
}

/** Only a web address opens from a card: a javascript:, data: or relative link in someone's post becomes plain text. */
export function safeHref(url: string): string {
  const u = url.trim();
  return /^https?:\/\/\S+$/i.test(u) ? u : "";
}

// Words that read as an address: with or without "https://" or "www.", a dotted host, maybe a path.
const ADDRESS = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i;

/**
 * A link whose words are a web address, shown as the address it really opens, shortened to the site and the start of
 * the path ("reddit.com/r/VeilOfAgesGames/comments/…"), so a long address never runs across the card. The words are
 * never trusted: "[paypal.com/login](https://evil.example)" reads "evil.example". Null for ordinary words.
 */
export function linkLabel(text: string, href: string, max = 40): string | null {
  if (!ADDRESS.test(text.trim())) return null;
  const short = (href || text)
    .trim()
    .replace(/^https?:\/\/(www\.)?/i, "")
    .replace(/\/$/, "");
  return short.length > max ? `${short.slice(0, max - 1)}…` : short;
}

/**
 * A message as plain words, for a one-line row or a preview: the formatting marks go, a link keeps its words, and a
 * picture reads "(image)". Line breaks stay, so a row can still take the first line.
 */
export function plainMessage(s: string): string {
  return readableText(s)
    .replace(/&#x200B;/gi, "")
    .replace(/!\[[^\]]*\]\([^)]*\)|\[media\]/gi, "(image)")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^[ \t]*(?:#{1,6}|>|[-*+]|\d+\.)[ \t]+/gm, "")
    .replace(/(^|[^\w*])(\*{1,3}|_{1,3})(?=\S)(.*?\S)\2(?![\w*])/g, "$1$3")
    .replace(/`([^`]+)`/g, "$1");
}
