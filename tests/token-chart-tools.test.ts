import { describe, expect, it } from "vitest";
import { addHorizontalLine, removeHorizontalLine } from "@/lib/token-chart-tools";

describe("addHorizontalLine", () => {
  it("appends a new line without mutating the input array", () => {
    const lines = [{ id: "a", price: 1 }];
    const next = addHorizontalLine(lines, 2, "b");
    expect(lines).toHaveLength(1);
    expect(next).toEqual([
      { id: "a", price: 1 },
      { id: "b", price: 2 },
    ]);
  });
});

describe("removeHorizontalLine", () => {
  it("removes only the line with the matching id", () => {
    const lines = [
      { id: "a", price: 1 },
      { id: "b", price: 2 },
    ];
    expect(removeHorizontalLine(lines, "a")).toEqual([{ id: "b", price: 2 }]);
  });

  it("is a no-op when the id isn't present", () => {
    const lines = [{ id: "a", price: 1 }];
    expect(removeHorizontalLine(lines, "missing")).toEqual(lines);
  });
});
