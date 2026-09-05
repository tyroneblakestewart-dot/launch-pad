import { describe, expect, it } from "vitest";
import {
  MASCOT_REFERENCE_IDEAL_MIN_SIDE,
  MASCOT_REFERENCE_ROUGH_MIN_SIDE,
  MASCOT_REFERENCE_TIPS,
  assessMascotReference,
} from "@/lib/mascot-reference-guidance";

describe("mascot reference guidance", () => {
  it("ships a short, concrete tips list the tile can show before upload", () => {
    expect(MASCOT_REFERENCE_TIPS.length).toBeGreaterThanOrEqual(5);
    expect(MASCOT_REFERENCE_TIPS.some((tip) => tip.includes("One character only"))).toBe(true);
    expect(MASCOT_REFERENCE_TIPS.some((tip) => tip.includes(`${MASCOT_REFERENCE_IDEAL_MIN_SIDE}px`))).toBe(true);
  });

  it("calls a large square PNG great with no notes", () => {
    expect(assessMascotReference({ width: 1200, height: 1200, mimeType: "image/png" })).toEqual({
      verdict: "great",
      notes: [],
      summary: "Great reference — this should lock in cleanly.",
    });
  });

  it("marks a small image rough but still gives a summary that says we will proceed", () => {
    const result = assessMascotReference({ width: 300, height: 300, mimeType: "image/png" });
    expect(result.verdict).toBe("rough");
    expect(result.notes[0]).toContain("Quite small (300×300)");
    expect(result.summary).toContain("do our best");
    expect(MASCOT_REFERENCE_ROUGH_MIN_SIDE).toBe(512);
  });

  it("notes a mid-size image, a very wide crop and JPG transparency as ok-level advice", () => {
    const result = assessMascotReference({ width: 1600, height: 700, mimeType: "image/jpeg" });
    expect(result.verdict).toBe("ok");
    expect(result.notes).toHaveLength(3);
    expect(result.notes[0]).toContain("A bit small (1600×700)");
    expect(result.notes[1]).toContain("Very wide");
    expect(result.notes[2]).toContain("JPG has no transparency");
  });

  it("never blocks: an unreadable size is still a rough-with-notes result, not an error", () => {
    const result = assessMascotReference({ width: 0, height: 0 });
    expect(result.verdict).toBe("rough");
    expect(result.notes).toHaveLength(1);
    expect(() => assessMascotReference({ width: -5, height: Number.NaN })).not.toThrow();
  });
});
