import "server-only";
import { query } from "@/lib/data/db";
import { mapPool } from "@/lib/data/pool";
import { getMessagesByRef } from "@/lib/data/read";
import { messagesFor } from "@/lib/data/search";
import type { Filters, MessageRef } from "@/lib/data/types";
import { sameSlice } from "./slices";
import { decide, noul } from "@/lib/llm/decide";
import { msgTag, refOfTag } from "@/lib/refs";
import { shownCitations } from "@/lib/claims";
import { SUPPORTED, type Verification } from "./verify";

// How many conversations back each claim, not just the two or three it cites. A scan reads hundreds of conversations
// and the answer cites a handful; the reader saw the handful and none of the breadth, so a sound claim read as thin
// (his review, 2026-09-25). After the check, every cited claim is put to the conversations this turn found relevant:
// Jev reads each conversation's messages with every claim in hand and says, per message, whether it says what the
// claim says. A conversation backs a claim through its best message. DECISIONS D22.
//
// Measured 2026-09-25: 20 conversations x 10 messages x 4 claims = 784 questions in 0.7 s, 47k input tokens
// (~$0.002). Jev answers every question about one state in a single request, so the cost is the conversations read,
// not the claims asked.

export const BACKS = SUPPORTED; // the verifier's bar
const POOL_MAX = 80; // the most relevant conversations; the rest of the relevant set is counted, not read
const PER_CONVERSATION = 12; // messages per conversation, highest-scored first
const CLAIMS_MAX = 8;
const MORE_MAX = 40; // the list behind "+N": enough to scroll, not the whole set
const IN_FLIGHT = 20;

export type MoreItem = MessageRef & { threadTitle: string; support: number };
export type CorroboratedClaim = { claim: string; tags: string[]; conversations: number; more: MoreItem[]; moreTotal: number };
export type CorroborationPart =
  | { status: "running" }
  // `reads`: how many reads fed the pool, so the footer can say that two reads' sets were merged (older chats lack it)
  | { status: "done"; pool: number; found: number; reads?: number; claims: CorroboratedClaim[]; failed: number }
  | { status: "failed"; error: string };

type StepLike = { content: ReadonlyArray<unknown> };
type ToolResult = { type: string; toolName?: string; input?: unknown; output?: unknown };

/** The conversations this turn found relevant, most relevant first: every scan's relevant set, then search hits, then
 *  anything read in full. `found` is how many different ones there were before the pool was cut to size; `reads` how
 *  many different slices the scans that found any read. A search and a thread opened in full are not reads, and one
 *  slice read twice is one read, as the steps say it: counted as reads, they put "the three reads" under one Read
 *  line and a search (review 2026-09-26). The slices compare as the steps compare them (slices.ts sameSlice). */
export function poolOf(steps: ReadonlyArray<StepLike>, max = POOL_MAX): { ids: string[]; found: number; reads: number } {
  const seen = new Set<string>();
  const slices: Filters[] = [];
  let beyond = 0; // relevant conversations a scan counted but did not list
  const add = (id: unknown) => typeof id === "string" && seen.add(id);
  for (const s of steps)
    for (const part of s.content) {
      const p = part as ToolResult;
      if (p.type !== "tool-result") continue;
      const o = p.output as Record<string, unknown> | null | undefined;
      if (!o) continue;
      if (p.toolName === "scan" && o.status === "ok") {
        const ids = (o.relevantIds as string[] | undefined) ?? (o.hits as { id: string }[] | undefined)?.map((h) => h.id) ?? [];
        const slice = (o.filters ?? (p.input as { filters?: Filters } | undefined)?.filters ?? {}) as Filters;
        if (ids.length && !slices.some((x) => sameSlice(x, slice))) slices.push(slice);
        ids.forEach(add);
        beyond = Math.max(beyond, Number(o.relevant ?? 0) - ids.length);
      } else if (p.toolName === "find") {
        ((o.hits as { id: string }[] | undefined) ?? []).forEach((h) => add(h.id));
      } else if (p.toolName === "read_conversation" && typeof o.id === "string") {
        add(o.id);
      }
    }
  const ids = [...seen];
  return { ids: ids.slice(0, max), found: ids.length + Math.max(beyond, 0), reads: slices.length };
}

/** A conversation's messages worth putting to a claim: the in-window, unremoved ones, the highest-scored first. */
export function messagesToAsk(messages: MessageRef[], max = PER_CONVERSATION): MessageRef[] {
  return messages
    .filter((m) => m.in_window && !m.removed && !m.is_bot && m.text.trim())
    .sort((a, b) => b.score - a.score || a.ts.localeCompare(b.ts))
    .slice(0, max);
}

