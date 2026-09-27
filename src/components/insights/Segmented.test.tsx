import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Segmented } from "./Segmented";

describe("Segmented", () => {
  it("leaves its focus ring to the page's own, the same ring as every other control (QA 2026-09-26)", () => {
    const html = renderToStaticMarkup(
      <Segmented id="t" label="Group by" groups={[[{ value: "a", label: "A" }, { value: "b", label: "B" }]]} value="a" onChange={() => {}} />,
    );
    expect(html).toContain('role="radio"');
    expect(html).not.toMatch(/outline-none|focus-visible:ring/);
  });
});
