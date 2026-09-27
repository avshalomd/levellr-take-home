// The questions offered on an empty chat, and after a question the conversations cannot answer (off-topic.ts): the
// brief's own three examples, which are the questions the community manager came to ask. Every one is answerable from
// the conversations and the labels (docs/DESIGN.md).
export const BRIEF_QUESTIONS = [
  "What have players been frustrated about in the last few days?",
  "What are people most excited about right now?",
  "What should we post about this week?",
] as const;

export function starterQuestions(): string[] {
  return [...BRIEF_QUESTIONS];
}

// Topic names are sentence case here ("Ebontide and new quests", "Tides Remastered", "Domains"), and most of them lead
// with a name: a capital after the first word is a proper noun, and so is a first word that is not a plain English
// one. Lower-casing every word asked "What are people saying about ebontide and new quests?", which is also the chat's
// title (QA Q5, 2026-09-27). So the name keeps its casing, and only a leading common word ("Pricing", "Other",
// "Lore") drops its capital; in a Title Case name ("Performance & Bugs") every common word does. A word missing from
// the list keeps its capital, the safer way to be wrong.
const COMMON_LEAD = new Set(
  (
    "other pricing price prices series lore story classic multiplayer performance bugs bug general community events " +
    "event feedback gameplay game games updates update questions help memes news patch patches balance matchmaking " +
    "servers server cheating esports merch trading art fan fans music technical account accounts support player " +
    "players new upcoming future release releases launch content monetisation monetization reviews review hardware " +
    "platform platforms crossplay social moderation spoilers off-topic chatter combat parkour stealth quests " +
    "editions access progression"
  ).split(" "),
);

const CONNECTORS = new Set(["and", "or", "of", "the", "&", "a", "an", "in", "on", "for", "to", "with", "vs"]);
const bare = (w: string) => w.toLowerCase().replace(/[,:;]$/, "");

/** A topic's name inside a sentence: its own casing, with a leading common word in lower case (in a Title Case name,
 *  every common word). */
export const inSentence = (name: string) => {
  const words = name.trim().split(/\s+/);
  const content = words.filter((w) => !CONNECTORS.has(w.toLowerCase()) && /^[A-Za-z]/.test(w));
  const titleCase = content.length >= 2 && content.every((w) => /^[A-Z]/.test(w));
  return words
    .map((w, i) => ((i === 0 || titleCase) && COMMON_LEAD.has(bare(w)) && !/^[A-Z0-9]{2,}/.test(w) ? w.toLowerCase() : w))
    .join(" ");
};

/** The question a topic chip on the empty chat asks. */
export const topicQuestion = (name: string) => `What are people saying about ${inSentence(name)}?`;
