import { describe, expect, it } from "vitest";
import {
  FIRST_TOUCH_TEMPLATES,
  FOLLOWUP_TEMPLATES,
  buildOutreachDraftBody,
  pickOutreachTemplate,
  type OutreachTemplateToken,
} from "@/lib/server/outreach-templates";

function token(overrides: Partial<OutreachTemplateToken> = {}): OutreachTemplateToken {
  return {
    name: "Doggo",
    ticker: "DOGGO",
    progressPercent: 91,
    creatorXHandle: null,
    ...overrides,
  };
}

describe("outreach template pool", () => {
  it("has at least 8 first-touch templates and at least 3 follow-up templates", () => {
    expect(FIRST_TOUCH_TEMPLATES.length).toBeGreaterThanOrEqual(8);
    expect(FOLLOWUP_TEMPLATES.length).toBeGreaterThanOrEqual(3);
  });

  it("gives every template (first-touch and follow-up) a unique key", () => {
    const keys = [...FIRST_TOUCH_TEMPLATES, ...FOLLOWUP_TEMPLATES].map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("makes every template — first-touch and follow-up — mention @hoodlumsdev", () => {
    for (const template of [...FIRST_TOUCH_TEMPLATES, ...FOLLOWUP_TEMPLATES]) {
      const body = buildOutreachDraftBody(template, token());
      expect(body).toContain("@hoodlumsdev");
    }
  });

  it("always includes the cashtag, congratulation-only, no sales language", () => {
    const salesWords = ["buy", "invest", "guaranteed", "moon", "pump it", "financial advice"];
    for (const template of [...FIRST_TOUCH_TEMPLATES, ...FOLLOWUP_TEMPLATES]) {
      const body = buildOutreachDraftBody(template, token());
      expect(body).toContain("$DOGGO");
      const lower = body.toLowerCase();
      for (const word of salesWords) {
        expect(lower).not.toContain(word);
      }
    }
  });

  it("mentions the creator's handle only when one is present in the token", () => {
    for (const template of [...FIRST_TOUCH_TEMPLATES, ...FOLLOWUP_TEMPLATES]) {
      const withHandle = buildOutreachDraftBody(template, token({ creatorXHandle: "doggocreator" }));
      expect(withHandle).toContain("@doggocreator");

      const withoutHandle = buildOutreachDraftBody(template, token({ creatorXHandle: null }));
      expect(withoutHandle).not.toContain("@doggocreator");
    }
  });
});

describe("pickOutreachTemplate", () => {
  it("never repeats the immediately-previous template, across many draws", () => {
    let previousKey: string | null = null;
    // A biased random that always wants index 0 — if the no-repeat guard
    // didn't work, this would pick the same template every time.
    const alwaysFirst = () => 0;
    for (let i = 0; i < 20; i += 1) {
      const picked = pickOutreachTemplate(FIRST_TOUCH_TEMPLATES, previousKey, alwaysFirst);
      if (previousKey !== null) expect(picked.key).not.toBe(previousKey);
      previousKey = picked.key;
    }
  });

  it("still returns a template when the pool has only one entry", () => {
    const solo = [FOLLOWUP_TEMPLATES[0]];
    const picked = pickOutreachTemplate(solo, solo[0].key, () => 0);
    expect(picked.key).toBe(solo[0].key);
  });

  it("respects the injected random function to select an index", () => {
    // With no previous key, all 8 candidates remain; random() = 0.99...
    // should land on the last one.
    const picked = pickOutreachTemplate(FIRST_TOUCH_TEMPLATES, null, () => 0.999999);
    expect(picked.key).toBe(FIRST_TOUCH_TEMPLATES[FIRST_TOUCH_TEMPLATES.length - 1].key);
  });
});
