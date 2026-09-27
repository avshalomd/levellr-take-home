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
