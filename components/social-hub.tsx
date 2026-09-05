"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { createWalletClient, custom } from "viem";
import {
  ACCOUNT_WALLET_STORAGE_KEY,
  parseStoredAccountWallet,
} from "@/lib/account-wallet-state";
import { TelegramMark, XMark } from "@/components/brand-icons";
import {
  BUY_BOT_THRESHOLD_PRESETS,
  DEFAULT_BUY_BOT_THRESHOLD_WEI,
  buyBotThresholdWeiForLabel,
  formatBuyBotThreshold,
  type BuyBotSummary,
} from "@/lib/buy-bot-presets";
import { ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL } from "@/lib/chains";
import { MASCOT_REFERENCE_TIPS, assessMascotReference, type MascotReferenceAssessment } from "@/lib/mascot-reference-guidance";
import { MIN_USABLE_VOICE_EXAMPLES, filterUsableVoiceExamples } from "@/lib/social-voice-examples";
import {
  VOICE_EXAMPLE_TARGET,
  addVoiceExamples,
  describeAddVoiceExamplesResult,
  voiceTrainingHint,
} from "@/lib/social-voice-examples";
import { getSocialStudioRecord, putSocialStudioRecord } from "@/lib/social-studio-db";
import {
  advanceRollingRecentDrafts,
  buildXIntentUrl,
  cadenceQueueTarget,
  countPostsScheduledToday,
  describePlanBadge,
  cadenceSpreadHoursMs,
  computeDefaultScheduledAt,
  connectedPlatforms,
  describeWalletMismatch,
  isAwaitingSend,
  isHistoryStatus,
  isPendingSendStatus,
  isUneditedTemplateText,
  replenishShortfall,
} from "@/lib/social-studio-queue";
import type {
  MascotVisualDNA,
  PostingCadence,
  QueueItem,
  SampleLineFeedback,
  SocialPlatform,
  SocialStudioProjectRecord,
  VoiceProfile,
} from "@/lib/social-studio-types";
import {
  DEFAULT_POSTING_CADENCE,
  DEFAULT_QUEUE_TARGET,
  EMPTY_SOCIAL_STUDIO_RECORD,
  MAX_POSTS_PER_DAY,
  POSTING_CADENCE_OPTIONS,
} from "@/lib/social-studio-types";
import {
  PERSONA_BANK_SIZE,
  clearHalfOfPersonaBank,
  clearPersonaBank,
  isPersonaBankFull,
  keptSampleLines,
  likedReinforcementLines,
  toggleSampleLineFeedback,
} from "@/lib/social-voice-feedback";
import type { TokenProject } from "@/lib/types";
import { getInjectedEvmProvider } from "@/lib/wallet-provider";
import styles from "./social-hub.module.css";

const PROJECT_STORAGE_KEY = "private-meme-token-studio-projects-v1";
const DRAFT_STORAGE_KEY = "private-meme-token-studio-social-drafts-v1";
const MAX_MASCOT_IMAGE_BYTES = 3_000_000;

type TemplateId = "launch" | "countdown" | "contract" | "community" | "custom";
type StudioTab = "setup" | "calendar" | "queue" | "rules";
type DraftMap = Record<string, string>;

// Per-panel status shown inline next to the control that triggered it, instead of one status bar far below the fold.
type PanelStatus = { tone: "progress" | "success" | "error"; message: string } | null;

/** One card in the sorting station: a pasted post reshaped to this project, waiting for Fire / Sounds right / Bin. */
type StationSample = { id: string; text: string; sourceKey: string };
/** How many cards the station keeps on the table at once. */
const STATION_SIZE = 3;

type TelegramConnectionState = {
  status: "connected" | "reconnect_needed";
  displayName: string;
  externalId: string;
  reconnectReason: string | null;
};

/** Shape returned by GET /api/social/connections for one platform row. */
type SocialConnectionSummary = {
  platform: SocialPlatform;
  status: "connected" | "reconnect_needed";
  displayName: string;
  externalId: string;
  reconnectReason: string | null;
};

/** One destination's delivery state within GET /api/social/posts, mirrored from lib/server/social-scheduled-posts-store.ts's client-facing shape. */
type ScheduledPostDestinationSummary = {
  id: string;
  platform: SocialPlatform;
  status: "pending" | "sending" | "sent" | "failed" | "needs_composer";
  errorMessage: string | null;
  sentAt: string | null;
};

/** Shape returned by GET /api/social/project-slots (issue #407). */
type SlotUsageSummary = {
  plan: "pro" | "pro-bundle" | null;
  unlimited: boolean;
  limit: number | null;
  activeCount: number;
  slots: Array<{ projectId: string; displayName: string; registeredAt: string }>;
};

/** One row returned by GET /api/social/posts — issue #335's durable approve-first queue, read here for the "Approved & scheduled" and "History" Queue tab sections (issue #352). */
type ScheduledPostSummary = {
  id: string;
  body: string;
  artworkDataUrl: string | null;
  status: "scheduled" | "sent" | "partially_sent" | "needs_composer" | "failed" | "canceled";
  scheduledAt: string;
  canceledAt: string | null;
  destinations: ScheduledPostDestinationSummary[];
};

const SOCIAL_STUDIO_ACTION_PURPOSES = {
  postCreate: "social:post-create",
  postCancel: "social:post-cancel",
  postReschedule: "social:post-reschedule",
  projectSlotRelease: "social:project-slot-release",
  buyBotEnable: "social:buy-bot-enable",
  buyBotUpdate: "social:buy-bot-update",
  buyBotDisable: "social:buy-bot-disable",
} as const;

function platformLabel(platform: SocialPlatform): string {
  return platform === "x" ? "X" : "Telegram";
}

async function readJsonResponse<T>(response: Response, fallback: string): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as { error?: string } & Partial<T>;
  if (!response.ok) throw new Error(payload.error || fallback);
  return payload as T;
}

