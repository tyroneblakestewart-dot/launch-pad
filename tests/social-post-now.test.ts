import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  NO_CONTRACT_ADDRESS_RULE,
  buildDraftRequestBody,
  checkDraftCompliance,
  checkDraftContractAddress,
  findAddressLikeStrings,
  type DraftProject,
} from "@/lib/server/social-draft-pipeline";

async function source(...parts: string[]): Promise<string> {
  return readFile(path.join(process.cwd(), ...parts), "utf8");
}

const EVM = "0x39207baa4d0a30a5194770563ec586978c9fbcb3";
const SOLANA = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

const PROJECT: DraftProject = {
  name: "Test Coin",
  ticker: "TEST",
  description: "A community-driven meme token.",
  chain: "robinhood",
  contractAddress: EVM,
};

/**
 * Owner direction, 7 Sep 2026: "can we avoid adding contract to post, let
 * users take care of that side — if they want, they can add it from the
 * announcement". The model never sees the project's address, is told never
 * to write one, and a stray address is rejected mechanically.
 */
describe("No contract address in AI posts", () => {
  it("never shows the project's contract address to the model", () => {
    const body = buildDraftRequestBody({ project: PROJECT, voiceProfile: null, angleIndex: 0 }, "gpt-5-mini");
    const developerText = body.input[0]?.content[0]?.text ?? "";
    const userText = body.input[1]?.content[0]?.text ?? "";
    expect(developerText).not.toContain(EVM);
    expect(userText).not.toContain(EVM);
    expect(userText).not.toContain("Contract:");
    expect(userText).not.toContain("Contract not yet live.");
    expect(developerText).not.toContain("contract address (only when it is given below)");
  });

  it("states the rule in the prompt, in announcement mode too", () => {
    for (const input of [
      { project: PROJECT, voiceProfile: null, angleIndex: 0 },
      { project: PROJECT, voiceProfile: null, angleIndex: 0, announcement: "Pool live Friday." },
    ]) {
      const developerText = buildDraftRequestBody(input, "gpt-5-mini").input[0]?.content[0]?.text ?? "";
      expect(developerText).toContain(NO_CONTRACT_ADDRESS_RULE);
    }
    expect(NO_CONTRACT_ADDRESS_RULE).toContain("the user adds it themselves");
    expect(NO_CONTRACT_ADDRESS_RULE).toContain("an address that the user's own announcement below already contains");
  });

  it("finds address-shaped strings, and nothing else", () => {
    expect(findAddressLikeStrings(`buy at ${EVM} now`)).toEqual([EVM]);
    expect(findAddressLikeStrings(`mint ${SOLANA}`)).toEqual([SOLANA]);
    expect(findAddressLikeStrings("0xdead")).toEqual([]);
    expect(findAddressLikeStrings("The community is holding strong today and nothing here is an address.")).toEqual([]);
    expect(findAddressLikeStrings("")).toEqual([]);
  });

  it("rejects an address the user never wrote, on either channel", () => {
    const inX = checkDraftContractAddress({ xText: `TEST is live: ${EVM}`, telegramText: "TEST is live." });
    expect(inX.violated).toBe(true);
    expect(inX.feedback).toContain("X post included an address");
    expect(inX.feedback).toContain(EVM);
    const inTelegram = checkDraftContractAddress({ xText: "TEST is live.", telegramText: `Mint ${SOLANA}` });
    expect(inTelegram.violated).toBe(true);
    expect(inTelegram.feedback).toContain("Telegram post included an address");
    expect(checkDraftContractAddress({ xText: "TEST is live.", telegramText: "TEST is live." }).violated).toBe(false);
  });

  it("keeps an address the user's own announcement carries", () => {
    const draft = { xText: `Pool live Friday. ${EVM}`, telegramText: `Pool live Friday.\n${EVM}` };
    expect(checkDraftContractAddress(draft, `Pool live Friday at ${EVM}`).violated).toBe(false);
    // Case is not a way around the rule, in either direction.
    expect(checkDraftContractAddress({ xText: EVM.toUpperCase().replace("0X", "0x"), telegramText: "" }, `here: ${EVM}`).violated).toBe(false);
    // A different address than the one announced is still a violation.
    expect(checkDraftContractAddress(draft, "Pool live Friday at 0x0000000000000000000000000000000000000001").violated).toBe(true);
  });

  it("runs the check inside the shared compliance chain", () => {
    const base = { project: PROJECT, angleIndex: 0 };
    const stray = checkDraftCompliance({ xText: `Live now ${EVM}`, telegramText: "Live now." }, base);
    expect(stray.violated).toBe(true);
    expect(stray.feedback).toContain("Never include a contract, token or wallet address");
    const announced = checkDraftCompliance(
      { xText: `Pool live Friday. ${EVM}`, telegramText: `Pool live Friday. ${EVM}` },
      { ...base, announcement: `Pool live Friday at ${EVM}` },
    );
    expect(announced.violated).toBe(false);
  });
});

