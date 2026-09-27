import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MessageText } from "./MessageText";

// The card's text as HTML, rendered on the server: no browser needed to see what the reader would get.
const html = (text: string) => renderToStaticMarkup(<MessageText text={text} />);

describe("MessageText", () => {
  it("renders a post's markdown as formatting, not as marks (QA 2026-09-25)", () => {
    const out = html("# Schedule\n\n*※* *Due to rounding.*\n\n* **Harbor**");
    expect(out).toContain('<p class="mt-3 mb-1 font-semibold text-foreground first:mt-0">Schedule</p>');
    expect(out).toContain("<em>※</em> <em>Due to rounding.</em>");
    expect(out).toContain("<strong>Harbor</strong>");
    expect(out).not.toMatch(/[#*]/);
  });

  it("draws [media] as a small Image marker and loads no picture", () => {
    const out = html("[media]\n\n![map](https://example.com/map.png)");
    expect(out.match(/>Image<\/span>/g)).toHaveLength(2);
    expect(out).not.toContain("<img");
    expect(out).not.toContain("[media]");
  });

  it("opens web links in a new tab, shortened when the words are the address", () => {
    const url = "https://www.reddit.com/r/VeilOfAgesGames/comments/1n2abcd/map_service_report/";
    const out = html(`[${url}](${url})`);
    expect(out).toContain(`href="${url}" target="_blank" rel="noopener noreferrer"`);
    expect(out).toContain(">reddit.com/r/VeilOfAgesGames/comments/1…</a>");
  });

  it("labels an address-looking link with where it really goes (review 2026-09-26)", () => {
    const out = html("[https://paypal.com/login](https://evil.example/steal)");
    expect(out).toContain('href="https://evil.example/steal"');
    expect(out).toContain(">evil.example/steal</a>");
    expect(out).not.toContain("paypal");
  });

  it("never makes a link of anything but a web address, and never renders raw HTML", () => {
    const out = html("[click](javascript:alert(1)) <b>raw</b>");
    expect(out).not.toContain("<a");
    expect(out).not.toContain("<b>");
    expect(out).toContain("click &lt;b&gt;raw&lt;/b&gt;");
  });

  it("keeps a single line break, the way Discord messages break lines", () => {
    expect(html("line one\nline two")).toContain("line one\nline two");
  });
});
