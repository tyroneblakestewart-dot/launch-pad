import { describe, expect, it } from "vitest";
import {
  buildMascotImagePrompt,
  type MascotProject,
  type MascotVisualDNA,
} from "@/lib/server/mascot-prompt-builder";

const DNA: MascotVisualDNA = {
  characterDescription:
    "a stocky orange-hoodie wolf mascot with an oversized grin, small round sunglasses pushed up on its forehead, and a bushy striped tail",
  colourPalette: "burnt orange, cream, charcoal outlines",
  signatureProps: "a battered green backpack covered in pin badges",
  artStyle: "flat vector meme illustration, bold black outlines, halftone shading",
};

const PROJECT: MascotProject = { name: "Wolfpack", ticker: "WOLF" };

describe("buildMascotImagePrompt", () => {
  it("locks the character and visual DNA identically across different scenes", () => {
    const beach = buildMascotImagePrompt(DNA, "beach", PROJECT);
    const trading = buildMascotImagePrompt(DNA, "trading", PROJECT);
    const casino = buildMascotImagePrompt(DNA, "casino", PROJECT);

    const characterLine = (prompt: string) => prompt.split("\n\n")[0];
    const visualDnaLine = (prompt: string) => prompt.split("\n\n").at(-1);

    expect(characterLine(beach.prompt)).toBe(characterLine(trading.prompt));
    expect(characterLine(trading.prompt)).toBe(characterLine(casino.prompt));
    expect(visualDnaLine(beach.prompt)).toBe(visualDnaLine(trading.prompt));
    expect(visualDnaLine(trading.prompt)).toBe(visualDnaLine(casino.prompt));

    for (const result of [beach, trading, casino]) {
      expect(result.prompt).toContain(DNA.characterDescription);
      expect(result.prompt).toContain(DNA.colourPalette);
      expect(result.prompt).toContain(DNA.signatureProps);
      expect(result.prompt).toContain(DNA.artStyle);
    }
  });

  it("produces different scene sections for different preset chips", () => {
    const beach = buildMascotImagePrompt(DNA, "beach", PROJECT);
    const trading = buildMascotImagePrompt(DNA, "trading", PROJECT);

    expect(beach.sceneKey).toBe("beach");
    expect(trading.sceneKey).toBe("trading");
    expect(beach.prompt).not.toBe(trading.prompt);
  });

  it("matches scene presets case-insensitively and trims whitespace", () => {
    const result = buildMascotImagePrompt(DNA, "  Beach  ", PROJECT);
    expect(result.sceneKey).toBe("beach");
  });

  it("injects only the caller's own project name and ticker", () => {
    const result = buildMascotImagePrompt(DNA, "trading", PROJECT);

    expect(result.prompt).toContain("Wolfpack");
    expect(result.prompt).toContain("$WOLF");
  });

  it("strips other projects' cashtags out of free-text scene input", () => {
    const result = buildMascotImagePrompt(
      DNA,
      "pumping harder than $DOGE at the launch party",
      PROJECT,
    );

    expect(result.prompt).not.toContain("$DOGE");
    expect(result.strippedTerms).toContain("$DOGE");
    expect(result.sanitisedScene).not.toContain("$DOGE");
  });

  it("strips well-known other project names out of free-text scene input", () => {
    const result = buildMascotImagePrompt(
      DNA,
      "racing a Bitcoin whale to the moon",
      PROJECT,
    );

    expect(result.prompt.toLowerCase()).not.toContain("bitcoin");
    expect(result.strippedTerms.some((term) => term.toLowerCase() === "bitcoin")).toBe(true);
  });

  it("keeps the caller's own cashtag when it appears in free-text scene input", () => {
    const result = buildMascotImagePrompt(DNA, "$WOLF pack going wild at the arcade", PROJECT);

    expect(result.strippedTerms).not.toContain("$WOLF");
    expect(result.sanitisedScene).toContain("$WOLF");
  });

  it("handles arbitrary free-text scenes with the generic five-step expansion", () => {
    const result = buildMascotImagePrompt(DNA, "at the gym deadlifting", PROJECT);

    expect(result.sceneKey).toBe("custom");
    expect(result.prompt).toContain("at the gym deadlifting");
    expect(result.prompt).toContain("SITUATION:");
    expect(result.prompt).toContain("CRYPTO CULTURE:");
    expect(result.prompt).toContain("MEME/JOKE:");
    expect(result.prompt).toContain("MINI-STORY:");
    expect(result.prompt).toContain("HIDDEN DETAILS:");
  });

  it("always states the mascot is the sole character", () => {
    const result = buildMascotImagePrompt(DNA, "casino", PROJECT);
    expect(result.prompt).toContain("sole character");
  });

  it("normalises a ticker that already includes a leading $", () => {
    const result = buildMascotImagePrompt(DNA, "beach", { name: "Wolfpack", ticker: "$WOLF" });
    expect(result.prompt).toContain("$WOLF");
    expect(result.prompt).not.toContain("$$WOLF");
  });
});
