import { describe, expect, it, vi } from "vitest";
import {
  CONTENT_FILTER_CATEGORY_COUNT,
  CONTENT_FILTER_TERM_COUNT,
  contentFilterRejectionMessage,
  findBlockedField,
  runContentFilterFailClosed,
  runContentFilterFailOpen,
  scanForBlockedContent,
} from "@/lib/server/content-filter";

describe("content filter module basics", () => {
  it("reports a positive term-list size and category count", () => {
    expect(CONTENT_FILTER_TERM_COUNT).toBeGreaterThan(20);
    expect(CONTENT_FILTER_CATEGORY_COUNT).toBe(2);
  });

  it("never echoes the matched term back in the rejection message", () => {
    const message = contentFilterRejectionMessage("description");
    expect(message).toContain("description");
    expect(message.toLowerCase()).not.toContain("nigger");
  });
});

describe("scanForBlockedContent — ethnic/religious slurs", () => {
  const slurs = ["nigger", "nigga", "chink", "gook", "spic", "kike", "coon", "wetback", "beaner", "paki", "raghead", "kaffir"];

  it.each(slurs)("blocks the slur %s", (slur) => {
    expect(scanForBlockedContent(`this token is a ${slur} coin`)).toEqual({ category: "hateful-slur" });
  });

  it("blocks a multi-word hateful phrase", () => {
    expect(scanForBlockedContent("just a porch monkey meme")).toEqual({ category: "hateful-slur" });
  });
});

describe("scanForBlockedContent — sexualisation of minors", () => {
  const phrases = ["child porn", "childporn", "kiddie porn", "loli porn", "lolicon", "jailbait", "naked child", "sexy minor"];

  it.each(phrases)("blocks the phrase %s", (phrase) => {
    expect(scanForBlockedContent(`content about ${phrase} here`)).toEqual({ category: "csam" });
  });
});

describe("scanForBlockedContent — word-boundary false positives", () => {
  const legitimate = [
    "conspicuous launch strategy",
    "suspicion is high about this pump",
    "auspicious debut for the token",
    "classic degenerate ape meme",
    "scunthorpe problem is a famous filtering example",
    "assassin coin",
    "cockpit dashboard mockup",
    "this is a bass fishing themed token",
  ];

  it.each(legitimate)("passes %s", (text) => {
    expect(scanForBlockedContent(text)).toBeNull();
  });
});

describe("scanForBlockedContent — evasion handling for high-severity terms", () => {
  const evasive = ["n1gg3r", "n.i.g.g.e.r", "n i g g e r", "ch1nk", "k1ke", "j@p", "s4ndn1gger"];

  it.each(evasive)("blocks the evasive spelling %s", (spelling) => {
    expect(scanForBlockedContent(`this ${spelling} token`)).not.toBeNull();
  });
});

describe("explicit allowed content — narrow scope lock-in", () => {
  const allowed = [
    "fuck this bear market, we're going to the moon",
    "shit coin but we love it, degenerate ape energy",
    "this token is for adults only, nsfw meme content",
    "we're all gonna die anyway, YOLO into this rug",
    "smoke weed and buy the dip, 420 blaze it",
    "casino degenerate gambling coin, all in on red",
    "this is a violent zombie apocalypse themed token",
    "damn, hell of a pump today",
  ];

  it.each(allowed)("passes crude/edgy-but-legal content: %s", (text) => {
    expect(scanForBlockedContent(text)).toBeNull();
  });
});

describe("findBlockedField", () => {
  it("returns the first blocked field with its category, and ignores clean fields", () => {
    const result = findBlockedField({
      name: "Moon Coin",
      ticker: "MOON",
      description: "This is a nigger coin",
    });
    expect(result).toEqual({ field: "description", category: "hateful-slur" });
  });

  it("returns null when every field is clean", () => {
    const result = findBlockedField({
      name: "Moon Coin",
      ticker: "MOON",
      description: "To the moon, degenerates",
      html: null,
      slug: undefined,
    });
    expect(result).toBeNull();
  });
});

describe("runContentFilterFailClosed", () => {
  it("passes clean content", () => {
    expect(runContentFilterFailClosed({ name: "Moon Coin" })).toEqual({ blocked: false });
  });

  it("blocks matched content, naming the field", () => {
    expect(runContentFilterFailClosed({ name: "Moon Coin", description: "kike coin" })).toEqual({
      blocked: true,
      field: "description",
    });
  });

  it("fails closed (rejects) if the filter throws", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom: Record<string, string> = {};
    Object.defineProperty(boom, "name", {
      enumerable: true,
      get() {
        throw new Error("boom");
      },
    });
    const result = runContentFilterFailClosed(boom);
    expect(result).toEqual({ blocked: true, field: "content" });
    spy.mockRestore();
  });
});

describe("runContentFilterFailOpen", () => {
  it("passes clean content", () => {
    expect(runContentFilterFailOpen({ name: "Moon Coin" })).toEqual({ blocked: false });
  });

  it("blocks matched content, naming the field", () => {
    expect(runContentFilterFailOpen({ description: "chink coin" })).toEqual({
      blocked: true,
      field: "description",
    });
  });

  it("fails open (allows) and logs if the filter throws", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom: Record<string, string> = {};
    Object.defineProperty(boom, "name", {
      enumerable: true,
      get() {
        throw new Error("boom");
      },
    });
    const result = runContentFilterFailOpen(boom);
    expect(result).toEqual({ blocked: false });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
