// How a message reads on the platform it came from, in words the panel can show: its engagement ("▲ 1.2k" net votes on
// Reddit, reactions on Discord, a plain score anywhere else) and where it was posted (r/<community>, #channel). Nothing here names a community: the platform and community come from the data (dataset_meta.source),
// the channel from the message. Pure, so it is unit-tested (source-words.test.ts).

export type Source = { platform?: string; community?: string };
export type EngagementKind = "votes" | "reactions" | "score";

const platformOf = (s?: Source) => (s?.platform ?? "").trim().toLowerCase();

/** 999 -> "999", 1234 -> "1.2k", 12500 -> "13k", 1_250_000 -> "1.3M"; negatives keep their sign ("−4"). */
export function compact(n: number): string {
  const sign = n < 0 ? "−" : "";
  const a = Math.abs(Math.round(n));
  if (a < 1000) return `${sign}${a}`;
  const [v, unit] = a < 1_000_000 ? [a / 1000, "k"] : [a / 1_000_000, "M"];
  return `${sign}${v < 10 ? (Math.round(v * 10) / 10).toString() : Math.round(v).toString()}${unit}`;
}

/**
 * The message's engagement as the platform counts it. The data has one number per message: net votes on Reddit, the
 * sum of all reactions on Discord (ingest/normalize.py). An unknown platform gets the neutral word "score".
 */
export function engagement(source: Source | undefined, score: number): { kind: EngagementKind; short: string; long: string; unit: string } {
  const p = platformOf(source);
  const full = Math.round(score).toLocaleString("en-GB");
  const one = Math.abs(score) === 1;
  // "Net votes", as Explore and the answers say it: "62 votes" here beside "+75 net votes" there read as two measures
  // (QA 2026-09-26).
  const net = one ? "net vote" : "net votes";
  if (p === "reddit") return { kind: "votes", short: compact(score), long: `${full} ${net}: upvotes minus downvotes`, unit: net };
  if (p === "discord") return { kind: "reactions", short: compact(score), long: `${full} ${one ? "reaction" : "reactions"}`, unit: one ? "reaction" : "reactions" };
  return { kind: "score", short: compact(score), long: `Score ${full}`, unit: "score" };
}

/**
 * Where a conversation sits: the community, and the channel inside it. On Reddit the channel is the post's flair, a
 * tag inside the subreddit; on Discord it is the #channel itself. Anything else shows what the data names.
 */
export function placeWords(source: Source | undefined, channel: string | undefined): { where: string; tag: string | null } {
  const p = platformOf(source);
  const community = source?.community?.trim() || "";
  const ch = channel?.trim() || "";
  if (p === "discord") return { where: ch ? `#${ch.replace(/^#/, "")}` : community, tag: ch && community ? community : null };
  if (community) return { where: community, tag: ch || null };
  return { where: ch, tag: null };
}

/** How loud a message was next to the rest of its conversation, 0..1 on a log scale: a 2,000-vote reply and a 20-vote
 * one differ in kind, not by a factor of a hundred in how they read. Drives dot size in the picture. */
export function loudness(score: number, max: number): number {
  if (score <= 0 || max <= 0) return 0;
  return Math.min(1, Math.log1p(score) / Math.log1p(max));
}

/**
 * A message's text as a person reads it. Reddit and Discord store markdown source, so "*drives through a barrier*"
 * arrives as "\*drives through a barrier\*" and a leading dash as "\-"; Reddit also keeps &amp;, &lt; and &gt;. The
 * escapes go and the entities are decoded; the markdown itself is left as typed.
 */
export function readableText(s: string): string {
  return s
    .replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** The thread picture's caption when nothing is hovered. Device-neutral: "tap one" read wrong on a desktop with a mouse
 *  (QA 2026-09-26), and a dot is opened by a click, a tap or the keyboard alike. */
export function mapHint(shape: "tree" | "timeline", kind: EngagementKind): string {
  if (shape !== "tree") return "Messages in the order they were sent; an arc joins a reply to what it answers. Select one to open it.";
  const word = { votes: "net votes", reactions: "reactions", score: "engagement" }[kind];
  return `Each dot is a message, each line a reply. Bigger dots drew more ${word}; select one to open it.`;
}

/**
 * The line under a claim in the "+N more" list: "5 conversations say this. 2 are cited in the answer; the other 3 are
 * below." Every count agrees with its verb (QA 2026-09-26: "the other 1 are below"). `shown` is how many rows the list
 * holds, `more` how many conversations it stands for.
 */
export function moreWords(conversations: number, cited: number, shown: number, more: number): string {
  const n = (x: number) => x.toLocaleString("en-GB");
  const be = (x: number) => (x === 1 ? "is" : "are");
  const head = `${n(conversations)} ${conversations === 1 ? "conversation says" : "conversations say"} this.`;
  if (cited === 0) {
    // None cited: there is no "other" to speak of.
    const rest = more > shown ? (shown === 1 ? "The clearest is below." : `The ${n(shown)} clearest are below.`) : more === 1 ? "It is below." : `All ${n(more)} are below.`;
    return `${head} ${rest}`;
  }
  const rest =
    more > shown
      ? shown === 1
        ? `the clearest of the other ${n(more)} is below.`
        : `the ${n(shown)} clearest of the other ${n(more)} are below.`
      : more === 1
        ? "the other one is below."
        : `the other ${n(more)} are below.`;
  return `${head} ${n(cited)} ${be(cited)} cited in the answer; ${rest}`;
}

/**
 * The topics of the conversation a message belongs to, as names, primary first. A conversation keeps every topic it
 * discusses (D46), and `topics` arrives already ordered by how sure the labeller was, so the first is the primary one.
 * "other" and "unlabelled" are not topics a customer tracks: they are left out, and a conversation with only those
 * shows no topic line at all. A key with no name (a topic removed since) reads as its words.
 */
export function topicNamesOf(topics: string[] | undefined, names: Map<string, string>): string[] {
  const out: string[] = [];
  for (const k of topics ?? []) {
    if (k === "other" || k === "unlabelled") continue;
    const name = names.get(k) ?? k.replace(/[-_]/g, " ");
    if (!out.includes(name)) out.push(name);
  }
  return out;
}