/**
 * Owner direction, 7 Sep 2026: "remove the Compose now section from the
 * Setup tab — we've got the same on the calendar schedule — just add a
 * Post now tab."
 */
describe("Compose now removed from Setup", () => {
  it("leaves no composer, template picker or draft store on the Setup tab", async () => {
    const hub = await source("components", "social-hub.tsx");
    expect(hub).not.toContain("<h2>Compose now</h2>");
    expect(hub).not.toContain("DRAFT_STORAGE_KEY");
    expect(hub).not.toContain("function saveDraft()");
    expect(hub).not.toContain("function chooseTemplate(");
    expect(hub).not.toContain("async function publishBoth()");
    expect(hub).not.toContain("async function postTelegram()");
    expect(hub).not.toContain("generateDraftFromSetup");
    expect(hub).not.toContain("APPROVE BOTH DESTINATIONS");
  });

  it("keeps the legacy template texts only to badge drafts saved before the removal", async () => {
    const hub = await source("components", "social-hub.tsx");
    expect(hub).toContain("const templateOutputs = useMemo(");
    expect(hub).toContain("const isTemplateItem = xIsTemplate || telegramIsTemplate;");
  });
});

describe("Post now on the announcement card", () => {
  it("offers a third tab that starts from what is already written", async () => {
    const hub = await source("components", "social-hub.tsx");
    expect(hub).toContain('const [announcementMode, setAnnouncementMode] = useState<"own" | "ai" | "now">("own");');
    expect(hub).toContain("function openPostNow() {");
    expect(hub).toContain('setAnnouncementMode("now");');
    expect(hub).toContain("if (!postNowX.trim() && !postNowTelegram.trim()) {");
    expect(hub).toContain("setPostNowX(announcementAi?.xText ?? announcementText);");
    expect(hub).toContain("setPostNowTelegram(announcementAi?.telegramText ?? announcementText);");
    expect(hub).toContain('aria-selected={announcementMode === "now"}');
    expect(hub).toContain("onClick={openPostNow}");
    expect(hub).toContain("Post now");
  });

  it("sends X through the free intent composer and Telegram through the bot", async () => {
    const hub = await source("components", "social-hub.tsx");
    expect(hub).toContain("function postNowToX() {");
    expect(hub).toContain("window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}`, \"_blank\", \"noopener,noreferrer\");");
    expect(hub).toContain("async function postNowToTelegram() {");
    expect(hub).toContain('if (!telegramConnection || telegramConnection.status !== "connected" || !text) {');
    expect(hub).toContain('const response = await fetch("/api/social/telegram", {');
    expect(hub).toContain("chatId: telegramConnection.externalId,");
    expect(hub).toContain('artwork: includeArtwork ? projectArtwork : "",');
    expect(hub).toContain('<span>Attach the token artwork to Telegram</span>');
    expect(hub).toContain('{busy ? "Sending…" : "Send to Telegram now"}');
    expect(hub).toContain("<button type=\"button\" onClick={postNowToX}>Post to X now</button>");
  });

  it("refuses an X post over the limit before opening anything", async () => {
    const hub = await source("components", "social-hub.tsx");
    expect(hub).toContain("if (text.length > X_CHARACTER_LIMIT) {");
    expect(hub).toContain("X · {postNowX.trim().length}/{X_CHARACTER_LIMIT}");
  });

  it("asks for token details before publishing, like every other tool", async () => {
    const hub = await source("components", "social-hub.tsx");
    const start = hub.indexOf("async function postNowToTelegram() {");
    const block = hub.slice(start, start + 400);
    expect(block).toContain('promptForTokenDetails("Add your token details before publishing.");');
  });
});
