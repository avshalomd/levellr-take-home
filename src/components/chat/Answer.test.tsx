import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Answer, stripStrayRefs } from "./Answer";
import type { Evidence } from "./evidence";

// The answer rendered on the server, to check the markdown pieces still reach this answer's claims and chips now that
// they are made once and read them from context (Answer.tsx: made per render, they remounted the focused chip).
const evidence = (text: string, cited: string[]): Evidence => ({ refs: new Map(), retrievedConversations: new Set(), cited, support: new Map(), text });
const html = (e: Evidence, onAsk?: (q: string) => void) =>
  renderToStaticMarkup(<Answer evidence={e} onOpen={() => {}} onHoverClaim={() => {}} onShowStep={() => {}} onOpenMore={() => {}} onAsk={onAsk} />);

describe("Answer", () => {
  it("turns citations into chips inside claims, in paragraphs, list items, headings and table cells", () => {
    const out = html(evidence("## Lag [msg3]\n\nLag is the top issue [msg1].\n\n- Queues are long [msg2].\n\n| a |\n|---|\n| b [msg1] |", ["msg1", "msg2", "msg3"]));
    expect(out.match(/data-cite="msg1"/g)).toHaveLength(2);
    expect(out).toContain('data-cite="msg2"');
    expect(out).toMatch(/<h3[^>]*><span[^>]*>Lag <span[^>]*><button[^>]*data-cite="msg3"/);
    expect(out.match(/class="claim"/g)).toHaveLength(2);
    expect(out).not.toContain("[msg");
  });

  it("lets punctuation hug a tool glyph, and keeps the margin before a word (QA 2026-09-25)", () => {
    const out = html(evidence("It scored 25/100 [scan], and 12 posts [aggregate] say so.", []));
    expect(out.match(/-mr-\[3px\]/g)).toHaveLength(1);
    expect(out.match(/mx-0\.5/g)).toHaveLength(1);
    expect(out).toContain("</button>, and 12 posts");
  });

  // QA 2026-09-26: a chip's margin before a "." read as a space, and "+N more" sat past the full stop.
  it("lets a chip before punctuation hug it, and keeps its margin before a word", () => {
    const out = html(evidence("Lag is up [msg1]. Queues [msg2] are long", ["msg1", "msg2"]));
    expect(out).toMatch(/<span class="group\/chip relative inline-block -translate-y-\[1px\] align-middle ml-\[3px\]"><button[^>]*data-cite="msg1"/);
    expect(out).toMatch(/<span class="group\/chip relative inline-block -translate-y-\[1px\] align-middle mx-\[3px\]"><button[^>]*data-cite="msg2"/);
  });

  it("puts a claim's +N more before its full stop, bound to it", () => {
    const e: Evidence = {
      ...evidence("Lag is up [msg1]. Queues are long.", ["msg1"]),
      corroboration: { status: "done", pool: 20, found: 20, failed: 0, claims: [{ claim: "Lag is up", tags: ["msg1"], conversations: 5, more: [], moreTotal: 4 }] },
    };
    const out = html(e);
    expect(out).toMatch(/data-cite="msg1"[\s\S]*<span class="whitespace-nowrap"><button[^>]*data-more[^>]*class="[^"]*ml-1[^"]*"[^>]*>\+4 more<\/button>\.<\/span> <\/span>Queues are long\./);
  });

  // QA 2026-09-26: the pill said "more than the ones cited" in one unit while the panel counted in another.
  it("names the +N more in conversations, the unit its chips and the panel use", () => {
    const e: Evidence = {
      ...evidence("Lag is up [msg1][msg2].", ["msg1", "msg2"]),
      corroboration: { status: "done", pool: 20, found: 20, failed: 0, claims: [{ claim: "Lag is up", tags: ["msg1", "msg2"], conversations: 5, more: [], moreTotal: 3 }] },
    };
    expect(html(e)).toContain('aria-label="5 conversations say this: 2 cited in the answer, 3 more. Show them."');
  });

  // QA 2026-09-26: chips were 18px targets 4px apart. Each keeps its 18px mark and gets a 24px hit area, a transparent
  // layer 3px past every edge; so do the tool glyphs and the +N more.
  it("gives chips, tool glyphs and +N more a 24px hit area without changing their size", () => {
    const e: Evidence = {
      ...evidence("Lag is up [msg1]. It scored 25/100 [scan].", ["msg1"]),
      corroboration: { status: "done", pool: 20, found: 20, failed: 0, claims: [{ claim: "Lag is up", tags: ["msg1"], conversations: 5, more: [], moreTotal: 4 }] },
    };
    const out = html(e);
    const buttons = out.match(/<button[^>]*>/g) ?? [];
    const chip = buttons.find((b) => b.includes('data-cite="msg1"'))!;
    const glyph = buttons.find((b) => b.includes("size-[18px]") && !b.includes("data-cite"))!;
    const more = buttons.find((b) => b.includes("data-more"))!;
    for (const b of [chip, glyph, more]) {
      expect(b).toContain("before:absolute");
      expect(b).toContain("before:-inset-[3px]");
      expect(b).toMatch(/\brelative\b/);
    }
    expect(chip).toContain("h-[18px]");
    expect(more).toContain("h-[18px]");
  });

  // Review 2026-09-26: matched by the claim's raw tags, a sentence citing one message twice over got another claim's
  // count, and a hidden chip kept a sentence from its own claim.
  it("gives each sentence its own +N more, matched by its words and the chips it shows", () => {
    const claim = (text: string, tags: string[], moreTotal: number) => ({ claim: text, tags, conversations: moreTotal + 1, more: [], moreTotal });
    const twice: Evidence = {
      ...evidence("Lag is up [msg1]. Queues are long [msg1].", ["msg1"]),
      corroboration: { status: "done", pool: 20, found: 20, failed: 0, claims: [claim("Lag is up.", ["msg1"], 4), claim("Queues are long.", ["msg1"], 7)] },
    };
    const out = html(twice);
    expect(out.match(/data-more/g)).toHaveLength(2);
    expect(out.indexOf("+4 more")).toBeLessThan(out.indexOf("+7 more"));
    const hidden: Evidence = {
      ...evidence("Bans are slow [msg1, msg9].", ["msg1"]),
      corroboration: { status: "done", pool: 20, found: 20, failed: 0, claims: [claim("Cheaters are everywhere.", ["msg1", "msg2"], 9), claim("Bans take weeks.", ["msg1"], 4)] },
    };
    expect(html(hidden)).toContain("+4 more");
  });

  // QA 2026-09-26: an off-topic answer was a dead end. It now offers questions, and each is a tap away.
  it("makes the questions an answer offers askable, only when the answer cites nothing", () => {
    const offer = "I can only answer about the community's conversations from 18 June to 24 September. You could ask:\n\n- What are people saying about the new map?\n- Which problems are reported most often?";
    const out = html(evidence(offer, []), () => {});
    expect(out.match(/<button type="button" data-ask/g)).toHaveLength(2);
    expect(out).toContain(">What are people saying about the new map?</button>");
    expect(html(evidence(offer, []))).not.toContain("data-ask");
    expect(html(evidence("Lag is up [msg1].\n\n- Is it the servers?", ["msg1"]), () => {})).not.toContain("data-ask");
  });
});

