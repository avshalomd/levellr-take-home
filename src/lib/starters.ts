// The questions offered on an empty chat. They are written from the dataset itself - its biggest topic labels - so
// they fit whatever community is loaded, and every one is a question the agent can answer.
type Topic = { key: string; name: string; n: number };

/** Label names are title case ("Performance & Access"); in a sentence they read lower case, acronyms kept (API, UI). */
export const inSentence = (name: string) => name.split(" ").map((w) => (/^[A-Z0-9]{2,}$/.test(w) ? w : w.toLowerCase())).join(" ");

/** The question a topic chip asks. */
export const topicQuestion = (name: string) => `What are people saying about ${inSentence(name)}?`;

export function starterQuestions(topics: Topic[]): string[] {
  const top = topics.filter((t) => t.key !== "other" && t.key !== "unlabelled").sort((a, b) => b.n - a.n);
  const qs = [
    top[0] && `What are people saying about ${inSentence(top[0].name)} lately?`,
    "What are people asking for most?",
    "Who are the most active voices in the community?",
    top[1] && `How has sentiment about ${inSentence(top[1].name)} changed week by week?`,
    "Which problems are reported most often?",
    top.length > 2 ? "Which topic grew the most in the last month?" : "What are people most unhappy about?",
  ];
  return qs.filter((q): q is string => Boolean(q)).slice(0, 6);
}
