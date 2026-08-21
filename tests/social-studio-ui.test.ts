import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function source(...parts: string[]): Promise<string> {
  return readFile(path.join(ROOT, ...parts), "utf8");
}

describe("Hoodlums AI Social Studio", () => {
  it("uses the approved Social wordmark, subtitle and four-tab product structure", async () => {
    const social = await source("components", "social-hub.tsx");
    const page = await source("app", "(app)", "social", "page.tsx");

    expect(social).toContain('src="/hoodlums-social-wordmark.png"');
    expect(social).toContain("Prepare once. Review every destination. Publish without sharing passwords.");
    expect(social).toContain('desktop: "Setup"');
    expect(social).toContain('desktop: "Calendar & Schedule"');
    expect(social).toContain('desktop: "Queue & History"');
    expect(social).toContain('desktop: "Settings & Rules"');
    expect(page).toContain('title: "AI Social Studio"');
    expect(social).not.toContain("Project Social Hub");
  });

  it("preserves the existing project, composer, X and Telegram publishing paths", async () => {
    const social = await source("components", "social-hub.tsx");

    expect(social).toContain("PROJECT_STORAGE_KEY");
    expect(social).toContain("DRAFT_STORAGE_KEY");
    expect(social).toContain("buildTemplate");
    expect(social).toContain("selectProject");
    expect(social).toContain("saveDraft");
    expect(social).toContain("copyPost");
    expect(social).toContain("downloadArtwork");
    expect(social).toContain("openXComposer");
    expect(social).toContain("https://x.com/intent/post?text=");
    expect(social).toContain("postTelegram");
    expect(social).toContain('fetch("/api/social/telegram"');
    expect(social).toContain("publishBoth");
    expect(social).toContain("Approve &amp; open X composer");
    expect(social).toContain("Approve & post to Telegram");
    expect(social).toContain("APPROVE BOTH DESTINATIONS");
  });

  it("removes the raw bot-token field while retaining server-side Telegram posting", async () => {
    const social = await source("components", "social-hub.tsx");
    const route = await source("app", "api", "social", "telegram", "route.ts");

    expect(social).not.toContain("telegramBotToken");
    expect(social).not.toContain("Paste the BotFather token");
    expect(social).not.toContain("botToken:");
    expect(route).toContain("process.env.TELEGRAM_BOT_TOKEN");
    expect(route).toContain("requestedBotToken || configuredBotToken");
    expect(route).toContain("publishTelegramPost");
  });

  it("activates the AI Social Studio tabs (issue #332): voice, drafting, mascot images, calendar AI and the queue", async () => {
    const social = await source("components", "social-hub.tsx");

    expect(social).toContain("Teach the AI your voice");
    expect(social).toContain('fetch("/api/social/voice-profile"');
    expect(social).toContain("buildVoiceProfile");
    expect(social).not.toContain('<textarea disabled placeholder="Paste a post here');

    expect(social).toContain('fetch("/api/social/draft"');
    expect(social).toContain("generateDraftFromSetup");
    expect(social).toContain("generateDraftForDay");

    expect(social).toContain("Your mascot");
    expect(social).toContain('fetch("/api/social/mascot/visual-dna"');
    expect(social).toContain('fetch("/api/social/mascot/image"');
    expect(social).toContain("toggleMascotAction");
    expect(social).toContain("toggleMascotPlace");
    expect(social).not.toContain("{MASCOT_ACTIONS.map((label) => <button type=\"button\" disabled key={label}>{label}</button>)}");

    expect(social).toContain("MONTH_NAMES[calendarView.month]");
    expect(social).toContain('onClick={generateDraftForDay} disabled={calendarAiBusy}');

    expect(social).toContain("What&apos;s going out");
    expect(social).toContain("postQueueItemToX");
    expect(social).toContain("sendQueueItemToTelegram");
    expect(social).toContain("removeQueueItem");
    expect(social).not.toContain("No queue is being simulated.");

    // Rules tab and the still out-of-scope calendar/bot controls stay coming soon.
    expect(social).toContain("Words to avoid");
    expect(social).toContain("Coming soon");
    expect(social).toContain('disabled className={styles.ownPostButton}');
    expect(social).toContain("Add to your channel");
  });

  it("supports real month navigation, today highlighting and year-boundary rollover in the calendar", async () => {
    const social = await source("components", "social-hub.tsx");

    expect(social).toContain("function shiftedMonth(view: MonthView, delta: number): MonthView");
    expect(social).toContain("if (next < 0) return { year: view.year - 1, month: 11 };");
    expect(social).toContain("if (next > 11) return { year: view.year + 1, month: 0 };");
    expect(social).toContain("function buildMonthGrid(year: number, month: number)");
    expect(social).toContain("function jumpToToday()");
    expect(social).toContain("Jump to today");
    expect(social).toContain('aria-label="Previous month"');
    expect(social).toContain('aria-label="Next month"');
    expect(social).toContain("isToday && styles.calendarToday");
    expect(social).toContain("isSelected ? styles.weekSelected : isToday ? styles.weekToday : styles.weekDay");
    expect(social).toContain("TIMEZONES.map((timezone)");
  });

  it("fits under the existing 72px mobile header and above the fixed bottom nav", async () => {
    const socialCss = await source("components", "social-hub.module.css");
    const navCss = await source("components", "app-navigation.module.css");

    expect(navCss).toContain("min-height:72px");
    expect(navCss).toContain("background:rgba(4,8,5,.96)");
    expect(navCss).toContain("backdrop-filter:blur(14px)");
    expect(navCss).toContain("bottom:calc(16px + env(safe-area-inset-bottom))");
    expect(navCss).toContain("height:62px");
    expect(navCss).toContain("backdrop-filter:blur(20px) saturate(145%)");
    expect(navCss).toContain("padding-bottom:calc(96px + env(safe-area-inset-bottom))");
    expect(socialCss).toContain("position: sticky");
    expect(socialCss).toContain("top: 72px");
    expect(socialCss).toContain("z-index: 80");
  });

  it("keeps the open project menu above the sticky tab bar (issue #390)", async () => {
    const socialCss = await source("components", "social-hub.module.css");

    const projectMenuBlock = socialCss.match(/\.projectMenu\s*\{[^}]*\}/);
    const tabBarStickyBlock = socialCss.match(/\.tabBar\s*\{\s*position:\s*sticky[^}]*\}/);
    expect(projectMenuBlock).not.toBeNull();
    expect(tabBarStickyBlock).not.toBeNull();

    const projectMenuZ = Number(projectMenuBlock![0].match(/z-index:\s*(\d+)/)?.[1]);
    const tabBarZ = Number(tabBarStickyBlock![0].match(/z-index:\s*(\d+)/)?.[1]);
    expect(Number.isNaN(projectMenuZ)).toBe(false);
    expect(Number.isNaN(tabBarZ)).toBe(false);

    // The dropdown must paint over the sticky tab bar (and the live-tools /
    // status pills inside it), never the other way around.
    expect(projectMenuZ).toBeGreaterThan(tabBarZ);
    expect(tabBarZ).toBe(80);

    // No ancestor of the dropdown creates its own positioning/stacking
    // context (position: relative is fine and expected; transform/filter/
    // isolation on .projectPicker or .heroActions would cap the menu's
    // z-index below the tab bar regardless of the value above).
    const projectPickerBlock = socialCss.match(/\.projectPicker\s*\{[^}]*\}/)![0];
    const heroActionsBlock = socialCss.match(/\.heroActions\s*\{[^}]*\}/)![0];
    for (const block of [projectPickerBlock, heroActionsBlock]) {
      expect(block).not.toMatch(/transform:|filter:|isolation:|will-change:/);
    }
  });

  it("surfaces each AI handler's own status inline next to its control instead of only the far-below statusBar (issue #340)", async () => {
    const social = await source("components", "social-hub.tsx");

    // A dedicated status per panel, distinct from the shared bottom statusBar.
    expect(social).toContain("function InlineStatus({ status }: { status: PanelStatus })");
    expect(social).toContain('role="status" aria-live="polite"');
    expect(social).toContain("styles.inlineStatusError");
    expect(social).toContain("styles.inlineStatusProgress");
    expect(social).toContain("const [voiceStatus, setVoiceStatus] = useState<PanelStatus>(null);");
    expect(social).toContain("const [mascotUploadStatus, setMascotUploadStatus] = useState<PanelStatus>(null);");
    expect(social).toContain("const [mascotSceneStatus, setMascotSceneStatus] = useState<PanelStatus>(null);");
    expect(social).toContain("const [setupDraftStatus, setSetupDraftStatus] = useState<PanelStatus>(null);");
    expect(social).toContain("const [calendarDraftStatus, setCalendarDraftStatus] = useState<PanelStatus>(null);");

    // Each AI handler reports to its own panel status, not the shared one.
    expect(social).toContain('setVoiceStatus({ tone: "error", message: error instanceof Error ? error.message : "The voice profile could not be built." });');
    expect(social).toContain(
      'setMascotUploadStatus({ tone: "error", message: error instanceof Error ? error.message : "The mascot artwork could not be analysed." });',
    );
    expect(social).toContain(
      'setMascotSceneStatus({ tone: "error", message: error instanceof Error ? error.message : "The mascot scene image could not be generated." });',
    );
    expect(social).toContain('report({ tone: "error", message: error instanceof Error ? error.message : "The draft could not be generated." });');
    expect(social).toContain("await generateDraft({}, setSetupDraftStatus);");
    expect(social).toContain("await generateDraft({ dayLabel: selectedDayLabel }, setCalendarDraftStatus);");

    // Each status renders next to the control that triggered it, not only inside the statusBar.
    expect(social).toContain("<InlineStatus status={voiceStatus} />");
    expect(social).toContain("<InlineStatus status={mascotUploadStatus} />");
    expect(social).toContain("<InlineStatus status={mascotSceneStatus} />");
    expect(social).toContain("<InlineStatus status={setupDraftStatus} />");
    expect(social).toContain("<InlineStatus status={calendarDraftStatus} />");

    // Placement checks: each status must sit right after (not far below) its trigger.
    const learnVoiceButtonIndex = social.indexOf("Learn my voice");
    const voiceInlineStatusIndex = social.indexOf("<InlineStatus status={voiceStatus} />");
    expect(voiceInlineStatusIndex).toBeGreaterThan(learnVoiceButtonIndex);
    expect(voiceInlineStatusIndex - learnVoiceButtonIndex).toBeLessThan(600);

    const generateMascotButtonIndex = social.indexOf("Generate mascot image");
    const mascotSceneInlineStatusIndex = social.indexOf("<InlineStatus status={mascotSceneStatus} />");
    expect(mascotSceneInlineStatusIndex).toBeGreaterThan(generateMascotButtonIndex);
    expect(mascotSceneInlineStatusIndex - generateMascotButtonIndex).toBeLessThan(1200);
  });

  it("shows an honest, diagnosable Telegram configuration state and reconciles Setup with the real wallet-signed connect flow (issue #340)", async () => {
    const social = await source("components", "social-hub.tsx");
    const statusRoute = await source("app", "api", "social", "telegram", "status", "route.ts");

    // The old bare, unverified chat-ID field and its misleading copy are gone.
    expect(social).not.toContain("no BotFather token is entered in the Studio");
    expect(social).not.toContain("Channel saved");

    // Setup proactively checks whether the server bot is configured at all.
    expect(social).toContain('fetch("/api/social/telegram/status"');
    expect(social).toContain("const [telegramConfigured, setTelegramConfigured] = useState<boolean | null>(null);");
    expect(social).toContain('"Not configured"');
    expect(social).toContain("TELEGRAM_BOT_TOKEN");
    expect(statusRoute).toContain("isTelegramConnectConfigured()");

    // Setup reconciles with the real wallet-signed connect/disconnect flow (not a bare text field feeding /api/social/telegram directly).
    expect(social).toContain("async function connectTelegramChannel()");
    expect(social).toContain("async function disconnectTelegramChannel()");
    expect(social).toContain('purpose: "social:telegram-connect"');
    expect(social).toContain('purpose: "social:telegram-disconnect"');
    expect(social).toContain('fetch("/api/social/telegram/connect"');
    expect(social).toContain('fetch("/api/social/telegram/disconnect"');
    expect(social).toContain("walletClient.signMessage({ account, message: challenge.message })");

    // Sending now requires a verified connection, not a freely typed chat ID.
    expect(social).toContain('telegramConnection.status !== "connected"');
    expect(social).toContain("chatId: telegramConnection.externalId");
  });

  it("adds a 'sounds like me' / 'not me' feedback control to each Voice preview sample line, feeding likes back into generation (issue #348)", async () => {
    const social = await source("components", "social-hub.tsx");

    // State + persistence, loaded and reset alongside the rest of the per-project record.
    expect(social).toContain("const [sampleLineFeedback, setSampleLineFeedback] = useState<SampleLineFeedback[]>([]);");
    expect(social).toContain("setSampleLineFeedback(record.sampleLineFeedback);");
    expect(social).toContain("setSampleLineFeedback([]);");
    expect(social).toContain("sampleLineFeedback,\n      ...overrides,");

    // Toggle handler: never a publish action, explicit accessible labelling that disambiguates from posting.
    expect(social).toContain("function toggleSampleLineLike(text: string, sentiment: SampleLineFeedback[\"sentiment\"])");
    expect(social).toContain("persistSocialStudio({ sampleLineFeedback: next });");
    expect(social).toContain("sounds like me, not a request to post it");
    expect(social).toContain("aria-pressed={liked}");
    expect(social).toContain("aria-pressed={disliked}");
    expect(social).toContain('onClick={() => toggleSampleLineLike(line, "liked")}');
    expect(social).toContain('onClick={() => toggleSampleLineLike(line, "disliked")}');

    // Liked lines are sent back to both generation endpoints as reinforcement, capped/ordered by the shared helper.
    expect(social).toContain("import { likedReinforcementLines, toggleSampleLineFeedback } from \"@/lib/social-voice-feedback\";");
    expect(social).toContain("likedSampleLines: likedReinforcementLines(sampleLineFeedback),");

    // Re-running "Learn my voice" does not clear existing likes, and the preview makes their continued effect obvious.
    expect(social).not.toContain("setSampleLineFeedback(null)");
    expect(social).toContain("still reinforce new drafts and voice");
  });

  it("compacts Ready-to-review draft cards behind a collapsed X preview, still exposing edit/approve/delete (issue #358)", async () => {
    const social = await source("components", "social-hub.tsx");

    // Collapsed by default: a single clamped X preview with its character count, not both full bodies.
    expect(social).toContain("const [expandedQueueItemIds, setExpandedQueueItemIds] = useState<Record<string, boolean>>({});");
    expect(social).toContain("function toggleQueueItemExpanded(id: string)");
    expect(social).toContain("const isExpanded = Boolean(expandedQueueItemIds[item.id]);");
    expect(social).toContain("className={styles.queuePreview}");
    expect(social).toContain("className={styles.queuePreviewText}");
    // issue #380: the collapsed preview now carries a Telegram length/sameness
    // indicator instead of "Telegram hidden" — a compact hint, not a full
    // preview, since the mandatory confirm-before-sign step (below) is what
    // actually guarantees the full text is seen before every approval.
    expect(social).toContain("X {item.xText.length}/280 · Telegram {item.telegramText.length} chars");
    expect(social).toContain("tap to edit both");

    // Expanding still reveals the same editable X/Telegram fields, wired to the same update handler.
    expect(social).toContain('onChange={(event) => updateQueueItem(item.id, { xText: event.target.value })}');
    expect(social).toContain('onChange={(event) => updateQueueItem(item.id, { telegramText: event.target.value })}');

    // The compact schedule control replaces the old full-width labeled row.
    expect(social).toContain("className={styles.scheduleCompact}");
    expect(social).toContain("className={styles.scheduleCompactInput}");

    // Delete is untouched (issue #356's action row).
    // Approve now goes through handleApproveClick's two-tap confirm step (issue #380).
    // Post to X/Send to Telegram are also two-tap now, through handleQuickSendClick (issue #382).
    expect(social).toContain("onClick={() => handleApproveClick(item)}");
    expect(social).toContain('onClick={() => handleQuickSendClick(item, "x")}');
    expect(social).toContain('onClick={() => handleQuickSendClick(item, "telegram")}');
    expect(social).toContain("onClick={() => removeQueueItem(item.id)}");
  });

  it("adds an optional Direction brief that steers drafts without being quoted verbatim (issue #358)", async () => {
    const social = await source("components", "social-hub.tsx");

    expect(social).toContain('const [directionBrief, setDirectionBrief] = useState("");');
    expect(social).toContain("setDirectionBrief(record.directionBrief);");
    expect(social).toContain('setDirectionBrief("");');
    expect(social).toContain("Direction brief");
    expect(social).toContain("OPTIONAL");
    expect(social).toContain("Tell the AI your focus this week. Applies to both X and Telegram.");
    expect(social).toContain("directionBrief: directionBrief.trim() || null,");
    expect(social).toContain("directionBrief,\n      sampleLineFeedback,");
  });

  it("adds a single-select posting cadence hard-capped at the plan's 5 posts/day entitlement (issue #358)", async () => {
    const social = await source("components", "social-hub.tsx");

    expect(social).toContain("Posting cadence");
    expect(social).toContain("import {\n  DEFAULT_POSTING_CADENCE,\n  DEFAULT_QUEUE_TARGET,\n  EMPTY_SOCIAL_STUDIO_RECORD,\n  MAX_POSTS_PER_DAY,\n  POSTING_CADENCE_OPTIONS,\n} from \"@/lib/social-studio-types\";");
    expect(social).toContain("function updatePostingCadence(cadence: PostingCadence)");
    expect(social).toContain("const nextTarget = cadenceQueueTarget(cadence);");
    expect(social).toContain("persistSocialStudio({ postingCadence: cadence, queueTarget: nextTarget });");
    expect(social).toContain("{POSTING_CADENCE_OPTIONS.map((option) => (");
    expect(social).toContain("aria-pressed={postingCadence === option.id}");

    // Both cadence tiers, and no offer of anything beyond the 5/day ceiling.
    expect(social).toContain("MAX_POSTS_PER_DAY");
    const types = await source("lib", "social-studio-types.ts");
    expect(types).toContain('{ id: "conservative", label: "Conservative", description: "1–2 posts per day", postsPerDayMax: 2 },');
    expect(types).toContain('{ id: "active", label: "Active", description: "3–5 posts per day", postsPerDayMax: 5 },');
    expect(types).toContain("export const MAX_POSTS_PER_DAY = 5;");
  });

  it("filters page furniture out of pasted voice examples before counting or teaching the AI (issue #340)", async () => {
    const social = await source("components", "social-hub.tsx");

    expect(social).toContain('import { MIN_USABLE_VOICE_EXAMPLES, filterUsableVoiceExamples } from "@/lib/social-voice-examples";');
    expect(social).toContain(
      "const voiceExampleFilter = useMemo(() => filterUsableVoiceExamples(voiceExamplesText), [voiceExamplesText]);",
    );
    expect(social).toContain("const { usable: examples, pastedLineCount, rejectedCount } = voiceExampleFilter;");
    expect(social).toContain("examples.length < MIN_USABLE_VOICE_EXAMPLES");
    expect(social).toContain("usable / ${voiceExampleFilter.pastedLineCount} pasted");
    expect(social).toContain("skipped as short, page furniture, or duplicates");
  });

  it("guards every wallet-signed action against signing with a different account than the one confirmed on Hoodlums (issue #388)", async () => {
    const social = await source("components", "social-hub.tsx");
    const queueLib = await source("lib", "social-studio-queue.ts");

    // The mismatch check is a pure, dependency-free helper (unit-tested directly), imported into the component rather than reimplemented inline.
    expect(queueLib).toContain("export function describeWalletMismatch(activeAccount: string, confirmedAddress: string): string | null {");
    expect(social).toContain("describeWalletMismatch,");
    expect(social).toContain('from "@/lib/social-studio-queue";');

    // Every getAddresses() call site checks the mismatch before proceeding to a challenge/sign, never after.
    const sites = [
      "if (!account) throw new Error(\"Connect an EVM wallet before linking Telegram.\");",
      "if (!account) throw new Error(\"Connect an EVM wallet before disconnecting Telegram.\");",
      "if (!account) throw new Error(\"Connect an EVM wallet first.\");",
    ];
    for (const guardLine of sites) {
      const guardIndex = social.indexOf(guardLine);
      expect(guardIndex).toBeGreaterThan(-1);
      const nextLines = social.slice(guardIndex, guardIndex + 400);
      expect(nextLines).toContain("const mismatch = describeWalletMismatch(account, walletAddress);");
      expect(nextLines).toContain("if (mismatch) throw new Error(mismatch);");
      // The guard must run before any challenge is requested or signature collected.
      const challengeIndex = nextLines.indexOf('fetch("/api/social/challenge"');
      const mismatchIndex = nextLines.indexOf("if (mismatch) throw new Error(mismatch);");
      expect(mismatchIndex).toBeLessThan(challengeIndex === -1 ? Infinity : challengeIndex);
    }

    // Exactly three call sites are guarded — Telegram connect, Telegram disconnect, and the shared approve/cancel/reschedule challenge helper.
    expect(social.split("const mismatch = describeWalletMismatch(account, walletAddress);").length - 1).toBe(3);
  });

  it("refreshes walletAddress from localStorage on window focus so re-confirming in another tab propagates (issue #388)", async () => {
    const social = await source("components", "social-hub.tsx");

    expect(social).toContain("function refreshWalletAddress() {");
    expect(social).toContain('window.addEventListener("focus", refreshWalletAddress);');
    expect(social).toContain('document.addEventListener("visibilitychange", refreshWalletAddress);');
    expect(social).toContain("const next = storedWalletAddress();");
    expect(social).toContain("return next === current ? current : next;");

    // The refresh effect sits right after the mount effect that first reads walletAddress, not buried elsewhere.
    const mountReadIndex = social.indexOf("setWalletAddress(storedWalletAddress());");
    const refreshEffectIndex = social.indexOf("function refreshWalletAddress() {");
    expect(refreshEffectIndex).toBeGreaterThan(mountReadIndex);
    expect(refreshEffectIndex - mountReadIndex).toBeLessThan(800);
  });
});