// QA 2026-09-26: the last line of defence. The pipeline tidies handles out of the text; whatever still slips through
// must not reach the reader as raw text.
describe("stray message and conversation handles", () => {
  it("are taken out of the text, with the space they leave before punctuation", () => {
    expect(stripStrayRefs("People are angry [conv12].")).toBe("People are angry.");
    expect(stripStrayRefs("See conv12 and msg40 for more")).toBe("See and for more");
    expect(stripStrayRefs("Cut short [msg…] here")).toBe("Cut short here");
    expect(stripStrayRefs("Cut short [msg...] here")).toBe("Cut short here");
    expect(stripStrayRefs("Left open at the end [msg12")).toBe("Left open at the end");
    expect(stripStrayRefs("The [conversation] and a message stay")).toBe("The [conversation] and a message stay");
  });

  it("never render, in prose or link text, while a real citation still becomes its chip", () => {
    const out = html(evidence("Lag is up [msg1], see conv77 [conv77]. Try [msg…].\n\n[conv5](https://example.com) matters.", ["msg1"]));
    expect(out).toContain('data-cite="msg1"');
    const text = out.replace(/<[^>]+>/g, ""); // what the reader sees
    expect(text).not.toMatch(/(msg|conv)(\d|…|\.\.\.)/);
    expect(text).toContain("Lag is up 1, see. Try"); // "1" is the chip
  });

  // Review 2026-09-26: the guard was /msg|conv/, true for any answer saying "conversation", and code spans were edited.
  it("touch only text with a handle in it, and leave code spans as written", () => {
    expect(stripStrayRefs("In 12 conversations : 3 were bugs ; see above")).toBe("In 12 conversations : 3 were bugs ; see above");
    const out = html(evidence("Lag is up [msg1]. Try `grep '[msg…]' log ;` in the console.", ["msg1"]));
    expect(out).toContain("<code");
    expect(out.replace(/<[^>]+>/g, "")).toContain("grep &#x27;[msg…]&#x27; log ;");
  });

  // Production QA 2026-09-26: "…the 43.1 release on 2026-09-09 [dataset_overview]." A bracketed tool name or
  // snake_case token is not a citation and never reaches the reader; the step tags stay.
  it("drop a bracketed tool name or snake_case token, never a step tag", () => {
    expect(stripStrayRefs("It coincides with the 43.1 release [dataset_overview].")).toBe("It coincides with the 43.1 release.");
    expect(stripStrayRefs("Read it [read_conversation] twice.")).toBe("Read it twice.");
    expect(stripStrayRefs("212 of 840 [scan].")).toBe("212 of 840 [scan].");
  });
});
