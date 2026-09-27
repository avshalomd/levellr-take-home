// How long a question may be. Without a cap, a pasted 100k-character question would go to Gemini on the brief's
// capped key from the public deploy (QA Q6, 2026-09-27). 2,000 characters is a long paragraph: room for a question
// with a quoted message in it, and no room for a pasted document. The textarea stops at it and the route refuses past it.
export const QUESTION_MAX = 2_000;

type PartLike = { type: string; text?: unknown };

/** The characters of text in a message's parts. */
export function questionLength(message: { parts?: ReadonlyArray<PartLike> } | undefined): number {
  return (message?.parts ?? []).reduce((n, p) => n + (p.type === "text" && typeof p.text === "string" ? p.text.length : 0), 0);
}

/** The line a question past the cap gets back. */
export const tooLongWords = (length: number) =>
  `That question is ${length.toLocaleString("en-GB")} characters long. Keep it under ${QUESTION_MAX.toLocaleString("en-GB")} and ask again.`;
