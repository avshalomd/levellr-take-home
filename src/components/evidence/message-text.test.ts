import { describe, expect, it } from "vitest";
import { cardMarkdown, linkLabel, plainMessage, safeHref } from "./message-text";

// The opening of a long announcement post, with a link, an image, a heading and emphasis (the card once showed every
// mark of it as text, and its long link ran off the card's right edge).
const report = [
  "[https://www.reddit.com/r/VeilOfAgesGames/comments/1n2abcd/map_service_report/](https://www.reddit.com/r/VeilOfAgesGames/comments/1n2abcd/map_service_report/)",
  "",
  "[media]",
  "",
  "# Schedule",
  "",
  "*※* *Due to rounding, the total may not add up to exactly 100%.*",
  "",
  "* **Harbor (25%) / Desert (25%)**",
].join("\n");

describe("cardMarkdown", () => {
  it("turns [media] into an image, which the card draws as a marker", () => {
    expect(cardMarkdown("# Schedule\n\n[media]\n\n# NA [MEDIA]")).toBe("# Schedule\n\n![image]()\n\n# NA ![image]()");
  });

  it("undoes Reddit's extra escaping of &, so its entities decode", () => {
    expect(cardMarkdown("&amp;#x200B;\n\nQ&amp;A &amp;lt;3")).toBe("&#x200B;\n\nQ&A &lt;3");
  });

  it("leaves the rest of the markdown as written", () => {
    expect(cardMarkdown("# Schedule\n\n*※* *Due to rounding*")).toBe("# Schedule\n\n*※* *Due to rounding*");
  });
});

describe("safeHref", () => {
  it("keeps web addresses", () => {
    expect(safeHref("https://example.org/en/news/11019")).toBe("https://example.org/en/news/11019");
    expect(safeHref(" http://example.com/a ")).toBe("http://example.com/a");
  });

  it("drops anything else, so it renders as plain text", () => {
    for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<b>x</b>", "/r/other", "mailto:a@b.c", "", "https://a b"])
      expect(safeHref(bad)).toBe("");
  });
});

describe("linkLabel", () => {
  it("shortens a link whose words are its own address", () => {
    expect(linkLabel("https://example.org/en/news/11019", "https://example.org/en/news/11019")).toBe("example.org/en/news/11019");
    const u = "https://www.reddit.com/r/VeilOfAgesGames/comments/1n2abcd/map_service_report/";
    expect(linkLabel(u, u)).toBe(
      "reddit.com/r/VeilOfAgesGames/comments/1…", // 40 characters, the ellipsis included
    );
  });

  // Review 2026-09-26: the words used to be shown as they were, so an address could hide a different one.
  it("shows where an address-looking link really goes, never the address its words claim", () => {
    expect(linkLabel("https://paypal.com/login", "https://evil.example/steal")).toBe("evil.example/steal");
    expect(linkLabel("paypal.com/login", "https://evil.example/steal")).toBe("evil.example/steal");
    expect(linkLabel("www.paypal.com", "https://evil.example")).toBe("evil.example");
  });

  it("leaves ordinary link words alone", () => {
    expect(linkLabel("Original Post (example.org)", "https://example.org")).toBeNull();
  });
});

describe("plainMessage", () => {
  it("reads the report as words: no heading or emphasis marks, links as their words, pictures as (image)", () => {
    expect(plainMessage(report).split("\n")).toEqual([
      "https://www.reddit.com/r/VeilOfAgesGames/comments/1n2abcd/map_service_report/",
      "",
      "(image)",
      "",
      "Schedule",
      "",
      "※ Due to rounding, the total may not add up to exactly 100%.",
      "",
      "Harbor (25%) / Desert (25%)",
    ]);
  });

  it("keeps link words and drops Reddit's blank-line filler", () => {
    expect(plainMessage("[Original Post (example.org)](https://example.org/en/news/11019)")).toBe("Original Post (example.org)");
    expect(plainMessage("&amp;#x200B;")).toBe("");
  });

  it("leaves underscores inside words and plain asterisks alone", () => {
    expect(plainMessage("set max_fps_limit to 144")).toBe("set max_fps_limit to 144");
    expect(plainMessage("5 * 3 = 15")).toBe("5 * 3 = 15");
    expect(plainMessage("\\*drives through a barrier\\*")).toBe("drives through a barrier");
  });
});