export type Read = { conversationId: string; title: string; messages: MessageRef[]; answers: Record<string, number> | null };
export const questionKey = (claim: number, ref: number) => `c${claim}_msg${ref}`;

/** The reads, per claim: which conversations back it (through their best message), and which of those the answer
 *  does not already cite, best first. A conversation a cited message sits in is counted, never listed again. */
export function tally(
  claims: { claim: string; tags: string[] }[],
  reads: Read[],
  citedConversation: Map<string, string>,
): CorroboratedClaim[] {
  return claims.map((c, k) => {
    const cited = new Set(c.tags.map((t) => citedConversation.get(t)).filter((x): x is string => Boolean(x)));
    const backing: MoreItem[] = [];
    for (const r of reads) {
      if (!r.answers) continue;
      let best: MoreItem | null = null;
      for (const m of r.messages) {
        const p = r.answers[questionKey(k, m.ref)];
        if (p !== undefined && p >= BACKS && (!best || p > best.support || (p === best.support && m.score > best.score)))
          best = { ...m, threadTitle: r.title, support: p };
      }
      if (best) backing.push(best);
    }
    const conversations = new Set([...backing.map((b) => b.conversation_id), ...cited]).size;
    const more = backing.filter((b) => !cited.has(b.conversation_id ?? "")).sort((a, b) => b.support - a.support || b.score - a.score);
    return { claim: c.claim, tags: c.tags, conversations, more: more.slice(0, MORE_MAX), moreTotal: more.length };
  });
}

export async function corroborate(v: Verification, steps: ReadonlyArray<StepLike>): Promise<CorroborationPart> {
  // A claim's tags are the chips the reader sees (lib/claims.ts shownCitations), so "N say this: M more than the ones
  // cited" is N minus the conversations of those chips. Taken as every citation the check passed, a weak one pruned
  // from the text still counted as cited: 3 chips beside "4 are cited in the answer" (QA 2026-09-26).
  const claims = v.claims
    .filter((c) => c.citations.some((x) => x.status === "ok"))
    .slice(0, CLAIMS_MAX)
    .map((c) => ({ claim: c.claim, tags: shownCitations(c, SUPPORTED) }));
  const { ids, found, reads: fed } = poolOf(steps);
  if (!claims.length || !ids.length) return { status: "done", pool: ids.length, found, reads: fed, claims: [], failed: 0 };

  const citedRefs = [...new Set(claims.flatMap((c) => c.tags))].map(refOfTag).filter((r): r is number => r !== null);
  const [messages, titles, cited] = await Promise.all([
    messagesFor(ids),
    query<{ id: string; thread_title: string }>(`SELECT id, thread_title FROM conversations WHERE id = ANY($1)`, [ids]),
    getMessagesByRef(citedRefs),
  ]);
  const titleOf = new Map(titles.map((t) => [t.id, t.thread_title]));
  const citedConversation = new Map(cited.filter((m) => m.conversation_id).map((m) => [msgTag(m.ref), m.conversation_id!]));
  const claimState = Object.fromEntries(claims.map((c, k) => [`c${k}`, c.claim]));

  let failed = 0;
  const reads = await mapPool(ids, IN_FLIGHT, async (id): Promise<Read> => {
    const mine = messagesToAsk(messages.filter((m) => m.conversation_id === id));
    const read: Read = { conversationId: id, title: titleOf.get(id) ?? "", messages: mine, answers: null };
    if (!mine.length) return read;
    try {
      const res = await decide({
        // The author travels with the text: a claim about what one named person says is backed only by that
        // person's messages. Without it, "AdvancedSoldier2649 doubts the bans" counted everyone who doubts them.
        state: { claims: claimState, messages: Object.fromEntries(mine.map((m) => [msgTag(m.ref), { author: m.author, text: m.text }])) },
        questions: Object.fromEntries(
          claims.flatMap((_, k) =>
            mine.map((m) => [
              questionKey(k, m.ref),
              noul(
                `Does the message \`messages.${msgTag(m.ref)}\` say what \`claims.c${k}\` says - is it one instance of what ` +
                  "the claim describes? Sharing its topic is not enough; it must say the thing itself. If the claim is " +
                  "about what a named person says or does, only a message whose author is that person counts.",
              ),
            ]),
          ),
        ),
        timeoutMs: 15_000,
      });
      read.answers = Object.fromEntries(Object.entries(res.answers as Record<string, { noul: number }>).map(([key, a]) => [key, a.noul]));
    } catch {
      failed++;
    }
    return read;
  });
  return { status: "done", pool: ids.length, found, reads: fed, claims: tally(claims, reads, citedConversation), failed };
}
