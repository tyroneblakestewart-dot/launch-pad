import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { STREET_TEAM_OPTION, STREET_TEAM_TARGET_ID } from "@/lib/plans-section";

const ROOT = process.cwd();

async function source(file: string): Promise<string> {
  return readFile(path.join(ROOT, file), "utf8");
}

describe("Street Team plan copy", () => {
  it("matches the approved card copy exactly", () => {
    expect(STREET_TEAM_OPTION).toMatchObject({
      id: "street-team",
      name: "Street Team",
      price: "$25/month · add-on to Pro",
      badge: "COMING SOON",
      description:
        "Someone's talking about your token right now. Street Team answers — in your voice, while you sleep.",
      callout: "We show up for the people who show up for you. Never the timeline.",
      footNote: "Added at renewal — one payment, one date, no part-months.",
      bundleNote: "Pro Bundle? Street Team covers all three tokens at $60/month (not $25 × 3).",
      crossSellLabel: "Getting mentions? Street Team replies in your voice — coming soon →",
    });
    expect(STREET_TEAM_OPTION.bullets).toEqual([
      "10 replies a day — only to people already talking about your token",
      "Positive posts only — never argues, never feeds the FUD",
      "Never the same account twice — no one gets spammed",
      "Your voice and your mascot, same as your posts",
      "You choose: reply as they land, or spread through the day",
      "Approve each one, or let it run",
    ]);
    expect(STREET_TEAM_TARGET_ID).toBe("street-team");
  });
});

describe("Street Team card placement", () => {
  it("renders in the full plan details view, styled to match the other plan cards", async () => {
    const card = await source("components/street-team-card.tsx");
    const plans = await source("components/hoodlums-plans-section.tsx");

    expect(card).toContain("styles.planCard");
    expect(card).toContain("styles.badge");
    expect(card).toContain("styles.featureList");
    expect(card).toContain("styles.planFoot");
    expect(card).toContain("styles.planCta");
    expect(card).toContain('id={STREET_TEAM_TARGET_ID}');

    expect(plans).toContain("<StreetTeamCard />");
    expect(plans).toContain("STREET_TEAM_TARGET_ID");
  });

  it("never appears in the five-card 'How do you want to launch?' chooser modal", async () => {
    const chooser = await source("components/token-path-chooser.tsx");
    expect(chooser).not.toContain("StreetTeam");
    expect(chooser).not.toContain("Street Team");
    expect(chooser).not.toContain("street-team");
  });

  it("adds a Street Team cross-sell line only to the Pro card", async () => {
    const plans = await source("components/hoodlums-plans-section.tsx");
    const crossSellIndex = plans.indexOf("STREET_TEAM_OPTION.crossSellLabel");
    expect(crossSellIndex).toBeGreaterThan(-1);
    expect(plans.slice(0, crossSellIndex)).toContain('option.id === "pro"');
  });
});

describe("Street Team interest button", () => {
  it("records interest and shows a confirmed persisted state", async () => {
    const card = await source("components/street-team-card.tsx");
    expect(card).toContain('fetch("/api/street-team/interest"');
    expect(card).toContain('method: "POST"');
    expect(card).toContain("/api/street-team/interest?wallet=");
    expect(card).toContain("Tell us you want this");
    expect(card).toContain("You're on the list");
    expect(card).toContain("registered");
  });
});