function newQueueItemId(): string {
  return `queue-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

/** Formats a Date for an <input type="datetime-local"> value, in the browser's local time zone. */
function toDateTimeLocalValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatScheduledAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function storedWalletAddress(): string {
  try {
    return parseStoredAccountWallet(localStorage.getItem(ACCOUNT_WALLET_STORAGE_KEY))?.account ?? "";
  } catch {
    return "";
  }
}

/** Reads an image's pixel size in the browser. Untested DOM driver (same split as lib/token-artwork-thumbnail.ts); resolves 0×0 rather than throwing so the upload never depends on it. */
function readImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => resolve({ width: 0, height: 0 });
    image.src = dataUrl;
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error ?? new Error("The file could not be read."));
    reader.readAsDataURL(file);
  });
}

const TEMPLATES: Array<{ id: TemplateId; label: string; description: string }> = [
  { id: "launch", label: "Launch announcement", description: "Introduce the token and its story." },
  { id: "countdown", label: "Launch countdown", description: "Build attention before the contract is live." },
  { id: "contract", label: "Contract is live", description: "Publish the verified contract address." },
  { id: "community", label: "Community call", description: "Bring followers into X and Telegram." },
  { id: "custom", label: "Custom post", description: "Start with a blank composer." },
];

const TABS: Array<{ id: StudioTab; desktop: string; mobile: string }> = [
  { id: "setup", desktop: "Setup", mobile: "Setup" },
  { id: "calendar", desktop: "Calendar & Schedule", mobile: "Calendar" },
  { id: "queue", desktop: "Queue & History", mobile: "Queue" },
  { id: "rules", desktop: "Settings & Rules", mobile: "Rules" },
];

const BOTS = [
  {
    name: "Buy Bot",
    mark: "B",
    kind: "ALERTS",
    description: "Announces every purchase in your channel, with the size and the buyer.",
  },
  {
    name: "Hype Bot",
    mark: "H",
    kind: "COMMUNITY",
    description: "Keeps the chat moving between announcements — memes, questions and GMs.",
  },
  {
    name: "Watchtower",
    mark: "W",
    kind: "MILESTONES",
    description: "Posts when you hit a milestone: holders, market cap and graduation.",
  },
] as const;

const MASCOT_ACTIONS = ["trading", "celebrating", "chilling", "building", "gym", "gaming", "cooking"];
const MASCOT_PLACES = ["city streets", "beach", "space", "office", "casino", "nature"];
const BANNED_WORDS = ["guaranteed", "financial advice", "to the moon", "rug", "100x"];
const TONE_DIALS = [
  ["Humour", "Dry", "Playful", "Full degen"],
  ["Emoji", "None", "A little", "Plenty"],
  ["Hashtags", "Never", "One or two", "Lots"],
  ["Post length", "Short", "Medium", "Long"],
] as const;
const BUY_ALERT_THRESHOLDS = ["0.01 ETH", "0.05 ETH", "0.1 ETH"] as const;
const CALENDAR_DAY_NAMES = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const TIMEZONES = [
  { id: "london", label: "London (GMT+1)" },
  { id: "newyork", label: "New York (GMT-4)" },
  { id: "singapore", label: "Singapore (GMT+8)" },
];

type MonthView = { year: number; month: number };
type SelectedDay = { year: number; month: number; day: number };

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function firstWeekdayIndex(year: number, month: number): number {
  return (new Date(year, month, 1).getDay() + 6) % 7;
}

function buildMonthGrid(year: number, month: number): Array<number | null> {
  const total = daysInMonth(year, month);
  const leading = firstWeekdayIndex(year, month);
  return Array.from({ length: 42 }, (_, index) => {
    const day = index - leading + 1;
    return day >= 1 && day <= total ? day : null;
  });
}

function shiftedMonth(view: MonthView, delta: number): MonthView {
  const next = view.month + delta;
  if (next < 0) return { year: view.year - 1, month: 11 };
  if (next > 11) return { year: view.year + 1, month: 0 };
  return { year: view.year, month: next };
}

function safeProjects(raw: string | null): TokenProject[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as TokenProject[];
    return Array.isArray(parsed)
      ? parsed.filter(
          (item) =>
            item &&
            typeof item.id === "string" &&
            typeof item.name === "string" &&
            typeof item.ticker === "string",
        )
      : [];
  } catch {
    return [];
  }
}

function safeMap(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function cleanHandle(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("@") ? trimmed : `@${trimmed.replace(/^https?:\/\/x\.com\//i, "")}`;
}

function cleanTelegram(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  if (trimmed.startsWith("t.me/")) return `https://${trimmed}`;
  return `https://t.me/${trimmed.replace(/^@/, "")}`;
}

function websiteFor(project: TokenProject): string {
  if (!project.websiteSlug) return "";
  return `https://hoodlums.dev/${project.websiteSlug}`;
}

function buildTemplate(project: TokenProject, template: TemplateId): string {
  const name = project.name.trim() || "New token";
  const ticker = project.ticker.trim().toUpperCase() || "TOKEN";
  const chain = project.chain === "robinhood" ? "Robinhood Chain" : "Solana";
  const website = websiteFor(project);
  const xHandle = cleanHandle(project.xHandle);
  const telegram = cleanTelegram(project.telegram);
  const links = [website, xHandle, telegram].filter(Boolean).join("\n");

  if (template === "custom") return "";
  if (template === "countdown") {
    return [
      `⏳ ${name} ($${ticker}) launch countdown is live.`,
      `Built for ${chain}. Follow the official accounts for the verified launch link and contract address.`,
      links,
    ]
      .filter(Boolean)
      .join("\n\n");
  }
  if (template === "contract") {
    return [
      `✅ ${name} ($${ticker}) is live on ${chain}.`,
      `Contract: ${project.contractAddress || "[ADD VERIFIED CONTRACT ADDRESS]"}`,
      "Always verify the contract before trading.",
      links,
    ]
      .filter(Boolean)
      .join("\n\n");
  }
  if (template === "community") {
    return [
      `The ${name} community is assembling.`,
      project.description || `Join the official $${ticker} channels for launch updates, memes and announcements.`,
      links,
    ]
      .filter(Boolean)
      .join("\n\n");
  }
  return [
    `🚨 Introducing ${name} ($${ticker}) on ${chain}.`,
    project.description || "A new community token is preparing for launch.",
    links,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function shortAddress(value: string): string {
  return value.length > 14 ? `${value.slice(0, 7)}…${value.slice(-5)}` : value;
}

function ComingSoon({ compact = false }: { compact?: boolean }) {
  return <span className={compact ? styles.comingSoonCompact : styles.comingSoon}>Coming soon</span>;
}

/** Renders a panel's own progress/success/error message, inline and aria-live, right where the user is looking. */
function InlineStatus({ status }: { status: PanelStatus }) {
  if (!status) return null;
  const modifier = status.tone === "error" ? styles.inlineStatusError : status.tone === "progress" ? styles.inlineStatusProgress : "";
  return (
    <div className={[styles.inlineStatus, modifier].filter(Boolean).join(" ")} role="status" aria-live="polite">
      <span>{status.tone === "error" ? "!" : "●"}</span>
      <p>{status.message}</p>
    </div>
  );
}

export function SocialHub() {
  const [projects, setProjects] = useState<TokenProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<StudioTab>("setup");
  const [composeOpen, setComposeOpen] = useState(false);
  const [templateId, setTemplateId] = useState<TemplateId>("launch");
  const [message, setMessage] = useState("");
  const [includeArtwork, setIncludeArtwork] = useState(true);
  const [status, setStatus] = useState(
    "Choose a saved project, review the post and approve each destination.",
  );
  const [busy, setBusy] = useState(false);
  const [calendarView, setCalendarView] = useState<MonthView>(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [selectedDay, setSelectedDay] = useState<SelectedDay>(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() };
  });
  const [timezoneId, setTimezoneId] = useState(TIMEZONES[0].id);

  const [walletAddress, setWalletAddress] = useState("");
  // The examples are a LIST (owner spec, 5 Sep 2026): the box holds one post
  // at a time and "Add example" cleans it and appends it as its own row, so
  // posts can never be glued together by a paste with no handles between them.
  // `voiceExamplesText` is the one-post-per-line form every downstream count,
  // persist and API call reads.
  const [voiceExamples, setVoiceExamples] = useState<string[]>([]);
  const [voiceDraftText, setVoiceDraftText] = useState("");
  const [voiceAddStatus, setVoiceAddStatus] = useState<PanelStatus>(null);
  const voiceExamplesText = useMemo(() => voiceExamples.join("\n"), [voiceExamples]);
  const [voiceProfile, setVoiceProfile] = useState<VoiceProfile | null>(null);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [sampleLineFeedback, setSampleLineFeedback] = useState<SampleLineFeedback[]>([]);
  // Sorting station (owner spec, 5 Sep 2026). Cards are ephemeral; the verdicts
  // land in sampleLineFeedback (the persona bank) and the source keys in
  // sortedVoiceSourceKeys so a pasted post is never reshaped twice.
  const [sortedVoiceSourceKeys, setSortedVoiceSourceKeys] = useState<string[]>([]);
  const [stationSamples, setStationSamples] = useState<StationSample[]>([]);
  const [stationBusyCount, setStationBusyCount] = useState(0);
  const [stationStatus, setStationStatus] = useState<PanelStatus>(null);
  const [bankClearConfirm, setBankClearConfirm] = useState<"half" | "all" | null>(null);
  const stationInFlightRef = useRef<Set<string>>(new Set());
  const [mascotVisualDNA, setMascotVisualDNA] = useState<MascotVisualDNA | null>(null);
  const [mascotReferenceImage, setMascotReferenceImage] = useState<string | null>(null);
  const [mascotBusy, setMascotBusy] = useState(false);
  const [selectedMascotAction, setSelectedMascotAction] = useState("");
  const [selectedMascotPlace, setSelectedMascotPlace] = useState("");
  const [customActionEntry, setCustomActionEntry] = useState<string | null>(null);
  const [customPlaceEntry, setCustomPlaceEntry] = useState<string | null>(null);
  const [generatedMascotImage, setGeneratedMascotImage] = useState<string | null>(null);
  const [mascotImageBusy, setMascotImageBusy] = useState(false);
  const [telegramMessage, setTelegramMessage] = useState("");
  const [attachedArtwork, setAttachedArtwork] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [draftBusy, setDraftBusy] = useState(false);
  const [calendarAiBusy, setCalendarAiBusy] = useState(false);
  const mascotFileInputRef = useRef<HTMLInputElement | null>(null);

  // Per-panel status (issue #340): errors/progress render next to the
  // control that triggered them instead of only in the far-below statusBar.
  const [voiceStatus, setVoiceStatus] = useState<PanelStatus>(null);
  const [mascotUploadStatus, setMascotUploadStatus] = useState<PanelStatus>(null);
  // Best-results read-out for the last uploaded reference — advice only, the upload proceeds regardless.
  const [mascotReferenceAssessment, setMascotReferenceAssessment] = useState<MascotReferenceAssessment | null>(null);
  const [mascotSceneStatus, setMascotSceneStatus] = useState<PanelStatus>(null);
  const [setupDraftStatus, setSetupDraftStatus] = useState<PanelStatus>(null);
  const [calendarDraftStatus, setCalendarDraftStatus] = useState<PanelStatus>(null);
  const [telegramStatus, setTelegramStatus] = useState<PanelStatus>(null);

  // Real Telegram connect flow (issue #340): reconciles the Setup card with
  // the wallet-signed connect/disconnect routes instead of a bare, unverified
  // chat-ID text field. `telegramConfigured` is null while loading.
  // `telegramConnection` itself is derived from `connections` below (issue
  // #384) rather than kept as separate state.
  const [telegramConfigured, setTelegramConfigured] = useState<boolean | null>(null);
  const [telegramConnectInput, setTelegramConnectInput] = useState("");
  const [telegramConnectBusy, setTelegramConnectBusy] = useState(false);
  // The connect drawer under the Telegram row (design: the card is one slim row;
  // anything more lives in a dropdown box opened from the row's own action).
  const [telegramConnectOpen, setTelegramConnectOpen] = useState(false);

  // Queue tab backend wiring (issue #352): connections (both platforms, not
  // just Telegram), the durable approve-first queue read from GET
  // /api/social/posts, and the per-project auto-replenish target. Ready
  // to review stays the existing local `queue` array/IndexedDB field;
  // approved/history posts are fetched, never persisted locally.
  // `connections` is the single source of truth for both the Setup
  // Telegram card and the Queue's destination toggles (issue #384) —
  // `telegramConnection` below is derived from it, never separate state.
  // `connectionsStatus` distinguishes "confirmed nothing connected" from
  // "we don't actually know yet": a failed fetch leaves `connections`
  // untouched (stale-but-present beats wrongly-empty) and flips this to
  // "error" instead.
  const [connections, setConnections] = useState<SocialConnectionSummary[]>([]);
  const [connectionsStatus, setConnectionsStatus] = useState<"loading" | "loaded" | "error">("loading");
  // Buy Bot (owner direction, 5 Sep 2026): the wallet's per-token bots from
  // GET /api/social/buy-bot, plus the Setup card's own drawer state. Each bot
  // is bound to its own Telegram channel — separate from the posting
  // connection above — so the card carries its own channel field.
  const [buyBots, setBuyBots] = useState<BuyBotSummary[]>([]);
  const [buyBotDrawerOpen, setBuyBotDrawerOpen] = useState(false);
  const [buyBotChannelInput, setBuyBotChannelInput] = useState("");
  const [buyBotThresholdWei, setBuyBotThresholdWei] = useState(DEFAULT_BUY_BOT_THRESHOLD_WEI);
  const [buyBotBusy, setBuyBotBusy] = useState(false);
  const [buyBotStatus, setBuyBotStatus] = useState<PanelStatus>(null);
  const [queueTarget, setQueueTarget] = useState(DEFAULT_QUEUE_TARGET);
  const [scheduledPosts, setScheduledPosts] = useState<ScheduledPostSummary[]>([]);
  const [postsStatus, setPostsStatus] = useState<PanelStatus>(null);
  const [replenishStatus, setReplenishStatus] = useState<PanelStatus>(null);
  const [approvingItemId, setApprovingItemId] = useState<string | null>(null);
  const [cancelingPostId, setCancelingPostId] = useState<string | null>(null);
  const [itemDestinations, setItemDestinations] = useState<Record<string, SocialPlatform[]>>({});
  const [itemScheduledAt, setItemScheduledAt] = useState<Record<string, string>>({});
  // Compact draft cards (issue #358): collapsed by default, showing only the
  // X preview — this tracks which Ready-to-review cards the user has
  // expanded into their full editable X/Telegram fields. Ephemeral UI state,
  // never persisted.
  const [expandedQueueItemIds, setExpandedQueueItemIds] = useState<Record<string, boolean>>({});
  // Approval confirmation (issue #380): Approve is a two-tap action — the
  // first tap force-expands the card so both destination bodies are visible,
  // the second (now labeled "Confirm & approve") actually signs and sends.
  // Any edit to the item's text/destinations clears this so a stale
  // confirmation can never survive a change to what will be sent.
  const [pendingApprovalItemId, setPendingApprovalItemId] = useState<string | null>(null);
  // Unedited canned template copy (issue #380) requires an extra explicit
  // acknowledgement checkbox before it can be approved — never silently
  // blocked, just never sent by accident.
  const [templateAcknowledgedIds, setTemplateAcknowledgedIds] = useState<Record<string, boolean>>({});
  // Quick-send confirmation (issue #382): the per-card "Post to X"/"Send to
  // Telegram" quick actions bypassed the approval confirm-before-sign panel
  // entirely, letting a user publish item.telegramText/xText they had never
  // reviewed. Quick-send is now the same two-tap pattern as
  // handleApproveClick — the first tap force-expands the card and records
  // which destination is pending; only the second tap actually posts.
  const [pendingQuickSendId, setPendingQuickSendId] = useState<{ itemId: string; platform: SocialPlatform } | null>(null);
  const [rescheduleValues, setRescheduleValues] = useState<Record<string, string>>({});
  const [reschedulingPostId, setReschedulingPostId] = useState<string | null>(null);
  // Tracks which Ready-to-review items have a user-picked schedule time
  // (issue #380) — everything else keeps getting a fresh auto-computed
  // default recomputed at approve time rather than frozen at item-creation
  // time, so it reflects what's actually pending right now.
  const [scheduleManuallySet, setScheduleManuallySet] = useState<Record<string, boolean>>({});
  const replenishInFlightRef = useRef(false);
  /** Rotates the example-post window and fallback angle across successive draft requests (issue #360) — never reset, so repeated Setup/Calendar clicks vary too, not just a batch loop. */
  const draftAngleCounterRef = useRef(0);

  // Direction brief and posting cadence (issue #358), persisted per project
  // alongside the rest of the Social Studio record.
  const [directionBrief, setDirectionBrief] = useState("");
  const [postingCadence, setPostingCadence] = useState<PostingCadence>(DEFAULT_POSTING_CADENCE);

  // Server-side project-slot usage (issue #407) — "Project X of Y (Plan)".
  // Read-only summary from GET /api/social/project-slots; the server, not
  // this state, is the entitlement decision. Refreshed after any AI call or
  // post approval (which may auto-register a new slot) and after a release.
  const [slotUsage, setSlotUsage] = useState<SlotUsageSummary | null>(null);
  const [slotUsageStatus, setSlotUsageStatus] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [releasePending, setReleasePending] = useState(false);
  const [releaseBusy, setReleaseBusy] = useState(false);
  const [releaseStatus, setReleaseStatus] = useState<PanelStatus>(null);

  useEffect(() => {
    const loadedProjects = safeProjects(localStorage.getItem(PROJECT_STORAGE_KEY));
    const drafts = safeMap(localStorage.getItem(DRAFT_STORAGE_KEY));
    setProjects(loadedProjects);
    setWalletAddress(storedWalletAddress());

    if (loadedProjects[0]) {
      const first = loadedProjects[0];
      setSelectedProjectId(first.id);
      setMessage(drafts[first.id] || buildTemplate(first, "launch"));
    }
  }, []);

  // Re-confirming the wallet from the Account panel in another tab only
  // updates localStorage there (issue #388) — walletAddress was otherwise
  // read once on mount and never refreshed, so it could silently diverge
  // from the wallet app's active account for the rest of the session.
  // Refreshing on focus (mirroring the loadConnections/Queue focus
  // healers above/below) keeps it current when the user returns to this tab.
  useEffect(() => {
    function refreshWalletAddress() {
      if (document.visibilityState === "hidden") return;
      setWalletAddress((current) => {
        const next = storedWalletAddress();
        return next === current ? current : next;
      });
    }
    window.addEventListener("focus", refreshWalletAddress);
    document.addEventListener("visibilitychange", refreshWalletAddress);
    return () => {
      window.removeEventListener("focus", refreshWalletAddress);
      document.removeEventListener("visibilitychange", refreshWalletAddress);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadTelegramConfigured() {
      try {
        const response = await fetch("/api/social/telegram/status", { cache: "no-store" });
        const payload = await readJsonResponse<{ configured?: boolean }>(response, "Could not check Telegram configuration.");
        if (!cancelled) setTelegramConfigured(Boolean(payload.configured));
      } catch {
        if (!cancelled) setTelegramConfigured(false);
      }
    }
    void loadTelegramConfigured();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Single source of truth for connections (issue #384): both the Setup
   * Telegram card and the Queue's destination toggles read from this same
   * `connections` list (telegramConnection is derived from it below), so a
   * connect/disconnect updating this one place keeps both in sync without a
   * reload. On failure the previous list is kept rather than cleared to
   * `[]` — a transient 500 must not make the Queue believe nothing is
   * connected — and connectionsStatus flips to "error" so callers can
   * render a retry state instead of the "nothing connected" fallback.
   * Exposed as a plain function (not only inside an effect) so the window-
   * focus healer below, the Queue-tab-activation effect, and a manual
   * retry button can all call it directly.
   */
  async function loadConnections() {
    if (!walletAddress) {
      setConnections([]);
      setConnectionsStatus("loaded");
      return;
    }
    try {
      const response = await fetch(`/api/social/connections?walletAddress=${encodeURIComponent(walletAddress)}`, { cache: "no-store" });
      const payload = await readJsonResponse<{ connections?: SocialConnectionSummary[] }>(response, "Could not load your connections.");
      setConnections(Array.isArray(payload.connections) ? payload.connections : []);
      setConnectionsStatus("loaded");
    } catch {
      setConnectionsStatus("error");
    }
  }

  useEffect(() => {
    void loadConnections();
    // loadConnections closes over the latest walletAddress on every render already.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddress]);

  // Heals a transient connections-fetch failure without a reload (issue
  // #384) by re-fetching on window/tab focus — mirrors the Queue data
  // effect's own focus/visibility pattern below, but runs regardless of
  // which tab is active since Setup's connect state depends on it too.
  useEffect(() => {
    function handleFocusOrVisible() {
      if (document.visibilityState === "hidden") return;
      void loadConnections();
    }
    window.addEventListener("focus", handleFocusOrVisible);
    document.addEventListener("visibilitychange", handleFocusOrVisible);
    return () => {
      window.removeEventListener("focus", handleFocusOrVisible);
      document.removeEventListener("visibilitychange", handleFocusOrVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddress]);

  async function loadBuyBots() {
    if (!walletAddress) {
      setBuyBots([]);
      return;
    }
    try {
      const response = await fetch(`/api/social/buy-bot?walletAddress=${encodeURIComponent(walletAddress)}`, { cache: "no-store" });
      const payload = await readJsonResponse<{ bots?: BuyBotSummary[] }>(response, "Could not load your Buy Bots.");
      setBuyBots(Array.isArray(payload.bots) ? payload.bots : []);
    } catch {
      // A failed read keeps whatever was last shown — the card never claims a bot is gone on a network hiccup.
    }
  }

  useEffect(() => {
    void loadBuyBots();
    // loadBuyBots closes over the latest walletAddress on every render already.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddress]);

  /** Refreshes the "Project X of Y" usage summary — called on wallet change and after any claim/release (issue #407). */
  async function loadSlotUsage() {
    if (!walletAddress) {
      setSlotUsage(null);
      setSlotUsageStatus("idle");
      return;
    }
    setSlotUsageStatus("loading");
    try {
      const response = await fetch(`/api/social/project-slots?walletAddress=${encodeURIComponent(walletAddress)}`, { cache: "no-store" });
      const payload = await readJsonResponse<SlotUsageSummary>(response, "Could not load your project-slot usage.");
      setSlotUsage(payload);
      setSlotUsageStatus("loaded");
    } catch {
      setSlotUsageStatus("error");
    }
  }

  useEffect(() => {
    void loadSlotUsage();
    // loadSlotUsage closes over the latest walletAddress on every render already.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddress]);

  useEffect(() => {
    let cancelled = false;
    async function loadRecord() {
      if (!selectedProjectId) {
        setVoiceProfile(null);
        setVoiceExamples([]); setVoiceDraftText("");
        setMascotVisualDNA(null);
        setMascotReferenceImage(null);
        setQueue([]);
        setSampleLineFeedback([]);
        setSortedVoiceSourceKeys([]);
        setStationSamples([]);
        setQueueTarget(DEFAULT_QUEUE_TARGET);
        setDirectionBrief("");
        setPostingCadence(DEFAULT_POSTING_CADENCE);
        setScheduledPosts([]);
        setItemDestinations({});
        setItemScheduledAt({});
        setExpandedQueueItemIds({});
        return;
      }
      const record = await getSocialStudioRecord(selectedProjectId).catch(() => EMPTY_SOCIAL_STUDIO_RECORD);
      if (cancelled) return;
      setVoiceProfile(record.voiceProfile);
      setVoiceExamples(record.voiceExamples);
      setVoiceDraftText("");
      setVoiceAddStatus(null);
      setMascotVisualDNA(record.mascotVisualDNA);
      setMascotReferenceImage(record.mascotReferenceImage);
      setQueue(record.queue);
      setSampleLineFeedback(record.sampleLineFeedback);
      setSortedVoiceSourceKeys(record.sortedVoiceSourceKeys);
      setStationSamples([]);
      setQueueTarget(record.queueTarget);
      setDirectionBrief(record.directionBrief);
      setPostingCadence(record.postingCadence);
      setScheduledPosts([]);
      setItemDestinations({});
      setItemScheduledAt({});
      setExpandedQueueItemIds({});
    }
    void loadRecord();
    return () => {
      cancelled = true;
    };
  }, [selectedProjectId]);

  function currentSocialStudioRecord(overrides: Partial<SocialStudioProjectRecord> = {}): SocialStudioProjectRecord {
    return {
      voiceProfile,
      voiceExamples,
      mascotVisualDNA,
      mascotReferenceImage,
      queue,
      queueTarget,
      postingCadence,
      directionBrief,
      sampleLineFeedback,
      sortedVoiceSourceKeys,
      ...overrides,
    };
  }

  function persistSocialStudio(overrides: Partial<SocialStudioProjectRecord> = {}) {
    if (!selectedProjectId) return;
    void putSocialStudioRecord(selectedProjectId, currentSocialStudioRecord(overrides));
  }

  const selectedProject = useMemo(
    () => projects.find((item) => item.id === selectedProjectId) || null,
    [projects, selectedProjectId],
  );

  /** Derived from `connections`, never separate state (issue #384) — the single source of truth shared by the Setup card and the Queue's destination toggles. */
  const telegramConnection = useMemo<TelegramConnectionState | null>(() => {
    const telegram = connections.find((connection) => connection.platform === "telegram");
    return telegram && (telegram.status === "connected" || telegram.status === "reconnect_needed")
      ? {
          status: telegram.status,
          displayName: telegram.displayName,
          externalId: telegram.externalId,
          reconnectReason: telegram.reconnectReason,
        }
      : null;
  }, [connections]);

  /** The selected project's own Buy Bot, matched on its contract address — only Robinhood Chain Testnet launches have a curve to watch. */
  const selectedBuyBot = useMemo<BuyBotSummary | null>(() => {
    const contract = selectedProject?.contractAddress?.trim().toLowerCase();
    if (!contract || selectedProject?.chain !== "robinhood") return null;
    return buyBots.find((bot) => bot.tokenAddress.toLowerCase() === contract && bot.chainId === ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL) ?? null;
  }, [buyBots, selectedProject]);
  const buyBotTokenAddress = selectedProject?.chain === "robinhood" ? selectedProject.contractAddress?.trim() || "" : "";
  const buyBotUnavailableReason = !walletAddress
    ? "Connect your wallet first."
    : !selectedProject
      ? "Pick a project first."
      : !buyBotTokenAddress
        ? "Launch this token on Robinhood Chain Testnet first — the Buy Bot watches its curve."
        : null;

  const xCharacterCount = message.length;
  const xReady = xCharacterCount > 0 && xCharacterCount <= 280;
  const telegramReady = Boolean(
    selectedProject && telegramConnection?.status === "connected" && (telegramMessage || message).trim(),
  );
  const voiceExampleFilter = useMemo(() => filterUsableVoiceExamples(voiceExamplesText), [voiceExamplesText]);
  const voiceExampleCount = voiceExampleFilter.usable.length;
  const voiceProgressPercent = Math.min(100, Math.round((voiceExampleCount / VOICE_EXAMPLE_TARGET) * 100));
  const projectInitial = (selectedProject?.name || "H").slice(0, 1).toUpperCase();
  const projectTicker = selectedProject?.ticker?.trim().toUpperCase() || "PROJECT";
  const xHandle = selectedProject?.xHandle ? cleanHandle(selectedProject.xHandle) : "";
  const now = new Date();
  const isCurrentMonthView = calendarView.year === now.getFullYear() && calendarView.month === now.getMonth();
  const monthGrid = useMemo(
    () => buildMonthGrid(calendarView.year, calendarView.month),
    [calendarView.year, calendarView.month],
  );
  const monthDays = useMemo(
    () => monthGrid.filter((day): day is number => day !== null),
    [monthGrid],
  );
  const selectedDayLabel = `${selectedDay.day} ${MONTH_NAMES[selectedDay.month]} ${selectedDay.year}`;

  /** The current project's canned template outputs (issue #380), used to detect an unedited-template Ready-to-review draft — "custom" is excluded since it's always empty. */
  const templateOutputs = useMemo(
    () => (selectedProject ? TEMPLATES.filter((template) => template.id !== "custom").map((template) => buildTemplate(selectedProject, template.id)) : []),
    [selectedProject],
  );

  const myConnectedPlatforms = useMemo(() => connectedPlatforms(connections), [connections]);
  const awaitingSendPosts = useMemo(
    () => scheduledPosts.filter((post) => isAwaitingSend(post.status)),
    [scheduledPosts],
  );
  // The design's "TODAY 3/5 posts" pill, from posts already loaded — anything
  // approved for today that has not been canceled, against this cadence's own
  // daily ceiling.
  const postsScheduledToday = useMemo(
    () =>
      countPostsScheduledToday(
        scheduledPosts.filter((post) => post.status !== "canceled").map((post) => post.scheduledAt),
        new Date(),
      ),
    [scheduledPosts],
  );
  const cadencePostsPerDay = cadenceQueueTarget(postingCadence);

  const historyPosts = useMemo(
    () => scheduledPosts.filter((post) => isHistoryStatus(post.status)),
    [scheduledPosts],
  );
  const readyToReviewShortfall = replenishShortfall(queue.length, queueTarget);

  function selectProject(id: string) {
    const project = projects.find((item) => item.id === id);
    if (!project) return;
    const drafts = safeMap(localStorage.getItem(DRAFT_STORAGE_KEY));
    setSelectedProjectId(id);
    setTemplateId("launch");
    setMessage(drafts[id] || buildTemplate(project, "launch"));
    setTelegramMessage("");
    setAttachedArtwork(null);
    setGeneratedMascotImage(null);
    setSelectedMascotAction("");
    setSelectedMascotPlace("");
    setCustomActionEntry(null);
    setCustomPlaceEntry(null);
    setProjectMenuOpen(false);
    setVoiceStatus(null);
    setMascotUploadStatus(null);
    setMascotSceneStatus(null);
    setSetupDraftStatus(null);
    setCalendarDraftStatus(null);
    setPostsStatus(null);
    setReplenishStatus(null);
    setStatus(`${project.name || "Project"} loaded into Hoodlums Social.`);
  }

  function chooseTemplate(id: TemplateId) {
    setTemplateId(id);
    if (!selectedProject) return;
    setMessage(buildTemplate(selectedProject, id));
    setStatus(`${TEMPLATES.find((item) => item.id === id)?.label || "Template"} loaded.`);
  }

  function saveDraft() {
    if (!selectedProject) {
      setStatus("Choose a project before saving a draft.");
      return;
    }
    const drafts: DraftMap = safeMap(localStorage.getItem(DRAFT_STORAGE_KEY));
    drafts[selectedProject.id] = message;
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(drafts));
    setStatus("Draft saved privately in this browser.");
  }

  async function copyPost() {
    if (!message.trim()) {
      setStatus("Write a post before copying it.");
      return;
    }
    await navigator.clipboard.writeText(message);
    setStatus("Post copied to the clipboard.");
  }

  function openXComposer() {
    if (!message.trim()) {
      setStatus("Write a post before opening X.");
      return false;
    }
    if (!xReady) {
      setStatus(`X posts must be 280 characters or fewer. Remove ${xCharacterCount - 280} characters.`);
      return false;
    }
    const url = `https://x.com/intent/post?text=${encodeURIComponent(message)}`;
    window.open(url, "_blank", "noopener,noreferrer");
    setStatus("X composer opened with the post filled in. Review it and press Post on X.");
    return true;
  }

  function downloadArtwork() {
    if (!selectedProject?.heroImage) {
      setStatus("This project has no artwork to download.");
      return;
    }
    const extension = selectedProject.heroImage.startsWith("data:image/png")
      ? "png"
      : selectedProject.heroImage.startsWith("data:image/webp")
        ? "webp"
        : "jpg";
    const anchor = document.createElement("a");
    anchor.href = selectedProject.heroImage;
    anchor.download = `${selectedProject.websiteSlug || selectedProject.ticker || "token"}-social-artwork.${extension}`;
    anchor.click();
    setStatus("Artwork downloaded. Attach it manually inside the X composer.");
  }

  async function connectTelegramChannel() {
    const chatId = telegramConnectInput.trim();
    if (!chatId) {
      setTelegramStatus({ tone: "error", message: "Enter the Telegram channel username or numeric chat ID first." });
      return;
    }
    const provider = getInjectedEvmProvider();
    if (!provider) {
      setTelegramStatus({ tone: "error", message: "Connect an EVM wallet before linking Telegram." });
      return;
    }

    setTelegramConnectBusy(true);
    setTelegramStatus({ tone: "progress", message: "Checking that the Hoodlums bot is an admin in that channel…" });
    try {
      const walletClient = createWalletClient({ transport: custom(provider) });
      const [account] = await walletClient.getAddresses();
      if (!account) throw new Error("Connect an EVM wallet before linking Telegram.");
      const mismatch = describeWalletMismatch(account, walletAddress);
      if (mismatch) throw new Error(mismatch);
      const walletChainId = await walletClient.getChainId();

      const challengeResponse = await fetch("/api/social/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: account, walletChainId, purpose: "social:telegram-connect", payload: { chatId } }),
      });
      const challenge = await readJsonResponse<{ challengeId: string; nonce: string; message: string }>(
        challengeResponse,
        "Could not start the Telegram connection.",
      );
      const signature = await walletClient.signMessage({ account, message: challenge.message });

      const connectResponse = await fetch("/api/social/telegram/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, challengeId: challenge.challengeId, nonce: challenge.nonce, signature }),
      });
      const payload = await readJsonResponse<{ connection: TelegramConnectionState }>(
        connectResponse,
        "Telegram could not verify that channel.",
      );
      // Updates `connections` directly from the returned payload — no extra
      // fetch needed (issue #384) — so the Queue's destination toggles pick
      // this connection up in the same render as the Setup card does.
      setConnections((current) => [
        ...current.filter((connection) => connection.platform !== "telegram"),
        { platform: "telegram", ...payload.connection },
      ]);
      setConnectionsStatus("loaded");
      setTelegramConnectInput("");
      setTelegramStatus({
        tone: "success",
        message: `Connected. The Hoodlums bot can post in ${payload.connection.displayName}.`,
      });
    } catch (error) {
      setTelegramStatus({
        tone: "error",
        message: error instanceof Error ? error.message : "Telegram could not verify that channel.",
      });
    } finally {
      setTelegramConnectBusy(false);
    }
  }

  async function disconnectTelegramChannel() {
    const provider = getInjectedEvmProvider();
    if (!provider) {
      setTelegramStatus({ tone: "error", message: "Connect an EVM wallet before disconnecting Telegram." });
      return;
    }

    setTelegramConnectBusy(true);
    setTelegramStatus({ tone: "progress", message: "Disconnecting Telegram…" });
    try {
      const walletClient = createWalletClient({ transport: custom(provider) });
      const [account] = await walletClient.getAddresses();
      if (!account) throw new Error("Connect an EVM wallet before disconnecting Telegram.");
      const mismatch = describeWalletMismatch(account, walletAddress);
      if (mismatch) throw new Error(mismatch);
      const walletChainId = await walletClient.getChainId();

      const challengeResponse = await fetch("/api/social/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: account, walletChainId, purpose: "social:telegram-disconnect", payload: { platform: "telegram" } }),
      });
      const challenge = await readJsonResponse<{ challengeId: string; nonce: string; message: string }>(
        challengeResponse,
        "Could not start disconnecting Telegram.",
      );
      const signature = await walletClient.signMessage({ account, message: challenge.message });

      const disconnectResponse = await fetch("/api/social/telegram/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: challenge.challengeId, nonce: challenge.nonce, signature }),
      });
      await readJsonResponse<{ ok?: boolean }>(disconnectResponse, "Telegram could not be disconnected.");
      // Same immediate update as connect, in reverse (issue #384) — removes
      // Telegram from `connections` directly rather than a separate
      // telegramConnection state the Queue toggles never saw.
      setConnections((current) => current.filter((connection) => connection.platform !== "telegram"));
      setTelegramStatus({ tone: "success", message: "Telegram disconnected." });
    } catch (error) {
      setTelegramStatus({
        tone: "error",
        message: error instanceof Error ? error.message : "Telegram could not be disconnected.",
      });
    } finally {
      setTelegramConnectBusy(false);
    }
  }

  async function postTelegram() {
    if (!selectedProject) {
      setStatus("Choose a project before publishing.");
      return false;
    }
    if (!telegramReady || !telegramConnection || telegramConnection.status !== "connected") {
      setStatus("Connect a verified Telegram channel in Setup and add post text first.");
      return false;
    }

    setBusy(true);
    setStatus("Sending the approved post through the Hoodlums Telegram bot…");
    try {
      const response = await fetch("/api/social/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId: telegramConnection.externalId,
          text: (telegramMessage || message).trim(),
          artwork: includeArtwork ? attachedArtwork || selectedProject.heroImage : "",
        }),
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Telegram rejected the post.");
      }

      setStatus("Telegram post published through the Hoodlums bot.");
      return true;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Telegram publishing failed.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function publishBoth() {
    if (!openXComposer()) return;
    await postTelegram();
  }

  function draftProjectPayload() {
    if (!selectedProject) return null;
    return {
      name: selectedProject.name,
      ticker: selectedProject.ticker,
      description: selectedProject.description,
      chain: selectedProject.chain,
      contractAddress: selectedProject.contractAddress,
    };
  }

  // ---- Sorting station -------------------------------------------------------

  const personaKept = useMemo(() => keptSampleLines(sampleLineFeedback), [sampleLineFeedback]);
  const personaFireCount = personaKept.filter((entry) => entry.sentiment === "fire").length;
  const personaBankFull = isPersonaBankFull(sampleLineFeedback);

  /** Pasted posts not yet reshaped and sorted, and not already on the table. */
  const stationSupply = useMemo(() => {
    const sorted = new Set(sortedVoiceSourceKeys);
    const onTable = new Set(stationSamples.map((sample) => sample.sourceKey));
    return voiceExampleFilter.usable.filter((example) => {
      const key = example.toLowerCase();
      return !sorted.has(key) && !onTable.has(key);
    });
  }, [voiceExampleFilter.usable, sortedVoiceSourceKeys, stationSamples]);

  /** Supply minus anything already being reshaped right now — read at call time, never during render. */
  function availableStationSupply(): string[] {
    return stationSupply.filter((example) => !stationInFlightRef.current.has(example.toLowerCase()));
  }

  /** Reshape ONE pasted post into a sample for this project and put it on the table. One small AI call. */
  async function fetchStationSample(sourcePost: string) {
    const project = draftProjectPayload();
    if (!project) return;
    const sourceKey = sourcePost.toLowerCase();
    stationInFlightRef.current.add(sourceKey);
    setStationBusyCount((count) => count + 1);
    try {
      const response = await fetch("/api/social/voice-sample", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress,
          projectId: selectedProject?.id,
          displayName: selectedProject?.name,
          project: { name: project.name, ticker: project.ticker, description: project.description },
          sourcePost,
          personaLines: likedReinforcementLines(sampleLineFeedback),
        }),
      });
      const payload = (await response.json()) as { sample?: string; error?: string };
      if (!response.ok || !payload.sample) throw new Error(payload.error || "The sample could not be reshaped.");
      const text = payload.sample;
      setStationSamples((current) =>
        current.some((sample) => sample.text === text)
          ? current
          : [...current, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, text, sourceKey }],
      );
      setStationStatus(null);
    } catch (error) {
      setStationStatus({ tone: "error", message: error instanceof Error ? error.message : "The sample could not be reshaped." });
    } finally {
      stationInFlightRef.current.delete(sourceKey);
      setStationBusyCount((count) => Math.max(0, count - 1));
    }
  }

  /** Fill the table up to STATION_SIZE from the remaining supply. Explicit tap or a refill after a sort — never on page load. */
  function fillSortingStation(slots = STATION_SIZE - stationSamples.length) {
    if (personaBankFull) return;
    const next = availableStationSupply().slice(0, Math.max(0, slots));
    if (next.length === 0) return;
    setStationStatus({ tone: "progress", message: `Reshaping ${next.length} of your posts to ${selectedProject?.name ?? "your project"}…` });
    void Promise.all(next.map((source) => fetchStationSample(source)));
  }

  /**
   * One verdict on one card. Fire and Sounds right go into the persona bank
   * (Fire protected from Clear 50%); Bin is discarded and remembered so the
   * text is never re-served. Every verdict removes the card, marks its source
   * as sorted, and pulls the next sample in behind it.
   */
  function sortStationSample(sample: StationSample, verdict: SampleLineFeedback["sentiment"]) {
    if (verdict !== "disliked" && personaBankFull) {
      setStationStatus({ tone: "error", message: `Your persona bank is full at ${PERSONA_BANK_SIZE}. Clear 50% or clear all to keep sorting.` });
      return;
    }
    const nextFeedback = toggleSampleLineFeedback(sampleLineFeedback, sample.text, verdict, new Date().toISOString());
    const nextSorted = sortedVoiceSourceKeys.includes(sample.sourceKey) ? sortedVoiceSourceKeys : [...sortedVoiceSourceKeys, sample.sourceKey];
    setSampleLineFeedback(nextFeedback);
    setSortedVoiceSourceKeys(nextSorted);
    setStationSamples((current) => current.filter((entry) => entry.id !== sample.id));
    persistSocialStudio({ sampleLineFeedback: nextFeedback, sortedVoiceSourceKeys: nextSorted });
    setBankClearConfirm(null);
    if (!isPersonaBankFull(nextFeedback)) {
      const refill = availableStationSupply().find((source) => source.toLowerCase() !== sample.sourceKey);
      if (refill) void fetchStationSample(refill);
    }
  }

  /** Two-tap clear: the first tap arms, the second applies. Clear 50% drops the oldest half of Sounds-right lines (Fire untouched); Clear all empties the bank. */
  function clearBank(mode: "half" | "all") {
    if (bankClearConfirm !== mode) {
      setBankClearConfirm(mode);
      return;
    }
    const nextFeedback = mode === "half" ? clearHalfOfPersonaBank(sampleLineFeedback) : clearPersonaBank(sampleLineFeedback);
    setSampleLineFeedback(nextFeedback);
    persistSocialStudio({ sampleLineFeedback: nextFeedback });
    setBankClearConfirm(null);
    const removed = keptSampleLines(sampleLineFeedback).length - keptSampleLines(nextFeedback).length;
    setStationStatus(
      removed === 0
        ? { tone: "error", message: "Nothing to clear — every kept line is on Fire. Use Clear all if you really want them gone." }
        : { tone: "success", message: `Cleared ${removed} line${removed === 1 ? "" : "s"} from your persona bank.` },
    );
  }

  /** "Add example": clean whatever is in the box into discrete posts and append each as its own row. */
  function addVoiceExampleFromBox() {
    const result = addVoiceExamples(voiceExamples, voiceDraftText);
    if (result.added.length > 0) {
      setVoiceExamples(result.examples);
      persistSocialStudio({ voiceExamples: result.examples });
      setVoiceDraftText("");
    }
    setVoiceAddStatus({
      tone: result.added.length > 0 ? "success" : "error",
      message: describeAddVoiceExamplesResult(result),
    });
  }

  /** The × on an example row. */
  function removeVoiceExample(index: number) {
    const next = voiceExamples.filter((_, position) => position !== index);
    setVoiceExamples(next);
    persistSocialStudio({ voiceExamples: next });
    setVoiceAddStatus(null);
  }

  async function buildVoiceProfile() {
    const project = draftProjectPayload();
    if (!project) {
      setVoiceStatus({ tone: "error", message: "Choose a project before teaching the AI your voice." });
      return;
    }
    const { usable: examples, pastedLineCount, rejectedCount } = voiceExampleFilter;
    if (examples.length < MIN_USABLE_VOICE_EXAMPLES) {
      setVoiceStatus({
        tone: "error",
        message:
          pastedLineCount > 0
            ? `Only ${examples.length} usable example${examples.length === 1 ? "" : "s"} found after skipping ${rejectedCount} short/boilerplate/duplicate line${rejectedCount === 1 ? "" : "s"} out of ${pastedLineCount} pasted. Paste at least two real posts, one per line.`
            : "Paste at least two example posts, one per line, to teach the AI your voice.",
      });
      return;
    }

    setVoiceBusy(true);
    setVoiceStatus({ tone: "progress", message: "Reading your examples and learning the voice…" });
    try {
      const response = await fetch("/api/social/voice-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress,
          projectId: selectedProject?.id,
          displayName: selectedProject?.name,
          project,
          examples,
          likedSampleLines: likedReinforcementLines(sampleLineFeedback),
        }),
      });
      const payload = (await response.json()) as { voiceProfile?: VoiceProfile; error?: string };
      if (!response.ok || !payload.voiceProfile) {
        throw new Error(payload.error || "The voice profile could not be built.");
      }
      setVoiceProfile(payload.voiceProfile);
      persistSocialStudio({ voiceProfile: payload.voiceProfile });
      void loadSlotUsage();
      setVoiceStatus({
        tone: "success",
        message:
          rejectedCount > 0
            ? `Voice profile updated using ${examples.length} of ${pastedLineCount} pasted lines (${rejectedCount} skipped as short, page furniture, or duplicates). Preview it on the right.`
            : "Voice profile updated. Preview it on the right.",
      });
    } catch (error) {
      setVoiceStatus({ tone: "error", message: error instanceof Error ? error.message : "The voice profile could not be built." });
    } finally {
      setVoiceBusy(false);
    }
  }

  function noteScreenshotsUnavailable() {
    setVoiceStatus({ tone: "error", message: "Screenshot-to-text isn't available yet — paste your post text above instead." });
  }

  async function generateDraft(
    options: {
      dayLabel?: string;
      theme?: string;
      replenish?: boolean;
      recentDraftsOverride?: string[];
      recentTelegramDraftsOverride?: string[];
    } = {},
    report: (next: PanelStatus) => void = () => {},
  ): Promise<{ xText: string; telegramText: string } | null> {
    const project = draftProjectPayload();
    if (!project) {
      report({ tone: "error", message: "Choose a project before generating a draft." });
      return null;
    }

    report({ tone: "progress", message: "Writing a draft with AI…" });
    try {
      const angleIndex = draftAngleCounterRef.current;
      draftAngleCounterRef.current += 1;
      const response = await fetch("/api/social/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress,
          projectId: selectedProject?.id,
          displayName: selectedProject?.name,
          project,
          voiceProfile,
          dayLabel: options.dayLabel ?? null,
          theme: options.theme ?? null,
          likedSampleLines: likedReinforcementLines(sampleLineFeedback),
          directionBrief: directionBrief.trim() || null,
          voiceExamples: voiceExampleFilter.usable,
          recentDrafts: options.recentDraftsOverride ?? queue.map((item) => item.xText),
          recentTelegramDrafts: options.recentTelegramDraftsOverride ?? queue.map((item) => item.telegramText),
          angleIndex,
        }),
      });
      const payload = (await response.json()) as {
        draft?: { xText: string; telegramText: string };
        error?: string;
      };
      if (!response.ok || !payload.draft) {
        throw new Error(payload.error || "The draft could not be generated.");
      }
      void loadSlotUsage();

      if (options.dayLabel || options.replenish) {
        const item: QueueItem = {
          id: newQueueItemId(),
          xText: payload.draft.xText,
          telegramText: payload.draft.telegramText,
          artwork: null,
          source: options.dayLabel ? "calendar-ai" : "auto-replenish",
          dayLabel: options.dayLabel ?? null,
          createdAt: new Date().toISOString(),
        };
        setQueue((current) => {
          const next = [item, ...current];
          persistSocialStudio({ queue: next });
          return next;
        });
        report(
          options.dayLabel
            ? { tone: "success", message: `AI draft for ${options.dayLabel} added to the Queue.` }
            : { tone: "success", message: "New draft added to Ready to review." },
        );
      } else {
        setMessage(payload.draft.xText);
        setTelegramMessage(payload.draft.telegramText);
        setComposeOpen(true);
        report({ tone: "success", message: "AI draft ready. Review it below before posting." });
      }
      return payload.draft;
    } catch (error) {
      report({ tone: "error", message: error instanceof Error ? error.message : "The draft could not be generated." });
      return null;
    }
  }

  async function generateDraftFromSetup() {
    setDraftBusy(true);
    await generateDraft({}, setSetupDraftStatus);
    setDraftBusy(false);
  }

  async function generateDraftForDay() {
    setCalendarAiBusy(true);
    await generateDraft({ dayLabel: selectedDayLabel }, setCalendarDraftStatus);
    setCalendarAiBusy(false);
  }

  /**
   * Client-side "always something loaded" replenish (issue #352). Generates
   * exactly the shortfall computed once at call time — never re-checks the
   * pool mid-loop — and is guarded by replenishInFlightRef so a tab-focus
   * event during an in-flight generation is a no-op rather than a pile-up.
   * Deliberately only called from app-open/tab-focus/approve/delete
   * handlers, never from a timer or the server: background replenishment
   * while the user is away is out of scope for this PR (see issue #352).
   *
   * Each generateDraft call in this loop closes over the same `queue` state
   * captured when the loop started — React does not apply setQueue
   * synchronously mid-loop, so every request used to see the same stale
   * (often empty) recentDrafts, defeating the recent-draft/banned-phrase
   * logic for the whole batch (issue #366). rollingRecentDrafts is a local
   * list, seeded from the queue once and advanced synchronously after each
   * successful generation, so draft 2 sees draft 1, draft 3 sees drafts 1-2,
   * and so on — independent of when/whether setQueue has re-rendered yet.
   */
  async function replenishQueue() {
    if (!selectedProjectId || replenishInFlightRef.current) return;
    const shortfall = replenishShortfall(queue.length, queueTarget);
    if (shortfall <= 0) return;

    replenishInFlightRef.current = true;
    let generated = 0;
    let rollingRecentDrafts = queue.map((item) => item.xText);
    let rollingRecentTelegramDrafts = queue.map((item) => item.telegramText);
    try {
      for (let index = 0; index < shortfall; index += 1) {
        setReplenishStatus({ tone: "progress", message: `Generating draft ${index + 1} of ${shortfall} for Ready to review…` });
        const draft = await generateDraft({
          replenish: true,
          recentDraftsOverride: rollingRecentDrafts,
          recentTelegramDraftsOverride: rollingRecentTelegramDrafts,
        });
        if (!draft) break;
        rollingRecentDrafts = advanceRollingRecentDrafts(rollingRecentDrafts, draft.xText);
        rollingRecentTelegramDrafts = advanceRollingRecentDrafts(rollingRecentTelegramDrafts, draft.telegramText);
        generated += 1;
      }
    } finally {
      replenishInFlightRef.current = false;
    }
    setReplenishStatus(
      generated > 0
        ? { tone: "success", message: `Added ${generated} new draft${generated === 1 ? "" : "s"} to Ready to review.` }
        : { tone: "error", message: "Couldn't generate new drafts right now. Try again from Setup or Calendar." },
    );
  }

  async function loadScheduledPosts() {
    if (!walletAddress) {
      setScheduledPosts([]);
      return;
    }
    setPostsStatus({ tone: "progress", message: "Loading approved posts…" });
    try {
      const response = await fetch(`/api/social/posts?walletAddress=${encodeURIComponent(walletAddress)}`, { cache: "no-store" });
      const payload = await readJsonResponse<{ posts?: ScheduledPostSummary[] }>(response, "Could not load approved posts.");
      setScheduledPosts(Array.isArray(payload.posts) ? payload.posts : []);
      setPostsStatus(null);
    } catch (error) {
      setPostsStatus({ tone: "error", message: error instanceof Error ? error.message : "Could not load approved posts." });
    }
  }

  /** Switches the Buy Bot on for the selected token (or re-binds a bot that needs re-adding): one wallet signature, then the server verifies the platform bot is an admin in the channel before storing anything. */
  async function enableBuyBot() {
    const chatId = buyBotChannelInput.trim();
    if (!buyBotTokenAddress) {
      setBuyBotStatus({ tone: "error", message: buyBotUnavailableReason ?? "Pick a launched token first." });
      return;
    }
    if (!chatId) {
      setBuyBotStatus({ tone: "error", message: "Enter the Telegram channel username or numeric chat ID first." });
      return;
    }
    setBuyBotBusy(true);
    setBuyBotStatus({ tone: "progress", message: "Checking that the Hoodlums bot is an admin in that channel…" });
    try {
      const chainId = String(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL);
      const auth = await signSocialStudioChallenge(SOCIAL_STUDIO_ACTION_PURPOSES.buyBotEnable, {
        chainId,
        tokenAddress: buyBotTokenAddress,
        chatId,
        thresholdWei: buyBotThresholdWei,
      });
      const response = await fetch("/api/social/buy-bot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chainId,
          tokenAddress: buyBotTokenAddress,
          chatId,
          thresholdWei: buyBotThresholdWei,
          challengeId: auth.challengeId,
          nonce: auth.nonce,
          signature: auth.signature,
        }),
      });
      const payload = await readJsonResponse<{ bot: BuyBotSummary }>(response, "The Buy Bot could not be added to that channel.");
      setBuyBots((current) => [
        payload.bot,
        ...current.filter((bot) => !(bot.tokenAddress.toLowerCase() === payload.bot.tokenAddress.toLowerCase() && bot.chainId === payload.bot.chainId)),
      ]);
      setBuyBotDrawerOpen(false);
      setBuyBotChannelInput("");
      setBuyBotStatus({ tone: "success", message: `Live. Buys above ${formatBuyBotThreshold(payload.bot.thresholdWei)} now post in ${payload.bot.channelDisplayName}.` });
    } catch (error) {
      setBuyBotStatus({ tone: "error", message: error instanceof Error ? error.message : "The Buy Bot could not be added to that channel." });
    } finally {
      setBuyBotBusy(false);
    }
  }

  /** Threshold change or pause/resume for the selected token's bot — wallet-signed, and the server only ever touches this wallet's own row. */
  async function updateBuyBot(changes: { thresholdWei?: string; status?: "active" | "paused" }) {
    if (!selectedBuyBot) return;
    setBuyBotBusy(true);
    setBuyBotStatus({ tone: "progress", message: changes.status ? (changes.status === "paused" ? "Pausing…" : "Resuming…") : "Saving the threshold…" });
    try {
      const chainId = String(selectedBuyBot.chainId);
      const payload = { chainId, tokenAddress: selectedBuyBot.tokenAddress, thresholdWei: changes.thresholdWei ?? "", status: changes.status ?? "" };
      const auth = await signSocialStudioChallenge(SOCIAL_STUDIO_ACTION_PURPOSES.buyBotUpdate, payload);
      const response = await fetch("/api/social/buy-bot/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, challengeId: auth.challengeId, nonce: auth.nonce, signature: auth.signature }),
      });
      const result = await readJsonResponse<{ bot: BuyBotSummary }>(response, "The Buy Bot could not be updated.");
      setBuyBots((current) => current.map((bot) => (bot.tokenAddress.toLowerCase() === result.bot.tokenAddress.toLowerCase() && bot.chainId === result.bot.chainId ? result.bot : bot)));
      setBuyBotStatus({
        tone: "success",
        message: changes.status === "paused" ? "Paused — nothing posts until you resume." : changes.status === "active" ? "Resumed." : `Now posting buys above ${formatBuyBotThreshold(result.bot.thresholdWei)}.`,
      });
    } catch (error) {
      setBuyBotStatus({ tone: "error", message: error instanceof Error ? error.message : "The Buy Bot could not be updated." });
    } finally {
      setBuyBotBusy(false);
    }
  }

  /** Removes the selected token's bot from its channel entirely (channel binding included). */
  async function disableBuyBot() {
    if (!selectedBuyBot) return;
    setBuyBotBusy(true);
    setBuyBotStatus({ tone: "progress", message: "Removing…" });
    try {
      const chainId = String(selectedBuyBot.chainId);
      const payload = { chainId, tokenAddress: selectedBuyBot.tokenAddress };
      const auth = await signSocialStudioChallenge(SOCIAL_STUDIO_ACTION_PURPOSES.buyBotDisable, payload);
      const response = await fetch("/api/social/buy-bot/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, challengeId: auth.challengeId, nonce: auth.nonce, signature: auth.signature }),
      });
      await readJsonResponse<{ ok: boolean }>(response, "The Buy Bot could not be removed.");
      setBuyBots((current) => current.filter((bot) => !(bot.tokenAddress.toLowerCase() === selectedBuyBot.tokenAddress.toLowerCase() && bot.chainId === selectedBuyBot.chainId)));
      setBuyBotStatus({ tone: "success", message: "Removed. The bot no longer posts in that channel." });
    } catch (error) {
      setBuyBotStatus({ tone: "error", message: error instanceof Error ? error.message : "The Buy Bot could not be removed." });
    } finally {
      setBuyBotBusy(false);
    }
  }

  /** Shared wallet-signed challenge/signature round trip behind every Queue tab approve/cancel action — the same challenge/nonce primitives Telegram connect/disconnect above use directly. */
  async function signSocialStudioChallenge(
    purpose: (typeof SOCIAL_STUDIO_ACTION_PURPOSES)[keyof typeof SOCIAL_STUDIO_ACTION_PURPOSES],
    payload: Record<string, string>,
  ): Promise<{ account: string; challengeId: string; nonce: string; signature: string }> {
    const provider = getInjectedEvmProvider();
    if (!provider) throw new Error("Connect an EVM wallet first.");
    const walletClient = createWalletClient({ transport: custom(provider) });
    const [account] = await walletClient.getAddresses();
    if (!account) throw new Error("Connect an EVM wallet first.");
    const mismatch = describeWalletMismatch(account, walletAddress);
    if (mismatch) throw new Error(mismatch);
    const walletChainId = await walletClient.getChainId();

    const challengeResponse = await fetch("/api/social/challenge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ walletAddress: account, walletChainId, purpose, payload }),
    });
    const challenge = await readJsonResponse<{ challengeId: string; nonce: string; message: string }>(
      challengeResponse,
      "Could not start that action.",
    );
    const signature = await walletClient.signMessage({ account, message: challenge.message });
    return { account, challengeId: challenge.challengeId, nonce: challenge.nonce, signature };
  }

  /**
   * "Use this plan slot for a different project" (issue #407) — a
   * wallet-signed release of the current project's plan slot. Only reached
   * via a two-tap confirmation (releasePending) so a mis-tap can't burn the
   * wallet's one-per-seven-days release. Refreshes slot usage on success so
   * the "Project X of Y" indicator and the swap button reflect the freed
   * slot immediately.
   */
  async function releaseCurrentProjectSlot() {
    if (!selectedProject) return;
    setReleaseBusy(true);
    setReleaseStatus({ tone: "progress", message: "Releasing this plan slot…" });
    try {
      const auth = await signSocialStudioChallenge(SOCIAL_STUDIO_ACTION_PURPOSES.projectSlotRelease, {
        projectId: selectedProject.id,
        displayName: selectedProject.name,
      });
      const response = await fetch("/api/social/project-slots/release", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: selectedProject.id,
          displayName: selectedProject.name,
          challengeId: auth.challengeId,
          nonce: auth.nonce,
          signature: auth.signature,
        }),
      });
      await readJsonResponse<{ releasedAt?: string }>(response, "The plan slot could not be released.");
      setReleasePending(false);
      setReleaseStatus({ tone: "success", message: "Plan slot released. Choose a different project to use it." });
      void loadSlotUsage();
    } catch (error) {
      setReleaseStatus({ tone: "error", message: error instanceof Error ? error.message : "The plan slot could not be released." });
    } finally {
      setReleaseBusy(false);
    }
  }

  function toggleItemDestination(itemId: string, platform: SocialPlatform) {
    setItemDestinations((current) => {
      const selected = current[itemId] ?? [];
      const next = selected.includes(platform) ? selected.filter((entry) => entry !== platform) : [...selected, platform];
      return { ...current, [itemId]: next };
    });
    clearApprovalConfirmation(itemId);
  }

  function setItemScheduledAtValue(itemId: string, value: string) {
    setItemScheduledAt((current) => ({ ...current, [itemId]: value }));
    setScheduleManuallySet((current) => ({ ...current, [itemId]: true }));
  }

  /**
   * Approve is a two-tap action (issue #380): the first tap never signs
   * anything. It force-expands the card (so both the X and Telegram bodies
   * that are about to be sent are actually visible — previously a collapsed
   * card could approve Telegram text the user had never seen) and, unless
   * the user already picked their own time, refreshes the default schedule
   * from what's pending *right now* rather than trusting a value computed
   * whenever this draft first appeared. Only the second tap — now labeled
   * "Confirm & approve" — actually calls approveQueueItem.
   */
  function handleApproveClick(item: QueueItem) {
    if (pendingApprovalItemId !== item.id) {
      if (!scheduleManuallySet[item.id]) {
        const awaitingIso = scheduledPosts.filter((post) => isPendingSendStatus(post.status)).map((post) => post.scheduledAt);
        setItemScheduledAt((current) => ({
          ...current,
          [item.id]: toDateTimeLocalValue(computeDefaultScheduledAt(awaitingIso, new Date(), cadenceSpreadHoursMs(postingCadence))),
        }));
      }
      setExpandedQueueItemIds((current) => ({ ...current, [item.id]: true }));
      setPendingApprovalItemId(item.id);
      return;
    }
    void approveQueueItem(item);
  }

  /**
   * Approves a Ready-to-review draft (issue #352 -> issue #335's
   * approval-is-creation POST /api/social/posts). The backend stores one
   * shared `body` per post, but xText and telegramText usually differ, so
   * each selected destination becomes its own wallet-signed approval call
   * with that platform's own text — one X-only post and/or one
   * Telegram-only post, both carrying the same schedule time and artwork.
   * Only reachable via handleApproveClick's second tap.
   */
  async function approveQueueItem(item: QueueItem) {
    if (!selectedProject) {
      setPostsStatus({ tone: "error", message: "Choose a project before approving a post." });
      return;
    }
    const destinations = (itemDestinations[item.id] ?? []).filter((platform) => myConnectedPlatforms.includes(platform));
    if (destinations.length === 0) {
      setPostsStatus({ tone: "error", message: "Select at least one connected destination before approving." });
      return;
    }
    const scheduledAtInput = itemScheduledAt[item.id];
    const scheduledAtIso = scheduledAtInput ? new Date(scheduledAtInput).toISOString() : new Date().toISOString();

    setApprovingItemId(item.id);
    setPostsStatus({ tone: "progress", message: "Approving…" });
    let approvedAny = false;
    let replacedAny = false;
    let failureMessage = "";
    try {
      for (const platform of destinations) {
        const body = (platform === "x" ? item.xText : item.telegramText).trim();
        if (!body) {
          failureMessage = `Add ${platformLabel(platform)} text before approving it.`;
          break;
        }
        if (platform === "x" && body.length > 280) {
          failureMessage = `X posts must be 280 characters or fewer. Remove ${body.length - 280} characters.`;
          break;
        }
        try {
          const auth = await signSocialStudioChallenge(SOCIAL_STUDIO_ACTION_PURPOSES.postCreate, {
            body,
            destinations: platform,
            scheduledAt: scheduledAtIso,
          });
          const response = await fetch("/api/social/posts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              body,
              projectId: selectedProject.id,
              displayName: selectedProject.name,
              artworkDataUrl: item.artwork || undefined,
              destinations: [platform],
              scheduledAt: scheduledAtIso,
              challengeId: auth.challengeId,
              nonce: auth.nonce,
              signature: auth.signature,
            }),
          });
          const payload = await readJsonResponse<{ post?: unknown; replacedPostId?: string | null }>(
            response,
            `${platformLabel(platform)} approval failed.`,
          );
          if (payload.replacedPostId) replacedAny = true;
          approvedAny = true;
          void loadSlotUsage();
        } catch (error) {
          failureMessage = error instanceof Error ? error.message : `${platformLabel(platform)} approval failed.`;
          break;
        }
      }
    } finally {
      setApprovingItemId(null);
    }

    if (approvedAny) {
      removeQueueItem(item.id, { silent: true });
      await loadScheduledPosts();
      void replenishQueue();
    }
    const approvedMessage = replacedAny
      ? "Approved — replaced an already-pending duplicate of this exact draft instead of sending twice."
      : "Approved and scheduled.";
    setPostsStatus(
      approvedAny
        ? { tone: "success", message: failureMessage ? `Approved, but ${failureMessage.charAt(0).toLowerCase()}${failureMessage.slice(1)}` : approvedMessage }
        : { tone: "error", message: failureMessage || "Approval failed." },
    );
  }

  async function cancelScheduledPost(postId: string) {
    setCancelingPostId(postId);
    setPostsStatus({ tone: "progress", message: "Canceling…" });
    try {
      const auth = await signSocialStudioChallenge(SOCIAL_STUDIO_ACTION_PURPOSES.postCancel, { postId });
      const response = await fetch("/api/social/posts/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId, challengeId: auth.challengeId, nonce: auth.nonce, signature: auth.signature }),
      });
      await readJsonResponse<{ ok?: boolean }>(response, "Could not cancel that post.");
      setPostsStatus({ tone: "success", message: "Post canceled." });
      await loadScheduledPosts();
    } catch (error) {
      setPostsStatus({ tone: "error", message: error instanceof Error ? error.message : "Could not cancel that post." });
    } finally {
      setCancelingPostId(null);
    }
  }

  function openComposerForPost(post: ScheduledPostSummary) {
    window.open(buildXIntentUrl(post.body), "_blank", "noopener,noreferrer");
    setStatus("X composer opened with the approved post filled in.");
  }

  function setReschedulePostValue(postId: string, value: string) {
    setRescheduleValues((current) => ({ ...current, [postId]: value }));
  }

  /**
   * Moves an already-approved, not-yet-sent post to a new time (issue #380
   * — previously the datetime picker here had nothing to submit to).
   * POST /api/social/posts/reschedule cancels the old row and creates a
   * fresh one at the new time, so the change shows up in History as
   * canceled -> new rather than silently rewriting what was approved.
   */
  async function reschedulePost(post: ScheduledPostSummary) {
    const value = rescheduleValues[post.id];
    if (!value) {
      setPostsStatus({ tone: "error", message: "Pick a new time before rescheduling." });
      return;
    }
    const scheduledAtIso = new Date(value).toISOString();
    setReschedulingPostId(post.id);
    setPostsStatus({ tone: "progress", message: "Rescheduling…" });
    try {
      const auth = await signSocialStudioChallenge(SOCIAL_STUDIO_ACTION_PURPOSES.postReschedule, { postId: post.id, scheduledAt: scheduledAtIso });
      const response = await fetch("/api/social/posts/reschedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId: post.id, scheduledAt: scheduledAtIso, challengeId: auth.challengeId, nonce: auth.nonce, signature: auth.signature }),
      });
      await readJsonResponse<{ post?: unknown }>(response, "Could not reschedule that post.");
      setPostsStatus({ tone: "success", message: "Rescheduled." });
      setRescheduleValues((current) => {
        const next = { ...current };
        delete next[post.id];
        return next;
      });
      await loadScheduledPosts();
    } catch (error) {
      setPostsStatus({ tone: "error", message: error instanceof Error ? error.message : "Could not reschedule that post." });
    } finally {
      setReschedulingPostId(null);
    }
  }

  /**
   * Posting cadence is single-select (issue #358) and drives two things at
   * once: the Ready-to-review replenish target, and (via the effect below)
   * the default schedule-time spread for newly-approved drafts.
   */
  function updatePostingCadence(cadence: PostingCadence) {
    const nextTarget = cadenceQueueTarget(cadence);
    setPostingCadence(cadence);
    setQueueTarget(nextTarget);
    persistSocialStudio({ postingCadence: cadence, queueTarget: nextTarget });
  }

  function toggleQueueItemExpanded(id: string) {
    setExpandedQueueItemIds((current) => ({ ...current, [id]: !current[id] }));
    clearApprovalConfirmation(id);
  }

  // Fills in a default destination selection and schedule time for any
  // Ready-to-review draft that doesn't have one yet (new drafts from
  // Setup/Calendar/replenish, or connections that just finished loading) —
  // never overwrites a selection the user already made.
  useEffect(() => {
    const awaitingIso = scheduledPosts.filter((post) => isPendingSendStatus(post.status)).map((post) => post.scheduledAt);
    setItemDestinations((current) => {
      let changed = false;
      const next = { ...current };
      for (const item of queue) {
        if (next[item.id] === undefined) {
          next[item.id] = [...myConnectedPlatforms];
          changed = true;
        }
      }
      return changed ? next : current;
    });
    setItemScheduledAt((current) => {
      let changed = false;
      const next = { ...current };
      for (const item of queue) {
        if (next[item.id] === undefined) {
          next[item.id] = toDateTimeLocalValue(
            computeDefaultScheduledAt(awaitingIso, new Date(), cadenceSpreadHoursMs(postingCadence)),
          );
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [queue, myConnectedPlatforms, scheduledPosts, postingCadence]);

  // Queue tab data is fetched client-side only (never in the background) on
  // tab open, on window/tab focus while the tab is active, and after
  // approve/cancel actions elsewhere — issue #352's explicit "replenish on
  // app open / tab focus" boundary, not a poller or a server cron.
  useEffect(() => {
    if (activeTab !== "queue") return;
    void loadScheduledPosts();
    // Re-fetches connections on Queue-tab activation too (issue #384), on
    // top of the always-on window-focus healer above — so switching into
    // Queue right after connecting in Setup never shows a stale toggle set.
    void loadConnections();
    void replenishQueue();

    function handleFocusOrVisible() {
      if (document.visibilityState === "hidden") return;
      void loadScheduledPosts();
      void loadConnections();
      void replenishQueue();
    }
    window.addEventListener("focus", handleFocusOrVisible);
    document.addEventListener("visibilitychange", handleFocusOrVisible);
    return () => {
      window.removeEventListener("focus", handleFocusOrVisible);
      document.removeEventListener("visibilitychange", handleFocusOrVisible);
    };
    // Re-runs only when the Queue tab is opened or the active project/wallet changes — loadScheduledPosts/loadConnections/replenishQueue close over the latest state on every render already.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, selectedProjectId, walletAddress]);

  function toggleMascotAction(label: string) {
    setCustomActionEntry(null);
    setSelectedMascotAction((current) => (current === label ? "" : label));
  }

  function toggleMascotPlace(label: string) {
    setCustomPlaceEntry(null);
    setSelectedMascotPlace((current) => (current === label ? "" : label));
  }

  function composeSceneInput(): string {
    const action = (customActionEntry ?? selectedMascotAction).trim();
    const place = (customPlaceEntry ?? selectedMascotPlace).trim();
    if (action && place) return `${action} at ${place}`;
    return action || place;
  }

  async function handleMascotFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const project = draftProjectPayload();
    if (!project) {
      setMascotUploadStatus({ tone: "error", message: "Choose a project before uploading mascot artwork." });
      return;
    }
    if (file.size > MAX_MASCOT_IMAGE_BYTES) {
      setMascotUploadStatus({ tone: "error", message: "That image is too large. Upload a mascot reference image under 3MB." });
      return;
    }

    setMascotBusy(true);
    setMascotUploadStatus({ tone: "progress", message: "Reading the mascot's visual identity…" });
    try {
      const imageDataUrl = await readFileAsDataUrl(file);
      const dimensions = await readImageDimensions(imageDataUrl);
      const assessment = assessMascotReference({ ...dimensions, mimeType: file.type });
      setMascotReferenceAssessment(assessment);
      const response = await fetch("/api/social/mascot/visual-dna", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress, projectId: selectedProject?.id, displayName: selectedProject?.name, project, imageDataUrl }),
      });
      const payload = (await response.json()) as { mascotVisualDNA?: MascotVisualDNA; error?: string };
      if (!response.ok || !payload.mascotVisualDNA) {
        throw new Error(payload.error || "The mascot artwork could not be analysed.");
      }
      void loadSlotUsage();
      setMascotVisualDNA(payload.mascotVisualDNA);
      setMascotReferenceImage(imageDataUrl);
      persistSocialStudio({ mascotVisualDNA: payload.mascotVisualDNA, mascotReferenceImage: imageDataUrl });
      setMascotUploadStatus({
        tone: "success",
        message:
          assessment.verdict === "great"
            ? "Mascot identity locked in. Choose a scene to generate artwork."
            : `Mascot identity locked in — ${assessment.summary} Choose a scene to generate artwork.`,
      });
    } catch (error) {
      setMascotUploadStatus({ tone: "error", message: error instanceof Error ? error.message : "The mascot artwork could not be analysed." });
    } finally {
      setMascotBusy(false);
    }
  }

  async function generateMascotScene() {
    const project = draftProjectPayload();
    const sceneInput = composeSceneInput();
    if (!project) {
      setMascotSceneStatus({ tone: "error", message: "Choose a project before generating a mascot scene." });
      return;
    }
    if (!mascotVisualDNA) {
      setMascotSceneStatus({ tone: "error", message: "Upload mascot artwork first so its visual identity can be locked in." });
      return;
    }
    if (!sceneInput) {
      setMascotSceneStatus({ tone: "error", message: "Choose or describe a scene for the mascot." });
      return;
    }

    setMascotImageBusy(true);
    setMascotSceneStatus({ tone: "progress", message: "Generating mascot scene artwork…" });
    try {
      const response = await fetch("/api/social/mascot/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress, projectId: selectedProject?.id, displayName: selectedProject?.name, project, mascotVisualDNA, sceneInput }),
      });
      const payload = (await response.json()) as { imageDataUrl?: string; error?: string };
      if (!response.ok || !payload.imageDataUrl) {
        throw new Error(payload.error || "The mascot scene image could not be generated.");
      }
      void loadSlotUsage();
      setGeneratedMascotImage(payload.imageDataUrl);
      setMascotSceneStatus({ tone: "success", message: "Mascot artwork ready — attach it to Telegram, download it, or add it to the Queue." });
    } catch (error) {
      setMascotSceneStatus({ tone: "error", message: error instanceof Error ? error.message : "The mascot scene image could not be generated." });
    } finally {
      setMascotImageBusy(false);
    }
  }

  function attachGeneratedArtwork() {
    if (!generatedMascotImage) return;
    setAttachedArtwork(generatedMascotImage);
    setIncludeArtwork(true);
    setMascotSceneStatus({ tone: "success", message: "Mascot artwork attached — it will be included the next time you post to Telegram." });
  }

  function downloadGeneratedArtwork() {
    if (!generatedMascotImage || !selectedProject) {
      setMascotSceneStatus({ tone: "error", message: "Generate mascot artwork before downloading it." });
      return;
    }
    const anchor = document.createElement("a");
    anchor.href = generatedMascotImage;
    anchor.download = `${selectedProject.websiteSlug || selectedProject.ticker || "token"}-mascot-scene.png`;
    anchor.click();
    setMascotSceneStatus({ tone: "success", message: "Mascot artwork downloaded. Attach it manually inside the X composer." });
  }

  function addGeneratedArtworkToQueue() {
    if (!generatedMascotImage) return;
    const item: QueueItem = {
      id: newQueueItemId(),
      xText: message,
      telegramText: telegramMessage || message,
      artwork: generatedMascotImage,
      source: "setup-ai",
      dayLabel: null,
      createdAt: new Date().toISOString(),
    };
    setQueue((current) => {
      const next = [item, ...current];
      persistSocialStudio({ queue: next });
      return next;
    });
    setMascotSceneStatus({ tone: "success", message: "Added to the Queue with its artwork." });
  }

  /** Clears a stale approval or quick-send confirmation (issue #380, extended #382) — any edit to what will be sent must be re-reviewed before it can be approved or quick-sent. */
  function clearApprovalConfirmation(id: string) {
    setPendingApprovalItemId((current) => (current === id ? null : current));
    setTemplateAcknowledgedIds((current) => (id in current ? { ...current, [id]: false } : current));
    setPendingQuickSendId((current) => (current?.itemId === id ? null : current));
  }

  function updateQueueItem(id: string, patch: Partial<QueueItem>) {
    setQueue((current) => {
      const next = current.map((item) => (item.id === id ? { ...item, ...patch } : item));
      persistSocialStudio({ queue: next });
      return next;
    });
    clearApprovalConfirmation(id);
  }

  function removeQueueItem(id: string, options: { silent?: boolean } = {}) {
    setQueue((current) => {
      const next = current.filter((item) => item.id !== id);
      persistSocialStudio({ queue: next });
      return next;
    });
    setItemDestinations((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
    setItemScheduledAt((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
    if (!options.silent) {
      setStatus("Removed from Ready to review.");
      void replenishQueue();
    }
  }

  function postQueueItemToX(item: QueueItem) {
    if (!item.xText.trim()) {
      setStatus("Write the X text before posting.");
      return;
    }
    if (item.xText.length > 280) {
      setStatus(`X posts must be 280 characters or fewer. Remove ${item.xText.length - 280} characters.`);
      return;
    }
    const url = `https://x.com/intent/post?text=${encodeURIComponent(item.xText)}`;
    window.open(url, "_blank", "noopener,noreferrer");
    setStatus("X composer opened with the queued post filled in.");
  }

  async function sendQueueItemToTelegram(item: QueueItem) {
    if (!selectedProject) {
      setStatus("Choose a project before publishing.");
      return;
    }
    if (!telegramConnection || telegramConnection.status !== "connected" || !item.telegramText.trim()) {
      setStatus("Connect a verified Telegram channel in Setup and add post text first.");
      return;
    }

    setBusy(true);
    setStatus("Sending the queued post through the Hoodlums Telegram bot…");
    try {
      const response = await fetch("/api/social/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId: telegramConnection.externalId,
          text: item.telegramText.trim(),
          artwork: item.artwork || "",
        }),
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Telegram rejected the post.");
      }
      setStatus("Queued post published through the Hoodlums Telegram bot.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Telegram publishing failed.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Quick-send is a two-tap action (issue #382), mirroring
   * handleApproveClick: the first tap never publishes anything — it force-
   * expands the card (so the exact text about to go to that destination is
   * visible) and records which item/platform is pending. Only the second
   * tap, once the button is already labeled "Confirm & …", actually calls
   * postQueueItemToX or sendQueueItemToTelegram. This closes the side door
   * PR #381's confirm-before-sign panel left open: quick-send previously
   * published item.xText/telegramText on a single, unreviewed tap.
   */
  function handleQuickSendClick(item: QueueItem, platform: SocialPlatform) {
    const isPending = pendingQuickSendId?.itemId === item.id && pendingQuickSendId.platform === platform;
    if (!isPending) {
      setExpandedQueueItemIds((current) => ({ ...current, [item.id]: true }));
      setPendingQuickSendId({ itemId: item.id, platform });
      return;
    }
    setPendingQuickSendId(null);
    if (platform === "x") {
      postQueueItemToX(item);
    } else {
      void sendQueueItemToTelegram(item);
    }
  }

  function goToMonth(delta: number) {
    setCalendarView((current) => shiftedMonth(current, delta));
  }

  function jumpToToday() {
    const now = new Date();
    setCalendarView({ year: now.getFullYear(), month: now.getMonth() });
    setSelectedDay({ year: now.getFullYear(), month: now.getMonth(), day: now.getDate() });
  }

  function selectDay(day: number) {
    setSelectedDay({ year: calendarView.year, month: calendarView.month, day });
  }

  function renderProjectArtwork(className: string, alt: string) {
    if (selectedProject?.heroImage) {
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img className={className} src={selectedProject.heroImage} alt={alt} />
      );
    }
    return <span className={styles.artworkFallback}>{projectInitial}</span>;
  }

  return (
    <main className={`${styles.shell} hoodlums-premium`}>
      <div className={styles.pageFrame}>
        <header className={styles.hero}>
          <div className={styles.heroBrand}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className={styles.socialWordmark}
              src="/hoodlums-social-wordmark.png"
              alt="Hoodlums Social"
            />
            <p>Prepare once. Review every destination. Publish without sharing passwords.</p>
          </div>

          <div className={styles.heroActions}>
            <span className={styles.proBadge}>{describePlanBadge(slotUsage)}</span>
            <div className={styles.projectPicker}>
              <button
                type="button"
                className={styles.projectPickerButton}
                onClick={() => setProjectMenuOpen((current) => !current)}
                disabled={projects.length === 0}
                aria-expanded={projectMenuOpen}
                aria-haspopup="listbox"
              >
                <span className={styles.projectPickerMark}>{projectInitial}</span>
                <span>{projectTicker}</span>
                <span className={styles.projectPickerChevron}>▼</span>
              </button>
              {projectMenuOpen ? (
                <div className={styles.projectMenu} role="listbox" aria-label="Saved project">
                  {projects.map((project) => (
                    <button
                      type="button"
                      key={project.id}
                      className={project.id === selectedProjectId ? styles.projectMenuActive : styles.projectMenuItem}
                      onClick={() => selectProject(project.id)}
                      role="option"
                      aria-selected={project.id === selectedProjectId}
                    >
                      <span className={styles.projectMenuMark}>
                        {project.heroImage ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={project.heroImage} alt="" />
                        ) : (
                          (project.name || "T").slice(0, 1).toUpperCase()
                        )}
                      </span>
                      <span>
                        <b>{project.name || "Untitled project"}</b>
                        <small>${project.ticker || "TOKEN"} · {project.chain}</small>
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </header>

        {selectedProject && slotUsageStatus === "loaded" && slotUsage ? (
          <div className={styles.slotUsageBar}>
            <span className={styles.slotUsageText}>
              {slotUsage.unlimited
                ? "Unlimited projects (test access)"
                : `Project ${slotUsage.activeCount} of ${slotUsage.limit ?? "?"} (${slotUsage.plan === "pro-bundle" ? "Pro Bundle" : "Pro"})`}
            </span>
            {!slotUsage.unlimited ? (
              releasePending ? (
                <div className={styles.slotUsageConfirm}>
                  <span>Release this plan slot? You can only do this once every 7 days.</span>
                  <button
                    type="button"
                    className={styles.slotUsageConfirmButton}
                    disabled={releaseBusy}
                    onClick={() => void releaseCurrentProjectSlot()}
                  >
                    {releaseBusy ? "Releasing…" : "Confirm release"}
                  </button>
                  <button
                    type="button"
                    className={styles.slotUsageCancelButton}
                    disabled={releaseBusy}
                    onClick={() => setReleasePending(false)}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button type="button" className={styles.slotUsageSwapButton} onClick={() => setReleasePending(true)}>
                  Use this plan slot for a different project
                </button>
              )
            ) : null}
            <InlineStatus status={releaseStatus} />
          </div>
        ) : null}

        {projects.length === 0 ? (
          <section className={styles.noProject}>
            <span>NO SAVED PROJECT</span>
            <h1>Save a token project before using Hoodlums Social.</h1>
            <p>Your existing project picker still reads the private browser vault used by the launch studio.</p>
            <Link href="/">Return to launch studio</Link>
          </section>
        ) : (
          <section className={styles.studioPanel}>
            <div className={styles.tabBar}>
              <div className={styles.tabs} role="tablist" aria-label="Hoodlums Social sections">
                {TABS.map((tab) => (
                  <button
                    type="button"
                    key={tab.id}
                    role="tab"
                    aria-selected={activeTab === tab.id}
                    className={activeTab === tab.id ? styles.tabActive : styles.tab}
                    onClick={() => setActiveTab(tab.id)}
                  >
                    <span className={styles.tabDesktop}>{tab.desktop}</span>
                    <span className={styles.tabMobile}>{tab.mobile}</span>
                  </button>
                ))}
              </div>
              <div className={styles.panelMeta}>
                <span className={styles.metaLabel}>TODAY</span>
                <span className={styles.metaPill}>
                  <b>
                    {postsScheduledToday}/{cadencePostsPerDay}
                  </b>{" "}
                  posts
                </span>
              </div>
            </div>

            <div className={styles.panelBody}>
              {activeTab === "setup" ? (
                <div className={styles.sectionStack}>
                  <section className={styles.block}>
                    <div className={styles.sectionHeading}>
                      <div>
                        <h2>Connect your accounts</h2>
                        <p>We post on your behalf. You never hand over a password.</p>
                      </div>
                    </div>
                    <div className={styles.twoCols}>
                      <article className={styles.connectionCard}>
                        <div className={styles.connectionCardTop}>
                          <span className={styles.xIcon}><XMark /></span>
                          <div>
                            <b>X</b>
                            <span>{xHandle ? `${xHandle} · not connected yet` : "Not connected yet"}</span>
                          </div>
                          <button
                            type="button"
                            className={styles.connectionActionPrimary}
                            disabled
                            title="Connecting X isn't switched on yet. Until it is, use “Post to X” below — it opens X's own composer with your text filled in, so you tap send yourself."
                          >
                            Connect X
                          </button>
                        </div>
                      </article>
                      <article className={styles.connectionCard}>
                        <div className={styles.connectionCardTop}>
                          <span className={styles.telegramIcon}><TelegramMark /></span>
                          <div>
                            <b>Telegram</b>
                            <span>
                              {telegramConfigured === false
                                ? "Server bot not configured"
                                : telegramConnection?.status === "connected"
                                  ? telegramConnection.displayName
                                  : telegramConnection?.status === "reconnect_needed"
                                    ? "Needs reconnecting"
                                    : "Not connected yet"}
                            </span>
                          </div>
                          {telegramConnection?.status === "connected" ? (
                            <button
                              type="button"
                              className={styles.connectionAction}
                              onClick={disconnectTelegramChannel}
                              disabled={telegramConnectBusy}
                            >
                              {telegramConnectBusy ? "Disconnecting…" : "Disconnect"}
                            </button>
                          ) : telegramConfigured ? (
                            <button
                              type="button"
                              className={styles.connectionActionPrimary}
                              aria-expanded={telegramConnectOpen}
                              onClick={() => setTelegramConnectOpen((current) => !current)}
                            >
                              {telegramConnection?.status === "reconnect_needed" ? "Reconnect" : "Connect Telegram"}
                            </button>
                          ) : (
                            <span className={telegramConfigured === false ? styles.connectionStateError : styles.connectionState}>
                              {telegramConfigured === null ? "Checking…" : "Not configured"}
                            </span>
                          )}
                        </div>

                        {telegramConfigured && telegramConnection?.status !== "connected" && telegramConnectOpen ? (
                          <div className={styles.connectionDrawer}>
                            <label className={styles.connectionField}>
                              <span>Channel username or chat ID</span>
                              <input
                                value={telegramConnectInput}
                                onChange={(event) => setTelegramConnectInput(event.target.value)}
                                placeholder="@yourchannel or -1001234567890"
                                disabled={telegramConnectBusy}
                              />
                            </label>
                            <p className={styles.connectionHelper}>
                              {telegramConnection?.status === "reconnect_needed" && telegramConnection.reconnectReason
                                ? telegramConnection.reconnectReason
                                : walletAddress
                                  ? "Add the Hoodlums bot as an admin in your channel first, then connect it here."
                                  : "Connect your wallet first, then link a Telegram channel here."}
                            </p>
                            <button
                              type="button"
                              className={styles.connectionActionPrimary}
                              onClick={connectTelegramChannel}
                              disabled={telegramConnectBusy || !walletAddress}
                            >
                              {telegramConnectBusy ? "Verifying…" : "Verify & connect"}
                            </button>
                          </div>
                        ) : null}
                        <details className={styles.connectionOptions}>
                          <summary>Options</summary>
                          <label className={styles.checkbox}>
                            <input
                              type="checkbox"
                              checked={includeArtwork}
                              onChange={(event) => setIncludeArtwork(event.target.checked)}
                            />
                            <span>Include project artwork when available</span>
                          </label>
                          {telegramConfigured === false ? (
                            <p className={styles.connectionHelper}>
                              The Hoodlums Telegram bot isn&apos;t set up on this deployment yet. Ask the site owner to set{" "}
                              <code>TELEGRAM_BOT_TOKEN</code> (and optionally <code>TELEGRAM_BOT_USERNAME</code>) in Vercel.
                            </p>
                          ) : null}
                        </details>
                        <InlineStatus status={telegramStatus} />
                      </article>
                    </div>
                  </section>

                  <div className={styles.divider} />

                  <section className={styles.block}>
                    <div className={styles.sectionHeading}>
                      <div>
                        <span className={styles.eyebrow}>PICK A HOODLUMS BOT</span>
                        <p>Choose one of our bots and add it to your channel. Each bot posts into a channel of its own.</p>
                      </div>
                    </div>
                    <div className={styles.botList}>
                      {BOTS.map((bot) => (
                        <div className={styles.botRow} key={bot.name}>
                          <div className={styles.botRowHead}>
                            <span className={styles.botMark} aria-hidden="true">{bot.mark}</span>
                            <div className={styles.botRowInfo}>
                              <b>{bot.name}</b>
                              <em>{bot.kind}</em>
                            </div>
                            {bot.name !== "Buy Bot" ? <ComingSoon compact /> : null}
                          </div>
                          <p>{bot.description}</p>
                          {bot.name !== "Buy Bot" ? (
                            <button type="button" disabled>Add to your channel</button>
                          ) : selectedBuyBot && selectedBuyBot.status !== "reconnect_needed" ? (
                            <div className={styles.botLive}>
                              <span className={selectedBuyBot.status === "active" ? styles.botLiveState : styles.botPausedState}>
                                {selectedBuyBot.status === "active" ? "Live" : "Paused"} · {selectedBuyBot.channelDisplayName}
                              </span>
                              <label className={styles.buyAlertThreshold}>
                                <span>Only above</span>
                                <select
                                  value={selectedBuyBot.thresholdWei}
                                  disabled={buyBotBusy}
                                  onChange={(event) => void updateBuyBot({ thresholdWei: event.target.value })}
                                >
                                  {BUY_BOT_THRESHOLD_PRESETS.map((preset) => (
                                    <option key={preset.wei} value={preset.wei}>{preset.label}</option>
                                  ))}
                                </select>
                              </label>
                              <div className={styles.botActions}>
                                <button
                                  type="button"
                                  onClick={() => void updateBuyBot({ status: selectedBuyBot.status === "active" ? "paused" : "active" })}
                                  disabled={buyBotBusy}
                                >
                                  {selectedBuyBot.status === "active" ? "Pause" : "Resume"}
                                </button>
                                <button type="button" onClick={() => void disableBuyBot()} disabled={buyBotBusy}>
                                  Remove
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              {selectedBuyBot?.status === "reconnect_needed" ? (
                                <p className={styles.botWarning}>
                                  {selectedBuyBot.lastError || "The bot can no longer post in its channel."} Add it again below, or remove it.
                                </p>
                              ) : null}
                              <button
                                type="button"
                                className={styles.botActionPrimary}
                                aria-expanded={buyBotDrawerOpen}
                                disabled={Boolean(buyBotUnavailableReason) || telegramConfigured === false}
                                title={buyBotUnavailableReason ?? undefined}
                                onClick={() => setBuyBotDrawerOpen((current) => !current)}
                              >
                                {selectedBuyBot?.status === "reconnect_needed" ? "Add again" : "Add to your channel"}
                              </button>
                              {buyBotUnavailableReason ? <p className={styles.botHint}>{buyBotUnavailableReason}</p> : null}
                              {buyBotDrawerOpen && !buyBotUnavailableReason ? (
                                <div className={styles.connectionDrawer}>
                                  <label className={styles.connectionField}>
                                    <span>Channel username or chat ID</span>
                                    <input
                                      value={buyBotChannelInput}
                                      onChange={(event) => setBuyBotChannelInput(event.target.value)}
                                      placeholder="@yourbuyschannel or -1001234567890"
                                      disabled={buyBotBusy}
                                    />
                                  </label>
                                  <label className={styles.buyAlertThreshold}>
                                    <span>Only above</span>
                                    <select value={buyBotThresholdWei} disabled={buyBotBusy} onChange={(event) => setBuyBotThresholdWei(event.target.value)}>
                                      {BUY_BOT_THRESHOLD_PRESETS.map((preset) => (
                                        <option key={preset.wei} value={preset.wei}>{preset.label}</option>
                                      ))}
                                    </select>
                                  </label>
                                  <p className={styles.connectionHelper}>
                                    Add the Hoodlums bot as an admin in that channel first. Only buys after you add it are announced — never old ones.
                                  </p>
                                  <button
                                    type="button"
                                    className={`${styles.connectionActionPrimary} ${styles.botActionPrimary}`}
                                    onClick={() => void enableBuyBot()}
                                    disabled={buyBotBusy}
                                  >
                                    {buyBotBusy ? "Verifying…" : "Verify & add"}
                                  </button>
                                </div>
                              ) : null}
                              {selectedBuyBot?.status === "reconnect_needed" ? (
                                <div className={styles.botActions}>
                                  <button type="button" onClick={() => void disableBuyBot()} disabled={buyBotBusy}>
                                    Remove
                                  </button>
                                </div>
                              ) : null}
                            </>
                          )}
                          {bot.name === "Buy Bot" ? <InlineStatus status={buyBotStatus} /> : null}
                        </div>
                      ))}
                    </div>
                  </section>

                  <div className={styles.divider} />

                  <section className={`${styles.twoColsTop} ${styles.voiceRow}`}>
                    <div className={styles.blockInner}>
                      <div className={styles.sectionHeading}>
                        <div>
                          <h2>Teach the AI your voice</h2>
                          <p>Drop in posts you like the sound of. The more you add, the better it sounds — 20 is ideal.</p>
                        </div>
                      </div>
                      <div className={styles.insetPanel}>
                        <textarea
                          value={voiceDraftText}
                          onChange={(event) => setVoiceDraftText(event.target.value)}
                          placeholder="Paste one post here — several is fine if each has its name and @handle above it"
                          rows={5}
                        />
                        <div className={styles.disabledActions}>
                          <button type="button" onClick={noteScreenshotsUnavailable}>Upload screenshots</button>
                          <span>
                            {voiceExampleFilter.pastedLineCount > 0
                              ? `${voiceExampleCount} usable / ${voiceExampleFilter.pastedLineCount} pasted`
                              : `${voiceExampleCount} / ${VOICE_EXAMPLE_TARGET} examples`}
                          </span>
                          <button
                            type="button"
                            className={styles.voiceLearnButton}
                            onClick={addVoiceExampleFromBox}
                            disabled={!voiceDraftText.trim() || voiceExamples.length >= VOICE_EXAMPLE_TARGET}
                          >
                            Add example
                          </button>
                        </div>
                      </div>
                      <InlineStatus status={voiceAddStatus} />
                      {voiceExamples.length > 0 ? (
                        <ul className={styles.exampleList}>
                          {voiceExamples.map((example, index) => (
                            <li className={styles.exampleRow} key={`${index}-${example.slice(0, 24)}`}>
                              <p>{example}</p>
                              <button
                                type="button"
                                aria-label={`Delete example ${index + 1}`}
                                onClick={() => removeVoiceExample(index)}
                              >
                                ×
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {voiceExampleFilter.rejectedCount > 0 ? (
                        <p className={styles.exampleLabel}>
                          {voiceExampleFilter.rejectedCount} pasted line{voiceExampleFilter.rejectedCount === 1 ? "" : "s"} skipped as too
                          short, page furniture, or duplicates.
                        </p>
                      ) : (
                        <p className={styles.exampleLabel}>Screenshot-to-text isn&apos;t available yet — paste post text above instead.</p>
                      )}
                      <div className={styles.progressRow}>
                        <div>
                          <span>EXAMPLES ADDED</span>
                          <b>
                            {voiceExampleCount} / {VOICE_EXAMPLE_TARGET}
                          </b>
                        </div>
                        <div className={styles.progressTrack}><span style={{ width: `${voiceProgressPercent}%` }} /></div>
                        <p className={styles.voiceHint}>{voiceTrainingHint(voiceExampleCount)}</p>
                      </div>
                      <div className={styles.voiceLearnRow}>
                        <button
                          type="button"
                          className={styles.voiceLearnButton}
                          onClick={buildVoiceProfile}
                          disabled={voiceBusy || voiceExampleCount < MIN_USABLE_VOICE_EXAMPLES}
                        >
                          {voiceBusy ? "Learning your voice…" : "Learn my voice"}
                        </button>
                        <span>Builds the voice profile from every example above.</span>
                      </div>
                      <InlineStatus status={voiceStatus} />
                      <p className={styles.limeNote}>
                        <i aria-hidden="true">i</i>
                        <span>
                          Your examples teach <b>style only</b>. The AI will never copy their content, names, tags or tickers — it only
                          ever talks about YOUR project.
                        </span>
                      </p>
                    </div>

                    <div className={styles.blockInner}>
                      <div className={styles.sectionHeading}>
                        <div>
                          <h2>Voice preview</h2>
                          <p>Here&apos;s how it would sound writing about your project.</p>
                        </div>
                      </div>
                      {voiceProfile ? (
                        <p className={styles.exampleLabel}>
                          Tone: {voiceProfile.tone} · Vocabulary: {voiceProfile.vocabulary} · Cadence: {voiceProfile.cadence} · Emoji: {voiceProfile.emojiHabits}
                        </p>
                      ) : null}

                      <div className={styles.bankBar}>
                        <div className={styles.bankMeta}>
                          <span>PERSONA</span>
                          <b>
                            {personaKept.length}/{PERSONA_BANK_SIZE} kept
                          </b>
                          {personaFireCount > 0 ? <em>🔥 {personaFireCount} on fire</em> : null}
                        </div>
                        <div className={styles.bankActions}>
                          <button type="button" onClick={() => clearBank("half")} disabled={personaKept.length === 0}>
                            {bankClearConfirm === "half" ? "Tap again to clear 50%" : "Clear 50%"}
                          </button>
                          <button type="button" onClick={() => clearBank("all")} disabled={personaKept.length === 0}>
                            {bankClearConfirm === "all" ? "Tap again to clear all" : "Clear all"}
                          </button>
                        </div>
                      </div>
                      {personaBankFull ? (
                        <p className={styles.exampleLabel}>
                          Your persona bank is full at {PERSONA_BANK_SIZE}. Fire and Sounds right are paused until you clear 50% or
                          clear all.
                        </p>
                      ) : null}

                      {stationSamples.length > 0 ? (
                        <div className={styles.stationList}>
                          {stationSamples.map((sample) => (
                            <article className={styles.stationCard} key={sample.id}>
                              <p>{sample.text}</p>
                              <div className={styles.stationActions}>
                                <button
                                  type="button"
                                  className={styles.stationFire}
                                  disabled={personaBankFull}
                                  aria-label="Fire: keep this line in the protected half of your persona bank"
                                  onClick={() => sortStationSample(sample, "fire")}
                                >
                                  🔥 Fire
                                </button>
                                <button
                                  type="button"
                                  className={styles.stationKeep}
                                  disabled={personaBankFull}
                                  aria-label="Sounds right: keep this line in your persona bank"
                                  onClick={() => sortStationSample(sample, "liked")}
                                >
                                  Sounds right
                                </button>
                                <button
                                  type="button"
                                  className={styles.stationBin}
                                  aria-label="Bin: discard this line"
                                  onClick={() => sortStationSample(sample, "disliked")}
                                >
                                  Bin
                                </button>
                              </div>
                            </article>
                          ))}
                        </div>
                      ) : (
                        <div className={styles.previewEmpty}>
                          <span>SORTING STATION</span>
                          {voiceExampleCount < MIN_USABLE_VOICE_EXAMPLES ? (
                            <>
                              <b>Paste a few of your posts first.</b>
                              <p>Each one gets reshaped to {selectedProject?.name ?? "your project"} in its own voice, then you sort it: Fire, Sounds right, or Bin.</p>
                            </>
                          ) : stationSupply.length === 0 && stationBusyCount === 0 ? (
                            <>
                              <b>Every pasted post has been through the station.</b>
                              <p>Paste more posts on the left to keep building the persona.</p>
                            </>
                          ) : (
                            <>
                              <b>Ready to sort.</b>
                              <p>{stationSupply.length} of your posts are waiting. Each is reshaped to {selectedProject?.name ?? "your project"} — one small AI call per sample.</p>
                              <button
                                type="button"
                                className={styles.voiceLearnButton}
                                onClick={() => fillSortingStation()}
                                disabled={stationBusyCount > 0 || personaBankFull || !walletAddress}
                              >
                                {stationBusyCount > 0 ? "Reshaping…" : "Start sorting"}
                              </button>
                            </>
                          )}
                        </div>
                      )}
                      <InlineStatus status={stationStatus} />
                    </div>
                  </section>

                  <div className={styles.divider} />

                  <section className={styles.block}>
                    <button
                      type="button"
                      className={styles.accordionHeader}
                      onClick={() => setComposeOpen((current) => !current)}
                      aria-expanded={composeOpen}
                      aria-controls="compose-panel"
                    >
                      <div>
                        <h2>Compose now</h2>
                        <p>Choose a post type, review it, then approve X and/or Telegram.</p>
                      </div>
                      <div className={styles.accordionHeaderRight}>
                        <span className={xReady ? styles.characterReady : styles.characterWarning}>{xCharacterCount}/280</span>
                        <span className={composeOpen ? styles.accordionChevronOpen : styles.accordionChevron}>▼</span>
                      </div>
                    </button>

                    {composeOpen ? (
                      <div id="compose-panel" className={styles.accordionBody}>
                        <div className={styles.composeGrid}>
                          <aside className={styles.templatePanel}>
                            <span className={styles.eyebrow}>POST TYPE</span>
                            <div className={styles.templateList}>
                              {TEMPLATES.map((template) => (
                                <button
                                  type="button"
                                  key={template.id}
                                  className={template.id === templateId ? styles.templateActive : styles.template}
                                  onClick={() => chooseTemplate(template.id)}
                                >
                                  <b>{template.label}</b>
                                  <span>{template.description}</span>
                                </button>
                              ))}
                            </div>
                          </aside>

                          <div className={styles.composerPanel}>
                            <div className={styles.projectSummary}>
                              <span className={styles.summaryArtwork}>
                                {renderProjectArtwork(styles.summaryImage, `${selectedProject?.name || "Token"} artwork`)}
                              </span>
                              <span>
                                <b>{selectedProject?.name || "Untitled project"}</b>
                                <small>
                                  ${projectTicker} · {selectedProject?.chain}
                                  {selectedProject?.contractAddress
                                    ? ` · ${shortAddress(selectedProject.contractAddress)}`
                                    : " · contract pending"}
                                </small>
                              </span>
                            </div>
                            <textarea
                              value={message}
                              onChange={(event) => setMessage(event.target.value)}
                              placeholder="Write the announcement…"
                              rows={9}
                            />
                            <label className={styles.connectionField}>
                              <span>Telegram version (optional — defaults to the same text)</span>
                              <textarea
                                value={telegramMessage}
                                onChange={(event) => setTelegramMessage(event.target.value)}
                                placeholder="Leave blank to send the same text to Telegram"
                                rows={3}
                              />
                            </label>
                            <div className={styles.composerActions}>
                              <button type="button" onClick={saveDraft}>Save draft</button>
                              <button type="button" onClick={copyPost}>Copy post</button>
                              <button type="button" onClick={downloadArtwork} disabled={!selectedProject?.heroImage}>
                                Download artwork
                              </button>
                              <button type="button" onClick={generateDraftFromSetup} disabled={draftBusy}>
                                {draftBusy ? "Drafting…" : "Draft with AI"}
                              </button>
                            </div>
                            <InlineStatus status={setupDraftStatus} />
                          </div>
                        </div>

                        <div className={styles.postActions}>
                          <button type="button" className={styles.xButton} onClick={openXComposer} disabled={!xReady}>
                            <XMark /> Approve &amp; open X composer
                          </button>
                          <button
                            type="button"
                            className={styles.telegramButton}
                            onClick={postTelegram}
                            disabled={!telegramReady || busy}
                          >
                            <TelegramMark /> {busy ? "Publishing…" : "Approve & post to Telegram"}
                          </button>
                        </div>

                        <div className={styles.publishBar}>
                          <div>
                            <b>Publish to both</b>
                            <span>Opens X for your final click, then sends the approved Telegram post.</span>
                          </div>
                          <button type="button" onClick={publishBoth} disabled={!xReady || !telegramReady || busy}>
                            APPROVE BOTH DESTINATIONS
                          </button>
                        </div>

                        <div className={styles.statusBar} role="status" aria-live="polite">
                          <span>●</span>
                          <p>{status}</p>
                        </div>
                      </div>
                    ) : null}
                  </section>

                  <div className={styles.divider} />

                  <section className={styles.block}>
                    <div className={styles.sectionHeading}>
                      <div>
                        <h2>Your mascot</h2>
                        <p>Upload your character once. Every image we make features them — and only them.</p>
                      </div>
                    </div>
                    <div className={styles.mascotGrid}>
                      <div className={styles.mascotOptions}>
                        <div>
                          <span className={styles.eyebrow}>WHAT SHOULD YOUR MASCOT BE DOING?</span>
                          <div className={styles.chips}>
                            {MASCOT_ACTIONS.map((label) => (
                              <button
                                type="button"
                                key={label}
                                className={selectedMascotAction === label ? styles.chipSelected : undefined}
                                onClick={() => toggleMascotAction(label)}
                              >
                                {label}
                              </button>
                            ))}
                            {customActionEntry === null ? (
                              <button type="button" className={styles.dashedChip} onClick={() => setCustomActionEntry("")}>
                                add your own…
                              </button>
                            ) : (
                              <input
                                autoFocus
                                value={customActionEntry}
                                onChange={(event) => setCustomActionEntry(event.target.value)}
                                onBlur={() => { if (!customActionEntry.trim()) setCustomActionEntry(null); }}
                                placeholder="e.g. skateboarding"
                                className={styles.chipInput}
                              />
                            )}
                          </div>
                        </div>
                        <div>
                          <span className={styles.eyebrow}>WHERE SHOULD YOUR MASCOT SHOW UP?</span>
                          <div className={styles.chips}>
                            {MASCOT_PLACES.map((label) => (
                              <button
                                type="button"
                                key={label}
                                className={selectedMascotPlace === label ? styles.chipSelected : undefined}
                                onClick={() => toggleMascotPlace(label)}
                              >
                                {label}
                              </button>
                            ))}
                            {customPlaceEntry === null ? (
                              <button type="button" className={styles.dashedChip} onClick={() => setCustomPlaceEntry("")}>
                                add your own…
                              </button>
                            ) : (
                              <input
                                autoFocus
                                value={customPlaceEntry}
                                onChange={(event) => setCustomPlaceEntry(event.target.value)}
                                onBlur={() => { if (!customPlaceEntry.trim()) setCustomPlaceEntry(null); }}
                                placeholder="e.g. rooftop"
                                className={styles.chipInput}
                              />
                            )}
                          </div>
                        </div>
                        <p>Your mascot is always the only character in generated images.</p>
                        <button
                          type="button"
                          className={styles.aiMakeButton}
                          onClick={generateMascotScene}
                          disabled={mascotImageBusy || !mascotVisualDNA || !composeSceneInput()}
                        >
                          <b>{mascotImageBusy ? "Generating…" : "Generate mascot image"}</b>
                          <span>Uses the locked mascot identity and the scene chosen above.</span>
                        </button>
                        {generatedMascotImage ? (
                          <div className={styles.insetPanel}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img className={styles.summaryImage} src={generatedMascotImage} alt="Generated mascot scene" />
                            <div className={styles.composerActions}>
                              <button type="button" onClick={attachGeneratedArtwork}>Attach to Telegram</button>
                              <button type="button" onClick={downloadGeneratedArtwork}>Download image</button>
                              <button type="button" onClick={addGeneratedArtworkToQueue}>Add to Queue</button>
                            </div>
                          </div>
                        ) : null}
                        <InlineStatus status={mascotSceneStatus} />
                      </div>
                      <div className={styles.mascotDrop}>
                        {mascotReferenceImage ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img className={styles.mascotInitial} src={mascotReferenceImage} alt="Mascot reference" />
                        ) : (
                          <span className={styles.mascotInitial}>{projectInitial}</span>
                        )}
                        <b>{mascotVisualDNA ? "Mascot identity locked in" : "Upload mascot artwork"}</b>
                        <p>PNG, JPG or WEBP, under 3MB</p>
                        <details className={styles.mascotTips} open={!mascotReferenceImage}>
                          <summary>For best results</summary>
                          <ul>
                            {MASCOT_REFERENCE_TIPS.map((tip) => (
                              <li key={tip}>{tip}</li>
                            ))}
                          </ul>
                          <p>Whatever you upload, we&apos;ll do our best with it — these just make the mascot sharper.</p>
                        </details>
                        {mascotReferenceAssessment && mascotReferenceAssessment.notes.length > 0 ? (
                          <div className={styles.mascotNotes} data-verdict={mascotReferenceAssessment.verdict}>
                            <b>{mascotReferenceAssessment.summary}</b>
                            <ul>
                              {mascotReferenceAssessment.notes.map((note) => (
                                <li key={note}>{note}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                        <input
                          ref={mascotFileInputRef}
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          className={styles.srOnly}
                          onChange={handleMascotFileChange}
                        />
                        <button type="button" onClick={() => mascotFileInputRef.current?.click()} disabled={mascotBusy}>
                          {mascotBusy ? "Analysing…" : mascotVisualDNA ? "Replace image" : "Choose image"}
                        </button>
                        <InlineStatus status={mascotUploadStatus} />
                      </div>
                    </div>
                  </section>
                </div>
              ) : null}

              {activeTab === "calendar" ? (
                <div className={styles.sectionStack}>
                  <section className={styles.block}>
                    <div className={styles.calendarHeading}>
                      <div>
                        <div className={styles.calendarMonthNav}>
                          <button
                            type="button"
                            className={styles.calendarNavButton}
                            onClick={() => goToMonth(-1)}
                            aria-label="Previous month"
                          >
                            ‹
                          </button>
                          <h2>{MONTH_NAMES[calendarView.month]} {calendarView.year}</h2>
                          <button
                            type="button"
                            className={styles.calendarNavButton}
                            onClick={() => goToMonth(1)}
                            aria-label="Next month"
                          >
                            ›
                          </button>
                          {!isCurrentMonthView ? (
                            <button type="button" className={styles.calendarTodayButton} onClick={jumpToToday}>
                              Jump to today
                            </button>
                          ) : null}
                        </div>
                        <p>Tap a day to add something. Lime days will hold launches or announcements.</p>
                      </div>
                      <div className={styles.timezoneControl}>
                        <span>ALL TIMES SHOWN IN</span>
                        <select value={timezoneId} onChange={(event) => setTimezoneId(event.target.value)}>
                          {TIMEZONES.map((timezone) => (
                            <option key={timezone.id} value={timezone.id}>{timezone.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className={styles.calendarLayout}>
                      <div>
                        <div className={styles.desktopCalendar}>
                          {CALENDAR_DAY_NAMES.map((day) => <span key={day}>{day}</span>)}
                          {monthGrid.map((day, index) => {
                            const isToday = day !== null && isCurrentMonthView && day === now.getDate();
                            const isSelected =
                              day !== null &&
                              selectedDay.year === calendarView.year &&
                              selectedDay.month === calendarView.month &&
                              day === selectedDay.day;
                            const className = day === null
                              ? styles.calendarBlank
                              : [styles.calendarDay, isToday && styles.calendarToday, isSelected && styles.calendarSelected]
                                  .filter(Boolean)
                                  .join(" ");
                            return (
                              <button
                                type="button"
                                disabled={day === null}
                                key={`${calendarView.year}-${calendarView.month}-${day ?? "blank"}-${index}`}
                                className={className}
                                onClick={day !== null ? () => selectDay(day) : undefined}
                              >
                                {day}
                              </button>
                            );
                          })}
                        </div>
                        <div className={styles.mobileWeek}>
                          {monthDays.map((day) => {
                            const weekdayIndex = (new Date(calendarView.year, calendarView.month, day).getDay() + 6) % 7;
                            const isToday = isCurrentMonthView && day === now.getDate();
                            const isSelected =
                              selectedDay.year === calendarView.year &&
                              selectedDay.month === calendarView.month &&
                              day === selectedDay.day;
                            return (
                              <button
                                type="button"
                                key={day}
                                onClick={() => selectDay(day)}
                                className={isSelected ? styles.weekSelected : isToday ? styles.weekToday : styles.weekDay}
                              >
                                <span>{CALENDAR_DAY_NAMES[weekdayIndex]}</span>
                                <b>{day}</b>
                                <small>{isToday ? "Today" : "No scheduled posts"}</small>
                              </button>
                            );
                          })}
                        </div>
                        <div className={styles.calendarLegend}>
                          <span><i className={styles.limeDot} />Announcement or launch</span>
                          <span><i className={styles.greyDot} />Scheduled post</span>
                        </div>
                      </div>

                      <aside className={styles.scheduleCard}>
                        <div>
                          <span className={styles.eyebrow}>ADD TO</span>
                          <h3>{selectedDayLabel}</h3>
                        </div>
                        <button type="button" className={styles.aiMakeButton} onClick={generateDraftForDay} disabled={calendarAiBusy}>
                          <b>{calendarAiBusy ? "Making it…" : "AI makes it"}</b>
                          <span>Generates a voice-aware draft for this day and adds it to the Queue.</span>
                        </button>
                        <InlineStatus status={calendarDraftStatus} />
                        <button type="button" disabled className={styles.ownPostButton}>
                          <b>I&apos;ll post my own</b>
                          <span>Upload or write it yourself — we&apos;ll publish it on time.</span>
                        </button>
                        <div className={styles.miniDivider} />
                        <span className={styles.eyebrow}>WHERE IT POSTS</span>
                        <div className={styles.destinationChips}>
                          <span><XMark /> X</span>
                          <span><TelegramMark /> Telegram</span>
                        </div>
                        <p>Posting to Telegram keeps the community talking between announcements.</p>
                        <div className={styles.miniDivider} />
                        <span className={styles.eyebrow}>QUIET HOURS</span>
                        <div className={styles.quietHours}>
                          <span>Never post between</span>
                          <select disabled><option>23:00</option></select>
                          <span>and</span>
                          <select disabled><option>07:00</option></select>
                        </div>
                        <p className={styles.exampleLabel}>
                          Automatic scheduling, quiet hours and &quot;I&apos;ll post my own&quot; are not built yet — every AI draft still needs a manual approve tap in the Queue.
                        </p>
                        <ComingSoon compact />
                      </aside>
                    </div>
                  </section>
                </div>
              ) : null}

              {activeTab === "queue" ? (
                <div className={styles.sectionStack}>
                  <section className={styles.block}>
                    <div className={styles.sectionHeading}>
                      <div>
                        <h2>What&apos;s going out</h2>
                        <p>
                          Ready to review: {queue.length} of {queueTarget} draft{queueTarget === 1 ? "" : "s"} ready
                          {readyToReviewShortfall > 0 ? " — refilling now" : ""}. Adjust the cadence in Settings &amp; Rules.
                        </p>
                      </div>
                    </div>
                    <InlineStatus status={replenishStatus} />
                    {queue.length === 0 ? (
                      <div className={styles.queueEmpty}>
                        <b>Ready to review is empty.</b>
                        <p>Use &quot;Draft with AI&quot; in Setup, &quot;AI makes it&quot; in Calendar, or wait a moment — new drafts generate automatically.</p>
                      </div>
                    ) : null}
                    {queue.length > 0 ? (
                      <div className={styles.queueList}>
                        {queue.map((item) => {
                          const selectedDestinations = itemDestinations[item.id] ?? [];
                          const isExpanded = Boolean(expandedQueueItemIds[item.id]);
                          const isPendingApproval = pendingApprovalItemId === item.id;
                          const isPendingQuickSendX = pendingQuickSendId?.itemId === item.id && pendingQuickSendId.platform === "x";
                          const isPendingQuickSendTelegram =
                            pendingQuickSendId?.itemId === item.id && pendingQuickSendId.platform === "telegram";
                          const xIsTemplate = isUneditedTemplateText(item.xText, templateOutputs);
                          const telegramIsTemplate = isUneditedTemplateText(item.telegramText, templateOutputs);
                          const isTemplateItem = xIsTemplate || telegramIsTemplate;
                          const selectedTextIsTemplate = selectedDestinations.some(
                            (platform) => (platform === "x" ? xIsTemplate : telegramIsTemplate),
                          );
                          const templateAcknowledged = Boolean(templateAcknowledgedIds[item.id]);
                          const requiresTemplateAck = isPendingApproval && selectedTextIsTemplate && !templateAcknowledged;
                          const telegramSameAsX = item.telegramText.trim() === item.xText.trim();
                          return (
                            <article className={styles.queueItem} key={item.id}>
                              {item.artwork ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img className={styles.queueThumb} src={item.artwork} alt="Queued post artwork" />
                              ) : null}
                              <div className={styles.queueItemBody}>
                                <div className={styles.queueItemHead}>
                                  <span className={styles.exampleLabel}>
                                    {item.source === "calendar-ai"
                                      ? `Calendar AI · ${item.dayLabel}`
                                      : item.source === "setup-ai"
                                        ? "Setup AI"
                                        : item.source === "auto-replenish"
                                          ? "Auto-generated"
                                          : "Manual"}
                                    {isTemplateItem ? <span className={styles.templateBadge}>Template</span> : null}
                                  </span>
                                  <button
                                    type="button"
                                    className={styles.queueExpandToggle}
                                    aria-expanded={isExpanded}
                                    onClick={() => toggleQueueItemExpanded(item.id)}
                                  >
                                    {isExpanded ? "Collapse" : "Edit"}
                                  </button>
                                </div>
                                {isExpanded ? (
                                  <>
                                    <label className={styles.connectionField}>
                                      <span>X ({item.xText.length}/280){xIsTemplate ? " · unedited template" : ""}</span>
                                      <textarea
                                        value={item.xText}
                                        onChange={(event) => updateQueueItem(item.id, { xText: event.target.value })}
                                        rows={3}
                                      />
                                    </label>
                                    <label className={styles.connectionField}>
                                      <span>Telegram{telegramIsTemplate ? " · unedited template" : ""}</span>
                                      <textarea
                                        value={item.telegramText}
                                        onChange={(event) => updateQueueItem(item.id, { telegramText: event.target.value })}
                                        rows={3}
                                      />
                                    </label>
                                  </>
                                ) : (
                                  <button
                                    type="button"
                                    className={styles.queuePreview}
                                    onClick={() => toggleQueueItemExpanded(item.id)}
                                  >
                                    <span className={styles.queuePreviewText}>{item.xText || "No X text yet — tap to write one."}</span>
                                    <span className={styles.queuePreviewMeta}>
                                      X {item.xText.length}/280 · Telegram {item.telegramText.length} chars
                                      {item.telegramText ? (telegramSameAsX ? " (same as X)" : " (different)") : " (empty)"} — tap to edit both
                                    </span>
                                  </button>
                                )}
                                {myConnectedPlatforms.length > 0 ? (
                                  <div className={styles.destinationToggles}>
                                    {myConnectedPlatforms.map((platform) => {
                                      const selected = selectedDestinations.includes(platform);
                                      return (
                                        <button
                                          type="button"
                                          key={platform}
                                          aria-pressed={selected}
                                          className={selected ? styles.destinationToggleActive : styles.destinationToggle}
                                          onClick={() => toggleItemDestination(item.id, platform)}
                                        >
                                          {platform === "x" ? <XMark /> : <TelegramMark />} {platformLabel(platform)}
                                        </button>
                                      );
                                    })}
                                  </div>
                                ) : connectionsStatus === "error" ? (
                                  // Distinguishes "we could not load your connections" from
                                  // "you have none" (issue #384) — showing the wrong one made a
                                  // connected Telegram look permanently disconnected after a
                                  // single transient fetch failure.
                                  <p className={styles.connectionHelper}>
                                    Could not load your connections.{" "}
                                    <button type="button" onClick={() => void loadConnections()}>
                                      Retry
                                    </button>
                                  </p>
                                ) : connectionsStatus === "loading" ? (
                                  <p className={styles.connectionHelper}>Checking your connections…</p>
                                ) : (
                                  <p className={styles.connectionHelper}>Connect X or Telegram in Setup before approving a post.</p>
                                )}
                                <label className={styles.scheduleCompact}>
                                  <span>Scheduled</span>
                                  <input
                                    type="datetime-local"
                                    className={styles.scheduleCompactInput}
                                    value={itemScheduledAt[item.id] ?? ""}
                                    onChange={(event) => setItemScheduledAtValue(item.id, event.target.value)}
                                  />
                                </label>
                                {isPendingApproval ? (
                                  <div className={styles.confirmPanel}>
                                    <p>
                                      Sending: {selectedDestinations.length === 0 ? "nothing selected" : selectedDestinations.map((platform) => platformLabel(platform)).join(" + ")}. Review the text above — this is exactly what each destination will receive.
                                    </p>
                                    {selectedTextIsTemplate ? (
                                      <label className={styles.confirmTemplateCheckbox}>
                                        <input
                                          type="checkbox"
                                          checked={templateAcknowledged}
                                          onChange={(event) => setTemplateAcknowledgedIds((current) => ({ ...current, [item.id]: event.target.checked }))}
                                        />
                                        This is unedited template text — I want to send it as-is.
                                      </label>
                                    ) : null}
                                  </div>
                                ) : null}
                                {isPendingQuickSendX || isPendingQuickSendTelegram ? (
                                  <div className={styles.confirmPanel}>
                                    <p>
                                      Sending to {isPendingQuickSendX ? "X" : "Telegram"} only. Review the{" "}
                                      {isPendingQuickSendX ? "X" : "Telegram"} text above — this is exactly what will be sent.
                                    </p>
                                  </div>
                                ) : null}
                                <div className={styles.queueItemActions}>
                                  <button
                                    type="button"
                                    className={styles.queueActionApprove}
                                    onClick={() => handleApproveClick(item)}
                                    disabled={approvingItemId === item.id || selectedDestinations.length === 0 || requiresTemplateAck}
                                  >
                                    {approvingItemId === item.id ? "Approving…" : isPendingApproval ? "Confirm & approve" : "Approve"}
                                  </button>
                                  <button
                                    type="button"
                                    className={styles.queueActionSecondary}
                                    onClick={() => handleQuickSendClick(item, "x")}
                                  >
                                    <XMark /> {isPendingQuickSendX ? "Confirm & post to X" : "Post to X"}
                                  </button>
                                  <button
                                    type="button"
                                    className={styles.queueActionSecondary}
                                    onClick={() => handleQuickSendClick(item, "telegram")}
                                    disabled={busy}
                                  >
                                    <TelegramMark /> {isPendingQuickSendTelegram ? "Confirm & send to Telegram" : "Send to Telegram"}
                                  </button>
                                  <button type="button" className={styles.queueActionDelete} onClick={() => removeQueueItem(item.id)}>
                                    Delete
                                  </button>
                                </div>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    ) : null}
                  </section>

                  <section className={styles.block}>
                    <div className={styles.sectionHeading}>
                      <div>
                        <h2>Approved &amp; scheduled</h2>
                        <p>Waiting to send. Cancel any time before it goes out.</p>
                      </div>
                    </div>
                    <InlineStatus status={postsStatus} />
                    {awaitingSendPosts.length === 0 ? (
                      <div className={styles.queueEmpty}>
                        <b>Nothing scheduled yet.</b>
                        <p>Approve a draft above to schedule it.</p>
                      </div>
                    ) : (
                      <div className={styles.queueList}>
                        {awaitingSendPosts.map((post) => (
                          <article className={styles.queueItem} key={post.id}>
                            {post.artworkDataUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img className={styles.queueThumb} src={post.artworkDataUrl} alt="Approved post artwork" />
                            ) : null}
                            <div className={styles.queueItemBody}>
                              <span className={styles.exampleLabel}>Scheduled for {formatScheduledAt(post.scheduledAt)}</span>
                              <p>{post.body}</p>
                              <div className={styles.destinationToggles}>
                                {post.destinations.map((destination) => (
                                  <span
                                    key={destination.id}
                                    className={[
                                      styles.statusPill,
                                      destination.status === "needs_composer" ? styles.statusPillNeedsComposer : styles.statusPillPending,
                                    ].join(" ")}
                                  >
                                    {destination.platform === "x" ? <XMark /> : <TelegramMark />} {platformLabel(destination.platform)} ·{" "}
                                    {destination.status === "needs_composer" ? "Needs composer" : destination.status === "sending" ? "Sending…" : "Pending"}
                                  </span>
                                ))}
                              </div>
                              {post.destinations.some((destination) => destination.status === "needs_composer") ? (
                                <div className={styles.composerActions}>
                                  <button type="button" onClick={() => openComposerForPost(post)}>
                                    <XMark /> Link posts publish from your own X account — tap to post
                                  </button>
                                </div>
                              ) : null}
                              {post.status === "scheduled" ? (
                                <>
                                  <label className={styles.scheduleCompact}>
                                    <span>Reschedule</span>
                                    <input
                                      type="datetime-local"
                                      className={styles.scheduleCompactInput}
                                      value={rescheduleValues[post.id] ?? toDateTimeLocalValue(new Date(post.scheduledAt))}
                                      onChange={(event) => setReschedulePostValue(post.id, event.target.value)}
                                    />
                                  </label>
                                  <div className={styles.composerActions}>
                                    <button type="button" onClick={() => reschedulePost(post)} disabled={reschedulingPostId === post.id}>
                                      {reschedulingPostId === post.id ? "Rescheduling…" : "Save new time"}
                                    </button>
                                    <button type="button" onClick={() => cancelScheduledPost(post.id)} disabled={cancelingPostId === post.id}>
                                      {cancelingPostId === post.id ? "Canceling…" : "Cancel"}
                                    </button>
                                  </div>
                                </>
                              ) : null}
                            </div>
                          </article>
                        ))}
                      </div>
                    )}
                  </section>

                  <section className={styles.block}>
                    <div className={styles.sectionHeading}>
                      <div>
                        <span className={styles.eyebrow}>HISTORY</span>
                        <p>Sent, failed and canceled posts, with the outcome per destination.</p>
                      </div>
                    </div>
                    {historyPosts.length === 0 ? (
                      <div className={styles.historyPlaceholder}>
                        <span>No publish history yet.</span>
                      </div>
                    ) : (
                      <div className={styles.queueList}>
                        {historyPosts.map((post) => (
                          <article className={styles.queueItem} key={post.id}>
                            <div className={styles.queueItemBody}>
                              <span className={styles.exampleLabel}>
                                {post.status === "canceled" ? "Canceled" : formatScheduledAt(post.scheduledAt)}
                              </span>
                              <p>{post.body}</p>
                              {post.status === "canceled" ? (
                                <p className={styles.connectionHelper}>Canceled before it was sent.</p>
                              ) : (
                                <div className={styles.destinationToggles}>
                                  {post.destinations.map((destination) => {
                                    const connection = connections.find((entry) => entry.platform === destination.platform);
                                    const needsReconnect = destination.status === "failed" && connection?.status === "reconnect_needed";
                                    return (
                                      <span
                                        key={destination.id}
                                        className={[
                                          styles.statusPill,
                                          destination.status === "sent"
                                            ? styles.statusPillSent
                                            : destination.status === "needs_composer"
                                              ? styles.statusPillNeedsComposer
                                              : styles.statusPillFailed,
                                        ].join(" ")}
                                      >
                                        {destination.platform === "x" ? <XMark /> : <TelegramMark />} {platformLabel(destination.platform)} ·{" "}
                                        {destination.status === "sent"
                                          ? "Sent"
                                          : destination.status === "needs_composer"
                                            ? "Needs composer"
                                            : destination.errorMessage || "Failed"}
                                        {needsReconnect ? (
                                          <button type="button" onClick={() => setActiveTab("setup")}>
                                            Reconnect
                                          </button>
                                        ) : null}
                                      </span>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </article>
                        ))}
                      </div>
                    )}
                  </section>
                </div>
              ) : null}

              {activeTab === "rules" ? (
                <div className={styles.sectionStack}>
                  <section className={styles.twoColsTop}>
                    <div className={styles.blockInner}>
                      <div className={styles.sectionHeading}>
                        <div>
                          <h2>Words to avoid</h2>
                          <p>The AI will never use these once rule storage is connected.</p>
                        </div>
                        <ComingSoon compact />
                      </div>
                      <div className={styles.bannedPanel}>
                        {BANNED_WORDS.map((word) => <span key={word}>{word}<i>×</i></span>)}
                        <button type="button" disabled>+ add a word</button>
                      </div>
                      <p className={styles.exampleLabel}>Example rules from the approved design — not active yet.</p>
                    </div>

                    <div className={styles.blockInner}>
                      <div className={styles.sectionHeading}>
                        <div>
                          <h2>How it should sound</h2>
                          <p>Nudge the tone whenever you like.</p>
                        </div>
                        <ComingSoon compact />
                      </div>
                      <div className={styles.dialList}>
                        {TONE_DIALS.map(([label, ...options]) => (
                          <label key={label}>
                            <span>{label}</span>
                            <select disabled defaultValue={options[1]}>
                              {options.map((option) => (
                                <option key={option}>{option}</option>
                              ))}
                            </select>
                          </label>
                        ))}
                      </div>
                    </div>
                  </section>

                  <section className={styles.block}>
                    <div className={styles.sectionHeading}>
                      <div>
                        <h2>
                          Direction brief <span className={styles.optionalBadge}>OPTIONAL</span>
                        </h2>
                        <p>Tell the AI your focus this week. Applies to both X and Telegram.</p>
                      </div>
                    </div>
                    <label className={styles.connectionField}>
                      <span>Direction brief</span>
                      <textarea
                        value={directionBrief}
                        onChange={(event) => setDirectionBrief(event.target.value.slice(0, 500))}
                        onBlur={() => persistSocialStudio()}
                        rows={3}
                        placeholder='e.g. "Push the community angle, big announcement coming Friday"'
                      />
                    </label>
                  </section>

                  <section className={styles.block}>
                    <div className={styles.sectionHeading}>
                      <div>
                        <h2>Posting cadence</h2>
                        <p>
                          How many AI drafts the Queue tab keeps loaded for review, and how they&apos;re spread across the day
                          once approved. Capped at your plan&apos;s {MAX_POSTS_PER_DAY} posts/day entitlement — it refills
                          whenever you open the Queue tab or approve/delete a draft, never in the background.
                        </p>
                      </div>
                    </div>
                    <div className={styles.cadenceOptions}>
                      {POSTING_CADENCE_OPTIONS.map((option) => (
                        <button
                          type="button"
                          key={option.id}
                          aria-pressed={postingCadence === option.id}
                          className={postingCadence === option.id ? styles.cadenceOptionActive : styles.cadenceOption}
                          onClick={() => updatePostingCadence(option.id)}
                        >
                          <b>{option.label}</b>
                          <span>{option.description}</span>
                        </button>
                      ))}
                    </div>
                  </section>

                  <section className={styles.block}>
                    <div className={styles.buyAlertRow}>
                      <div>
                        <b>Tell Telegram about every buy</b>
                        <span>
                          {selectedBuyBot
                            ? `The Buy Bot is ${selectedBuyBot.status === "active" ? "live" : selectedBuyBot.status === "paused" ? "paused" : "waiting to be re-added"} in ${selectedBuyBot.channelDisplayName}.`
                            : "Add the Buy Bot in Setup and we'll drop a message in its channel each time someone buys."}
                        </span>
                      </div>
                      <label className={styles.buyAlertThreshold}>
                        <span>Only above</span>
                        <select
                          value={formatBuyBotThreshold(selectedBuyBot?.thresholdWei ?? DEFAULT_BUY_BOT_THRESHOLD_WEI)}
                          disabled={!selectedBuyBot || buyBotBusy}
                          onChange={(event) => void updateBuyBot({ thresholdWei: buyBotThresholdWeiForLabel(event.target.value) })}
                        >
                          {BUY_ALERT_THRESHOLDS.map((threshold) => (
                            <option key={threshold}>{threshold}</option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <button type="button" disabled className={styles.advancedButton}>
                      <span>
                        <b>Advanced rules</b>
                        <small>Frequency caps, quiet-hour enforcement and automatic safety checks.</small>
                      </span>
                      <ComingSoon compact />
                    </button>
                  </section>
                </div>
              ) : null}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
