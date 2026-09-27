import { describe, expect, it, vi } from "vitest";
import { undoable } from "./undoable";

describe("undoable", () => {
  it("commits once when the window closes, however many times it is told", () => {
    const commit = vi.fn();
    const d = undoable(commit);
    d.settle();
    d.settle();
    expect(commit).toHaveBeenCalledTimes(1);
  });
  it("never commits after an Undo", () => {
    const commit = vi.fn();
    const d = undoable(commit);
    d.undo();
    d.settle();
    expect(commit).not.toHaveBeenCalled();
  });
});
