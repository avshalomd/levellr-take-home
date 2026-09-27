// The community's name as the manifest gave it ("Veil of Ages Discord (Levellr sample)") names the export, not the
// community: the parenthesis is where the file came from. The reader sees the community (QA Q7, 2026-09-27): as a
// badge "Veil of Ages Discord", in a sentence "the Veil of Ages Discord". The data is not reloaded; the name is
// shaped where it is shown.

/** The name without a trailing note in brackets: "Veil of Ages Discord (Levellr sample)" -> "Veil of Ages Discord". */
export function communityTitle(raw: string | undefined | null): string {
  return (raw ?? "").replace(/\s*\([^()]*\)\s*$/, "").trim();
}

/** The name as it reads inside a sentence: "the Veil of Ages Discord". A subreddit ("r/x") and a name that already
 *  starts with "the" take no article. */
export function communityInProse(raw: string | undefined | null, fallback = "the community"): string {
  const name = communityTitle(raw);
  if (!name) return fallback;
  if (/^(the|a|an)\s/i.test(name)) return name.replace(/^The\s/, "the ");
  if (/^r\//i.test(name)) return name;
  return `the ${name}`;
}
