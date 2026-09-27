import { describe, expect, it } from "vitest";
import { inGridOrder } from "./topic-order";

const l = (key: string) => ({ key });

describe("inGridOrder", () => {
  it("lists the topics in the grid's row order, not the order they were saved in", () => {
    const saved = [l("cheating"), l("highlights"), l("other"), l("maps")];
    expect(inGridOrder(saved, ["highlights", "maps", "cheating", "other"]).map((x) => x.key)).toEqual([
      "highlights",
      "maps",
      "cheating",
      "other",
    ]);
  });
  it("puts topics the grid does not show after its own, in their written order, with the catch-all still last", () => {
    const saved = [l("other"), l("new:1"), l("maps"), l("empty"), l("highlights")];
    expect(inGridOrder(saved, ["highlights", "maps", "other"]).map((x) => x.key)).toEqual([
      "highlights",
      "maps",
      "new:1",
      "empty",
      "other",
    ]);
  });
  it("does not change the list it was given", () => {
    const saved = [l("b"), l("a")];
    inGridOrder(saved, ["a", "b"]);
    expect(saved.map((x) => x.key)).toEqual(["b", "a"]);
  });
});
