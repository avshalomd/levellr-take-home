import { starterQuestions } from "@/lib/starters";

// The reply to a question the conversations cannot answer (the weather, live server status, news from elsewhere). It is
// written here, in code, and the model only chooses to use it (the out_of_scope tool): asked in the instructions to
// "say what you can answer about and offer 2-3 questions", one model wrote exactly that for a pizza question and only
// "I can't access live weather data." for the weather in Oslo (QA 2026-09-26). One reply, one form, every time: what
// the conversations are (the community and its dates), then three questions a tap away (components/chat/Answer.tsx
// asks a bulleted question when the answer cites nothing). The questions are Home's own (lib/starters.ts), so they are
// written from the loaded data and every one can be answered.

type Topic = { key: string; name: string; n: number };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "18 June 2026"; the year only on the second date of a range in the same year: "18 June to 24 September 2026". */
export function spanInWords(from: string, to: string): string {
  const d = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  const [a, b] = [d(from), d(to)];
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return "";
  const day = (x: Date) => `${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]}`;
  const first = a.getUTCFullYear() === b.getUTCFullYear() ? day(a) : `${day(a)} ${a.getUTCFullYear()}`;
  return `from ${first} to ${day(b)} ${b.getUTCFullYear()}`;
}

// The reply names no subject (QA 2026-09-26, production): "The conversations can't tell you about the weather in Oslo"
// repeated the model's own words for the question back to the reader, and read as the app misunderstanding it. It says
// plainly that it cannot answer and what it does know, built from the loaded dataset's name and dates, never hard-coded.
export function offTopicReply(p: { community: string; from: string; to: string }, topics: Topic[] = []): string {
  const span = spanInWords(p.from, p.to);
  const questions = starterQuestions(topics).slice(0, 3);
  return (
    `I can't answer that. I only know what ${p.community} talked about${span ? ` ${span}` : ""}. You could ask:\n\n` +
    questions.map((q) => `- ${q}`).join("\n")
  );
}

// What the model reads back after out_of_scope: the reply is the app's, so the model adds nothing (the loop stops
// there anyway, lib/agent/agent.ts).
export const OFF_TOPIC_MODEL_WORDS = "The app has written the reply to the reader. Write nothing more.";

export type OffTopic = { status: "off-topic"; text: string };
export const isOffTopic = (output: unknown): output is OffTopic =>
  typeof output === "object" && output !== null && (output as { status?: unknown }).status === "off-topic";
