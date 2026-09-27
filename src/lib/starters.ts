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

/** Label names are title case ("Performance & Access"); in a sentence they read lower case, acronyms kept (API, UI). */
const inSentence = (name: string) => name.split(" ").map((w) => (/^[A-Z0-9]{2,}$/.test(w) ? w : w.toLowerCase())).join(" ");

/** The question a topic chip on the empty chat asks. */
export const topicQuestion = (name: string) => `What are people saying about ${inSentence(name)}?`;
