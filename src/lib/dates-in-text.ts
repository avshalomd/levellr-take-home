// Dates and release numbers written in prose: "9 September", "Sept 9th", "2026-09-09", "September 2026", "patch 42.3".
// Their digits count nothing, so the two places that ask whether a sentence states a count, or whether a citation's
// words say anything besides when, take them out first (review 2026-09-26: "after the 9 September patch [scan]" kept
// its "where this number comes from" tag, and "[msg12, Sept]" had to lose its month and keep everything else).
// Shared by the server and the browser; pure, tested in dates-in-text.test.ts.

const MONTH = String.raw`(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?`;
const WEEKDAY = String.raw`(?:mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?\.?`;
const DAY = String.raw`\d{1,2}(?:st|nd|rd|th)?`;
const YEAR = String.raw`\d{4}`;
// A release: a dotted number named as one ("patch 42.3", "the 42.3 update", "after 42.3") or with three parts (1.2.3).
// A plain decimal is a count ("11.3 per day"), so a two-part number counts as a release only beside those words.
const RELEASE_WORD = String.raw`(?:patch|update|version|release|build|hotfix)`;

const DATES = new RegExp(
  [
    String.raw`\b${YEAR}-\d{2}(?:-\d{2})?\b`, // 2026-09-09, 2026-09
    String.raw`\b(?:${WEEKDAY},?\s+)?${DAY}\s+(?:of\s+)?${MONTH}(?:,?\s+${YEAR})?(?![\p{L}])`, // 9 September 2026
    String.raw`\b(?:${WEEKDAY},?\s+)?${MONTH}\s+${DAY}\b(?:,?\s+${YEAR}\b)?`, // Sept 9th, 2026
    String.raw`\b${MONTH}\s+${YEAR}\b`, // September 2026
    String.raw`\bv?\d+(?:\.\d+){2,}\b`, // 1.2.3
    String.raw`\b(?:${RELEASE_WORD}|after|before|since|v)\s*\d+\.\d+\b`, // patch 42.3, after 42.3, v2.1
    String.raw`\b\d+\.\d+(?=\s+${RELEASE_WORD}\b)`, // 42.3 update
  ].join("|"),
  "giu",
);

/** The text with its dates and release numbers taken out. */
export const withoutDates = (s: string) => s.replace(DATES, " ");

// A date written as words only: a month or weekday name, or a word that places a message in time. With no digits,
// it counts nothing either.
const TIME_WORDS = new RegExp(
  String.raw`(?<![\p{L}])(?:${MONTH}|${WEEKDAY}|earlier|later|today|yesterday|this (?:week|month)|last (?:week|month))(?![\p{L}])`,
  "giu",
);

/** The text with its dates, release numbers and month or weekday names taken out. */
export const withoutTimeWords = (s: string) => withoutDates(s).replace(TIME_WORDS, " ");
