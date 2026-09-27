import { describe, expect, it } from "vitest";
import { communityInProse, communityTitle } from "./community";

describe("the community's name", () => {
  it("drops the note in brackets the export carries", () => {
    expect(communityTitle("Veil of Ages Discord (Levellr sample)")).toBe("Veil of Ages Discord");
    expect(communityTitle("Some Server")).toBe("Some Server");
    expect(communityTitle(undefined)).toBe("");
  });

  it("reads with an article in a sentence, never twice", () => {
    expect(communityInProse("Veil of Ages Discord (Levellr sample)")).toBe("the Veil of Ages Discord");
    expect(communityInProse("The Veil Discord")).toBe("the Veil Discord");
    expect(communityInProse("r/pubg")).toBe("r/pubg");
    expect(communityInProse("", "the Veil of Ages Discord")).toBe("the Veil of Ages Discord");
  });
});
