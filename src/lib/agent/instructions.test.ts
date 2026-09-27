import { describe, expect, it } from "vitest";
import { instructions, scoreWords } from "./instructions";

// The standing instructions are prose, so this only pins that the rules behind the reader's numbers are still in them
// (QA, 2026-09-25): one scan per slice, a scan's two numbers kept apart, and periods counted alike to be compared.
describe("instructions", () => {
  const text = instructions(
    { community: "PUBG", platform: "Reddit", about: "", from: "2026-06-18", to: "2026-09-24" },
    "2026-09-25",
  );

  it("asks for one scan per slice", () => {
    expect(text).toMatch(/Scan a slice once/);
  });
  it("keeps a scan's slice size apart from its relevant count", () => {
    expect(text).toMatch(/never give the slice's size as the number\s+of conversations that say something/);
  });
  it("asks for the same count per period when periods are compared", () => {
    expect(text).toMatch(/make the same aggregate once per\s+period/);
  });
  // QA 2026-09-26: asked for the mood overall, the answer quietly counted only the complaining conversations.
  it("filters to a flag only when the question asks for it, and says when a number is narrower than the question", () => {
    expect(text).toMatch(
      /Filter to a flag \(complaints, bugs, requests for changes, help\) only when the question asks about that flag/,
    );
    expect(text).toMatch(
      /When a number covers less than the question asked[\s\S]*say so\s+in the sentence that gives it/,
    );
  });
  // QA 2026-09-26: a yes/no scan question's count was read as the people who said yes.
  it("never reports a scan's count as how many agree", () => {
    expect(text).toMatch(/whichever way it leans\. Never report\s+it as how many agree/);
  });
  it("keeps the tools' own words out of the answer", () => {
    expect(text).toMatch(/no "slice", "scan", "aggregate"/);
  });
  // QA 2026-09-26 (round 3): "how do players feel about the Rondo changes" read only the complaint threads and said
  // "mostly negative"; "who is most active in discussions about lag" counted only the bug reports.
  it("reads every kind of conversation for a question about feelings, reactions or who takes part", () => {
    expect(text).toMatch(/A question about how people feel, their opinion, their reaction or\s+the mood/);
    expect(text).toMatch(
      /reads every kind of conversation about X,\s+praise and questions as well as complaints: scan it with no flag/,
    );
    expect(text).toMatch(/"who is\s+most active in discussions about lag" is everyone talking about\s+lag/);
    expect(text).toMatch(/never by a flag the question did not ask about/);
    expect(text).not.toMatch(/narrowest\s+slice the question allows \(topic, flag/);
  });
  // QA 2026-09-26: "How did people react to version 42.3?" read only complaint threads and bug reports, opened with "80
  // of 224 complaint conversations about version 42.3" (224 was the topic's complaints), and led with "mostly negative"
  // above points finding views mixed.
  it("reads every kind of conversation for a reaction to a release, and says a refused flag is made again without", () => {
    expect(text).toMatch(
      /"how did people react to <a release or\s+change>": the reaction is every kind of conversation about it/,
    );
    expect(text).toMatch(/A call with a flag the question does not name is refused: make it again without/);
  });
  it("never gives a scan's slice as if it were the subject of its question", () => {
    expect(text).toMatch(
      /A scan's slice is what it read \(a topic, a period\), not the\s+subject of its question/,
    );
    expect(text).toMatch(/never "80 of 224 conversations about version\s+42\.3"/);
  });
  it("keeps the first sentence in agreement with the points under it", () => {
    expect(text).toMatch(/The first sentence agrees with the points under it/);
  });
  it("puts any narrowing in the answer's first sentence", () => {
    expect(text).toMatch(/the answer's FIRST sentence says so: "Among the complaint threads/);
  });
  it("compares periods on what the answer is about", () => {
    expect(text).toMatch(/an answer about complaints compares complaints, not another kind of conversation/);
  });
  // QA 2026-09-26: "I can't access live weather data." and nothing else; then (round 5) the weather got one sentence and
  // the pizza question scope and suggestions. The reply is written in code now (off-topic.ts); the model only calls it.
  it("sends an off-topic question to out_of_scope, and never answers it itself", () => {
    expect(text).toMatch(/-> out_of_scope, alone, and write nothing: the app writes the reply/);
    expect(text).toMatch(
      /call out_of_scope and write nothing: the app answers with PUBG's conversations from 2026-06-18\s+to 2026-09-24/,
    );
    expect(text).toMatch(/Never answer it yourself, and never stop at "I can't"/);
    expect(text).toMatch(/Never write "dataset"/);
    // the prompt itself does not call the conversations a dataset, or the model repeats it
    expect(text.replace(/dataset_overview|Never write "dataset", "data set"/g, "")).not.toMatch(
      /dataset|data set/i,
    );
  });
  // QA 2026-09-26, round 5: five answers quoting threads and causes from counts alone, with nothing cited.
  it("answers what people say from messages read, never from counts alone", () => {
    expect(text).toMatch(
      /answered from messages you read \(scan or find\), never\s+from counts alone: counts carry no messages to cite/,
    );
  });
  it("reads a question about a release across every topic over its days", () => {
    expect(text).toMatch(
      /A question about a release or update \("the latest update", "patch 43\.1"\) is about the whole community: read\s+every topic over the release's days/,
    );
  });
  it("compares periods of different lengths by their per-day rates", () => {
    expect(text).toMatch(
      /Periods of different lengths \(July has 31 days, 1-24 September 24\) are compared by their per-day rates/,
    );
    expect(text).toMatch(/never by raw counts/);
  });
  it("opens with what was covered when a step did not finish", () => {
    expect(text).toMatch(
      /If a tool call did not finish, the answer's FIRST sentence says what the answer covers, in plain words: "One read\s+didn't finish, so this covers only/,
    );
  });
  it("never names the tools or the sample to the reader, and gives the mood of the whole set", () => {
    expect(text).toMatch(
      /never "the scan", "the conversations shown" or "the\s+results": the reader never saw them/,
    );
    expect(text).toMatch(
      /Give the mood of the whole set the answer\s+is about[\s\S]*never a range or an average over the few\s+conversations a read prints/,
    );
  });
  // QA 2026-09-26, production: "EU/Asia servers" and "boosted/stolen" still reached answers.
  it("asks for no slashes between words in prose, with the words to write instead", () => {
    expect(text).toMatch(
      /No slashes between words in prose, headings and bullets included: a slash between two words is always "and" or\s+"or", so write that word\./,
    );
    expect(text).toMatch(
      /Write "EU and Asia servers", "boosted or stolen", "recoil or negative descriptions",\s+"anti-cheat and bans", never "EU\/Asia servers", "boosted\/stolen", "ADS\/recoil", "recoil\/negative" or "anti-cheat\/ban"\./,
    );
  });
  it("says what mood is in plain words", () => {
    expect(text).toMatch(
      /how positive people\s+sound in a conversation, from 0 \(very negative\) to 100 \(very positive\)/,
    );
  });
});

// Production QA 2026-09-26: a subject's question answered with the community's mood, and a causal link no message
// made; "another said" after a plural, ISO dates and hyphens in prose, "the new Rondo map" echoed from the question,
// a tag on the sentence after its figures, and a percent change worked out by the model.
describe("instructions, production QA 2026-09-26", () => {
  const text = instructions(
    { community: "PUBG", platform: "Reddit", about: "", from: "2026-06-18", to: "2026-09-24" },
    "2026-09-25",
  );
  it("gives the mood of the subject the question names, and says so when only the community's is known", () => {
    expect(text).toMatch(
      /When the question names a subject[\s\S]*give the mood of that subject's own\s+conversations/,
    );
    expect(text).toMatch(
      /If only the community-wide mood is known, the FIRST sentence says the figure is the whole community's/,
    );
  });
  it("makes no cause and effect no message states", () => {
    expect(text).toMatch(
      /Never tie two things together as cause and effect \("because", "led to", "drove", "were not enough to lift"\) unless\s+a message you cite says so/,
    );
  });
  it("sets the copy rules: another, dates, the minus sign and words the question used", () => {
    expect(text).toMatch(/"Another" follows one person[\s\S]*write\s+"others", never "another"/);
    expect(text).toMatch(/Dates in words, "9 September", never 2026-09-09/);
    expect(text).toContain('A fall takes a minus sign, "\u221248%", never a hyphen.');
    expect(text).toMatch(/calls\s+"new" is not new if people wrote about it before/);
    expect(text).toMatch(/No slashes between words in prose/);
    expect(text).toContain('"ADS/recoil"');
  });
  it("keeps a number's tag in its own sentence and takes a percent change from aggregate", () => {
    expect(text).toMatch(/The tag goes in the sentence that states the number/);
    expect(text).toMatch(
      /A change between two periods is the percentage aggregate gives[\s\S]*never one you\s+work out/,
    );
  });
});

// QA 2026-09-26: the panel said "62 votes", Explore "+75 net votes" and an answer "net +30 upvotes".
describe("scoreWords", () => {
  it("calls a Reddit score net votes, and never upvotes", () => {
    expect(scoreWords("Reddit")).toMatch(
      /^net votes \(upvotes minus downvotes\): write "\+30 net votes", never "upvotes"/,
    );
    expect(instructions({ community: "c", platform: "Reddit", about: "", from: "a", to: "b" })).toContain(
      'write "+30 net votes"',
    );
  });
  it("keeps each platform's own measure", () => {
    expect(scoreWords("Discord")).toMatch(/^reactions/);
    expect(scoreWords("")).toMatch(/^score/);
  });
});

// D46: topics are multi-label, and mood is measured towards a target found at onboarding.
describe("instructions, multi-label topics and the mood target", () => {
  const base = { community: "PUBG", platform: "Reddit", about: "", from: "2026-06-18", to: "2026-09-24" };

  it("says a conversation can have several topics, and that shares by topic can add up to more than 100%", () => {
    const text = instructions(base, "2026-09-25");
    expect(text).toMatch(
      /A conversation can have several topics\. A topic's conversations are every conversation touching it/,
    );
    expect(text).toMatch(/shares by topic can add up to more than\s+100%/);
  });

  it("says how to count the overlap of two topics, and that a scan's relevant count is not it", () => {
    // 27 Sep QA: "108 of the 1,376 conversations about cheating also discuss performance" - 108 was the scan's count
    // of conversations bearing on the question; the overlap was 81.
    const text = instructions(base, "2026-09-25");
    expect(text).toMatch(/two topics at once: aggregate by topic with a filter on one of them/);
    expect(text).toMatch(/A scan's count of conversations that bear on a question is never that overlap/);
  });

  it("says what mood is measured towards when the target is known, and keeps the older wording when it is not", () => {
    const target = {
      target: "the game PUBG: Battlegrounds and Krafton, its developer",
      why: "most threads are about the game",
      alternatives: [],
    };
    expect(instructions({ ...base, moodTarget: target }, "2026-09-25")).toMatch(
      /Mood is measured towards the game PUBG: Battlegrounds and Krafton, its developer: how positively people sound about it/,
    );
    expect(instructions(base, "2026-09-25")).not.toMatch(/measured towards/);
  });
});

// His ruling 27 Sep: the conversation is the one unit, and the agent is honest about what it cannot count.
describe("instructions, the one unit", () => {
  const text = instructions(
    { community: "PUBG", platform: "Reddit", about: "", from: "2026-06-18", to: "2026-09-24" },
    "2026-09-25",
  );
  it("says everything is counted by conversation, dated by its start, and what that cannot give", () => {
    expect(text).toMatch(
      /Everything is counted by conversation: a thread's opening or one chain of replies, dated by the day it starts/,
    );
    expect(text).toMatch(
      /Single messages by\s+their own time, posts\s+apart from replies, bots' or removed messages counted apart or left out/,
    );
    // A10, 27 Sep: the agent told the reader every count EXCLUDES bots; they are all in.
    expect(text).toMatch(/Every count includes bots' and removed messages/);
    expect(text).toMatch(/in a count by day\s+or week, say that once/);
    expect(text).toMatch(/say in the FIRST sentence what it counts\s+and what it cannot/);
    expect(text).toMatch(/Never present it as the thing asked/);
    // A09, 27 Sep: "how many posts" got "2,604 conversations were started" with no word that posts are not counted.
    expect(text).toMatch(
      /"how many posts" is answered "2,604 conversations started \(a thread's opening\s+or one chain of replies; single posts are not counted apart\)/,
    );
  });
  it("points engagement at net_votes and months at group_by month", () => {
    expect(text).toMatch(/Engagement is net_votes; "by month" is\s+group_by month/);
  });
});
