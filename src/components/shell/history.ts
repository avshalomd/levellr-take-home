// The saved chats in the sidebar, grouped the way people look for a conversation they had: today, earlier this week,
// before that. Kept free of React so it is unit-tested (history.test.ts).

export type ChatSummary = { id: string; title: string; updated_at: string };
export type ChatGroup = { label: string; chats: ChatSummary[] };

const DAY = 86_400_000;

/** Newest first within each group; empty groups are left out. Days are the reader's local days. */
export function groupChats(chats: ChatSummary[], now: Date): ChatGroup[] {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const groups: ChatGroup[] = [
    { label: "Today", chats: [] },
    { label: "Yesterday", chats: [] },
    { label: "Previous 7 days", chats: [] },
    { label: "Earlier", chats: [] },
  ];
  const sorted = [...chats].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  for (const c of sorted) {
    const t = Date.parse(c.updated_at);
    const g = t >= midnight ? 0 : t >= midnight - DAY ? 1 : t >= midnight - 7 * DAY ? 2 : 3;
    groups[g].chats.push(c);
  }
  return groups.filter((g) => g.chats.length);
}

/** The chat id a path shows, or null: "/c/abc" -> "abc". */
export const chatIdOf = (pathname: string | null) => /^\/c\/([^/]+)\/?$/.exec(pathname ?? "")?.[1] ?? null;

/** A chat's title cut to `max` characters for the Undo toast, at a word boundary with an ellipsis: "…cheaters i…" read
 *  as a typo (QA 2026-09-26). A single word longer than half the room is still cut inside it, rather than leaving only
 *  a stub. The full title stays in the list and in the toast's spoken name. */
export function clipTitle(title: string, max = 40): string {
  if (title.length <= max) return title;
  const cut = title.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  const kept = space >= max / 2 ? cut.slice(0, space) : cut;
  return `${kept.replace(/[\s,;:.–—-]+$/, "")}…`;
}
