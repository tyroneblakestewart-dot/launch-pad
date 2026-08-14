import { describe, expect, it } from "vitest";
import {
  buildMascotImagePrompt,
  type MascotProject,
  type MascotScenePreset,
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

const PRESET_SCENES: MascotScenePreset[] = [
  "beach",
  "celebrating",
  "trading",
  "space",
  "city streets",
  "office",
  "casino",
  "nature",
];

describe("buildMascotImagePrompt", () => {
  it("locks the character and visual DNA identically across different scenes", () => {
    const beach = buildMascotImagePrompt(DNA, "beach", PROJECT);
    const trading = buildMascotImagePrompt(DNA, "trading", PROJECT);
    const space = buildMascotImagePrompt(DNA, "space", PROJECT);

    const characterLine = (prompt: string) => prompt.split("\n\n")[0];
    const visualDnaLine = (prompt: string) => prompt.split("\n\n").at(-1);

    expect(characterLine(beach.prompt)).toBe(characterLine(trading.prompt));
    expect(characterLine(trading.prompt)).toBe(characterLine(space.prompt));
    expect(visualDnaLine(beach.prompt)).toBe(visualDnaLine(trading.prompt));
    expect(visualDnaLine(trading.prompt)).toBe(visualDnaLine(space.prompt));

    for (const result of [beach, trading, space]) {
      expect(result.prompt).toContain(DNA.characterDescription);
      expect(result.prompt).toContain(DNA.colourPalette);
      expect(result.prompt).toContain(DNA.signatureProps);
      expect(result.prompt).toContain(DNA.artStyle);
    }
  });

  it("keeps core character colours locked while scene colour worlds vary", () => {
    const beach = buildMascotImagePrompt(DNA, "beach", PROJECT);
    const trading = buildMascotImagePrompt(DNA, "trading", PROJECT);
    const space = buildMascotImagePrompt(DNA, "space", PROJECT);

    for (const result of [beach, trading, space]) {
      expect(result.colourWorld.coreColours).toBe(DNA.colourPalette);
      expect(result.prompt).toContain(
        `core colours (locked across every scene) — ${DNA.colourPalette}`,
      );
      expect(result.colourWorld.source).toBe("preset");
    }

    expect(beach.colourWorld.environmentalColours).not.toBe(
      trading.colourWorld.environmentalColours,
    );
    expect(trading.colourWorld.environmentalColours).not.toBe(
      space.colourWorld.environmentalColours,
    );
    expect(beach.colourWorld.accentColours).not.toBe(space.colourWorld.accentColours);
  });

  it("supports the full standard scene-chip palette map", () => {
    for (const scene of PRESET_SCENES) {
      const result = buildMascotImagePrompt(DNA, scene, PROJECT);
      expect(result.sceneKey).toBe(scene);
      expect(result.colourWorld.paletteKey).toBe(scene);
      expect(result.colourWorld.source).toBe("preset");
      expect(result.colourWorld.environmentalColours.length).toBeGreaterThan(20);
      expect(result.colourWorld.contrastColours.length).toBeGreaterThan(20);
      expect(result.colourWorld.accentColours.length).toBeGreaterThan(20);
    }
  });

  it("produces different creative sections for different preset chips", () => {
    const beach = buildMascotImagePrompt(DNA, "beach", PROJECT);
    const trading = buildMascotImagePrompt(DNA, "trading", PROJECT);

    expect(beach.sceneKey).toBe("beach");
    expect(trading.sceneKey).toBe("trading");
    expect(beach.prompt).not.toBe(trading.prompt);
  });

  it("matches scene presets case-insensitively and trims whitespace", () => {
    const result = buildMascotImagePrompt(DNA, "  City Streets  ", PROJECT);
    expect(result.sceneKey).toBe("city streets");
  });

  it("uses the v2 formula in the required order", () => {
    const result = buildMascotImagePrompt(DNA, "celebrating", PROJECT);
    const headings = [
      "IDEA:",
      "ASSOCIATIONS (connected chain — no random props):",
      "STORY:",
      "MEME:",
      "COLOUR WORLD:",
      "EXAGGERATION:",
      "DETAILS:",
    ];

    const positions = headings.map((heading) => result.prompt.indexOf(heading));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
  });

  it("enforces connected associations instead of random props", () => {
    const result = buildMascotImagePrompt(DNA, "casino", PROJECT);

    expect(result.prompt).toContain("ASSOCIATIONS (connected chain — no random props):");
    expect(result.prompt).toContain("→");
    expect(result.prompt).toContain(
      "Every object, prop, and visual effect must be caused by or clearly relate to the preceding link",
    );
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

  it("derives a sensible colour world for free-text scenes", () => {
    const result = buildMascotImagePrompt(DNA, "at the gym deadlifting", PROJECT);

    expect(result.sceneKey).toBe("custom");
    expect(result.colourWorld.source).toBe("derived");
    expect(result.colourWorld.paletteKey).toBe("industrial");
    expect(result.colourWorld.coreColours).toBe(DNA.colourPalette);
    expect(result.colourWorld.environmentalColours).toContain("concrete grey");
    expect(result.prompt).toContain("at the gym deadlifting");
  });

  it("falls back to a scene-specific derived palette for unmatched free text", () => {
    const result = buildMascotImagePrompt(DNA, "inside an old library after closing", PROJECT);

    expect(result.sceneKey).toBe("custom");
    expect(result.colourWorld.source).toBe("derived");
    expect(result.colourWorld.paletteKey).toBe("custom");
    expect(result.colourWorld.environmentalColours).toContain(
      '"inside an old library after closing"',
    );
  });

  it("handles arbitrary free-text scenes with the complete v2 expansion", () => {
    const result = buildMascotImagePrompt(DNA, "at the gym deadlifting", PROJECT);

    expect(result.prompt).toContain("IDEA:");
    expect(result.prompt).toContain("ASSOCIATIONS");
    expect(result.prompt).toContain("STORY:");
    expect(result.prompt).toContain("MEME:");
    expect(result.prompt).toContain("COLOUR WORLD:");
    expect(result.prompt).toContain("EXAGGERATION:");
    expect(result.prompt).toContain("DETAILS:");
  });

  it("always states the mascot is the sole character", () => {
    const result = buildMascotImagePrompt(DNA, "casino", PROJECT);
    expect(result.prompt).toContain("sole character");
    expect(result.prompt).toContain("no sidekicks, no crowd");
  });

  it("normalises a ticker that already includes a leading $", () => {
    const result = buildMascotImagePrompt(DNA, "beach", {
      name: "Wolfpack",
      ticker: "$WOLF",
    });
    expect(result.prompt).toContain("$WOLF");
    expect(result.prompt).not.toContain("$$WOLF");
  });
});
