"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import { createWalletClient, custom, isAddress } from "viem";
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
import {
  describeMascotImageAllowance,
  type MascotImageUsage,
} from "@/lib/mascot-image-allowance";
import {
  POST_IMAGE_REMOVE_NOTE,
  describePostImageSlot,
  remainingAiImagesToday,
  selectPostImageCandidates,
} from "@/lib/social-post-images";
import {
  SOCIAL_APPROVAL_SESSION_PAYLOAD,
  SOCIAL_APPROVAL_SESSION_PURPOSE,
} from "@/lib/social-approval-session-client";
import { MASCOT_REFERENCE_TIPS, assessMascotReference, type MascotReferenceAssessment } from "@/lib/mascot-reference-guidance";
import { MIN_USABLE_VOICE_EXAMPLES, filterUsableVoiceExamples } from "@/lib/social-voice-examples";
import { getProjectBlob } from "@/lib/token-project-db";
import { saveProjectToStorage } from "@/lib/token-project-persistence";
import { isExternalProject, projectNetworkLabel, readProjectIndex, type SavedProjectIndexEntry } from "@/lib/token-project-storage";
import { useProjectOwner } from "@/lib/use-project-owner";
import {
  VOICE_EXAMPLE_TARGET,
  addVoiceExamples,
  describeAddVoiceExamplesResult,
  voiceTrainingHint,
} from "@/lib/social-voice-examples";
import { getSocialStudioRecord, putSocialStudioRecord } from "@/lib/social-studio-db";
import {
  MAX_WORDS_TO_AVOID,
  TONE_DIAL_OPTIONS,
  DEFAULT_TONE_DIALS,
  DEFAULT_WORDS_TO_AVOID,
  addWordToAvoid,
  type ToneDials,
  WORDS_TO_AVOID_SEED_VERSION,
} from "@/lib/social-tone-rules";
import {
  advanceRollingRecentDrafts,
  buildXIntentUrl,
  cadenceQueueTarget,
  countPostsScheduledToday,
  describePlanBadge,
  cadenceSpreadHoursMs,
  DEFAULT_DAILY_START_CLOCK,
  computeDefaultScheduledAt,
  describeSpreadHours,
  calendarDayAtTime,
  computeDefaultScheduledAtOnDay,
  connectedPlatforms,
  defaultCalendarClockTime,
  describeWalletMismatch,
  isCalendarDayBeforeToday,
  toCalendarDayIso,
  isAwaitingSend,
  isHistoryStatus,
  isPendingSendStatus,
  isUneditedTemplateText,
  replenishShortfall,
  approvalDestinations,
  ensureFutureScheduledAt,
} from "@/lib/social-studio-queue";
import {
  buildCalendarDayMarks,
  describeCalendarDayMarks,
  describeCalendarPostStatus,
  describeDraftSource,
  listCalendarDayEntries,
} from "@/lib/social-calendar-days";
import { DEFAULT_QUIET_HOURS, isInQuietHours, parseClockTime, shiftOutOfQuietHours, type QuietHours } from "@/lib/social-quiet-hours";
import {
  dateFromWallClock,
  detectTimezone,
  describeTimezone,
  buildTimezoneOptions,
  listTimezones,
  timezoneOffsetLabel,
  wallClockIn,
} from "@/lib/social-timezone";
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

/** How long a mouse may be outside the saved-examples box before it closes (crossing the pill→box gap takes a few frames). */
const VOICE_EXAMPLES_HOVER_CLOSE_DELAY_MS = 220;
const MAX_MASCOT_IMAGE_BYTES = 3_000_000;

type TemplateId = "launch" | "countdown" | "contract" | "community" | "custom";
type StudioTab = "setup" | "calendar" | "queue" | "rules";

// Per-panel status shown inline next to the control that triggered it, instead of one status bar far below the fold.
type PanelStatus = { tone: "progress" | "success" | "error"; message: string } | null;

/** Shown once X is connected — the same rule lib/server/social-x-client.ts's X_BIO_LINK_HINT states server-side (issue #342): posts never carry links, the bio does. */
const X_BIO_LINK_NOTE =
  "Put your project link in your X bio — posts sent through Hoodlums never include a link (that keeps posting free instead of 13x more expensive), so your bio is where people will find it.";

/** Turns the callback route's ?xConnect=…&reason=… into one plain sentence. */
function describeXConnectReturn(status: string, reason: string | null): PanelStatus {
  if (status === "success") return { tone: "success", message: "X connected. Approved posts can now go out to your account." };
  switch (reason) {
    case "denied":
      return { tone: "error", message: "X connection cancelled — you didn't approve Hoodlums on X. Nothing was connected." };
    case "expired":
      return { tone: "error", message: "That X connection took too long and expired. Tap Connect X again." };
    case "paused":
      return { tone: "error", message: "Social posting is paused on this deployment right now. Try again later." };
    case "unknown":
    case "not_found":
      return { tone: "error", message: "That X connection could not be matched to a request. Tap Connect X again." };
    default:
      return { tone: "error", message: "X could not finish connecting. Tap Connect X to try again." };
  }
}

type ExternalNetworkChoice = "robinhood" | "solana" | "other";
type ExternalTokenForm = {
  name: string;
  ticker: string;
  networkChoice: ExternalNetworkChoice;
  networkOther: string;
  contractAddress: string;
  description: string;
  xHandle: string;
  telegram: string;
  artworkDataUrl: string;
};
/** "Fill out later" on the token-details box, remembered per wallet for this tab only. Never throws. */
const TOKEN_DETAILS_LATER_KEY = "hoodlums.social.tokenDetailsLater.v1";
/** "Not now" on the start-time question, remembered for this tab only — the same shape as the token-details reminder (7 Sep 2026). */
const DAILY_START_LATER_KEY = "hoodlums.social.dailyStartLater.v1";
function readTokenDetailsLater(owner: string | null): boolean {
  if (!owner) return false;
  try {
    return sessionStorage.getItem(TOKEN_DETAILS_LATER_KEY) === owner;
  } catch {
    return false;
  }
}
function writeTokenDetailsLater(owner: string | null, later: boolean): void {
  try {
    if (later && owner) sessionStorage.setItem(TOKEN_DETAILS_LATER_KEY, owner);
    else sessionStorage.removeItem(TOKEN_DETAILS_LATER_KEY);
  } catch {
    // Without session storage the box simply shows again next time.
  }
}

function readDailyStartLater(owner: string | null): boolean {
  if (!owner) return false;
  try {
    return sessionStorage.getItem(DAILY_START_LATER_KEY) === owner;
  } catch {
    return false;
  }
}
function writeDailyStartLater(owner: string | null, later: boolean): void {
  try {
    if (later && owner) sessionStorage.setItem(DAILY_START_LATER_KEY, owner);
    else sessionStorage.removeItem(DAILY_START_LATER_KEY);
  } catch {
    // Without session storage the question simply asks again next time.
  }
}

const EMPTY_EXTERNAL_FORM: ExternalTokenForm = {
  name: "",
  ticker: "",
  networkChoice: "robinhood",
  networkOther: "",
  contractAddress: "",
  description: "",
  xHandle: "",
  telegram: "",
  artworkDataUrl: "",
};

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

/** Shape returned by GET /api/social/stats — null means "not tracked yet", never zero. */
type SocialStatsSummary = { holders: number | null; telegramMembers: number | null; xFollowers: null };

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
  approvalSession: SOCIAL_APPROVAL_SESSION_PURPOSE,
  xConnect: "social:x-connect",
  xDisconnect: "social:x-disconnect",
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

/**
 * Formats a Date for an <input type="datetime-local"> value. The input has
 * no zone of its own — it shows and returns a bare wall clock — so feeding
 * it the chosen zone's wall clock is what makes the picker speak that zone
 * (owner direction, 7 Sep 2026).
 */
function toDateTimeLocalValue(date: Date, timeZone?: string | null): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const wall = wallClockIn(date, timeZone);
  return `${wall.year}-${pad(wall.month + 1)}-${pad(wall.day)}T${pad(wall.hour)}:${pad(wall.minute)}`;
}

/** Reads an <input type="datetime-local"> value back as the instant that wall clock names in the chosen zone. */
function fromDateTimeLocalValue(value: string, timeZone?: string | null): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return new Date(value);
  return dateFromWallClock(
    { year: Number(match[1]), month: Number(match[2]) - 1, day: Number(match[3]), hour: Number(match[4]), minute: Number(match[5]) },
    timeZone,
  );
}

function formatScheduledAt(iso: string, timeZone?: string | null): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
  if (timeZone) options.timeZone = timeZone;
  return date.toLocaleString(undefined, options);
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

const BUY_ALERT_THRESHOLDS = ["0.01 ETH", "0.05 ETH", "0.1 ETH"] as const;
const CALENDAR_DAY_NAMES = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
/** X's hard cap; the announcement composer refuses longer text up front (the Queue's own count uses the same 280). */
const X_CHARACTER_LIMIT = 280;
/** Mirrors lib/server/social-draft-pipeline.ts's MAX_ANNOUNCEMENT_LENGTH (a server-only module the client bundle must not import). */
const ANNOUNCEMENT_MAX_LENGTH = 1_000;

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

function safeProjects(entries: readonly SavedProjectIndexEntry[]): TokenProject[] {
  try {
    return (entries as TokenProject[]).filter(
      (item) =>
        item &&
        typeof item.id === "string" &&
        typeof item.name === "string" &&
        typeof item.ticker === "string",
    );
  } catch {
    return [];
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

/** A bare X username: strips "@", "x.com/" and "twitter.com/" prefixes a user may paste. */
export function bareXHandle(value: string): string {
  return value
    .trim()
    .replace(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\//i, "")
    .replace(/^(?:www\.)?(?:x|twitter)\.com\//i, "")
    .replace(/^@+/, "")
    .replace(/[/?#].*$/, "")
    .trim();
}

/** A bare Telegram username: strips "https://t.me/", "t.me/" and "@" prefixes a user may paste. */
export function bareTelegramHandle(value: string): string {
  return value
    .trim()
    .replace(/^https?:\/\/(?:www\.)?(?:t\.me|telegram\.me)\//i, "")
    .replace(/^(?:www\.)?(?:t\.me|telegram\.me)\//i, "")
    .replace(/^@+/, "")
    .replace(/[/?#].*$/, "")
    .trim();
}

function websiteFor(project: TokenProject): string {
  if (!project.websiteSlug) return "";
  return `https://hoodlums.dev/${project.websiteSlug}`;
}

function buildTemplate(project: TokenProject, template: TemplateId): string {
  const name = project.name.trim() || "New token";
  const ticker = project.ticker.trim().toUpperCase() || "TOKEN";
  const chain = projectNetworkLabel(project);
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
  // Add an existing token (owner direction, 6 Sep 2026): Hoodlums Social runs
  // socials for a token launched anywhere, not only ones made in the studio.
  const [addTokenOpen, setAddTokenOpen] = useState(false);
  // "Fill out later" (owner direction, 6 Sep 2026): the token-details box
  // shows on arrival when this wallet has no project, but is never mandatory
  // — tools that need details ask for them at the moment they are used.
  const [detailsLater, setDetailsLater] = useState(false);
  // Editing an added (external) token's details reuses the same form.
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [externalForm, setExternalForm] = useState<ExternalTokenForm>(EMPTY_EXTERNAL_FORM);
  const [externalStatus, setExternalStatus] = useState<PanelStatus>(null);
  const [externalSaving, setExternalSaving] = useState(false);
  // The selected project's artwork, loaded from IndexedDB (issue #307 moved
  // heroImage out of the localStorage index, so the entries here carry none).
  const [selectedProjectArtwork, setSelectedProjectArtwork] = useState("");
  const [activeTab, setActiveTab] = useState<StudioTab>("setup");
  const [includeArtwork, setIncludeArtwork] = useState(true);
  const [busy, setBusy] = useState(false);
  const [calendarView, setCalendarView] = useState<MonthView>(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [selectedDay, setSelectedDay] = useState<SelectedDay>(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() };
  });
  /** The label for the zone in force, read after mount (Intl on the server would print UTC and mismatch on hydration) — the chosen zone, else the device's. */
  const [detectedTimezone, setDetectedTimezone] = useState("your local time");
  /** The device's own zone, read after mount — the "follow this device" option's label and the reset target. */
  const [deviceTimezone, setDeviceTimezone] = useState("");
  const mobileWeekRef = useRef<HTMLDivElement | null>(null);

  const [walletAddress, setWalletAddress] = useState("");
  // The examples are a LIST (owner spec, 5 Sep 2026): the box holds one post
  // at a time and "Add example" cleans it and appends it as its own row, so
  // posts can never be glued together by a paste with no handles between them.
  // `voiceExamplesText` is the one-post-per-line form every downstream count,
  // persist and API call reads.
  const [voiceExamples, setVoiceExamples] = useState<string[]>([]);
  const [voiceDraftText, setVoiceDraftText] = useState("");
  /** The saved-examples hover box: a mouse opens it on hover and closes it on leave; touch and keyboard toggle it through the trigger. */
  const [voiceExamplesOpen, setVoiceExamplesOpen] = useState(false);
  /** Pending hover-close, so a cursor crossing the pill→box gap (or briefly overshooting) never snaps the box shut. */
  const voiceExamplesCloseTimerRef = useRef<number | null>(null);
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
  const [queue, setQueue] = useState<QueueItem[]>([]);
  /** Calendar quiet hours (owner direction, 7 Sep 2026): per project, local time, null = off. Every default time and every approval is shifted out of it. */
  const [quietHours, setQuietHours] = useState<QuietHours | null>({ ...DEFAULT_QUIET_HOURS });
  /** The zone every Calendar and Queue time is shown and scheduled in; `null` follows the device (owner direction, 7 Sep 2026). */
  const [timezone, setTimezone] = useState<string | null>(null);
  const [timezoneEditing, setTimezoneEditing] = useState(false);
  /** What the user has typed into the zone search (owner report, 7 Sep 2026: the full list as a dropdown filled the screen). */
  const [timezoneQuery, setTimezoneQuery] = useState("");
  const timezonePickerRef = useRef<HTMLDivElement | null>(null);
  /** When the day's first post goes out; `null` until the user answers, and until then everything schedules exactly as it did before (owner direction, 7 Sep 2026). */
  const [dailyStartTime, setDailyStartTime] = useState<string | null>(null);
  /** The answer in the prompt's own field, before it is saved. */
  const [dailyStartDraft, setDailyStartDraft] = useState(DEFAULT_DAILY_START_CLOCK);
  const [dailyStartLater, setDailyStartLater] = useState(false);
  /** Calendar "Announcement post" (owner direction, 7 Sep 2026): the user's own announcement, posted as written or jazzed up by the AI, pinned to the selected day. */
  const [announcementMode, setAnnouncementMode] = useState<"own" | "ai" | "now">("own");
  /** "Post now" (7 Sep 2026, replacing Setup's Compose now): the text that goes out immediately — X through its own composer, Telegram through the bot. */
  const [postNowX, setPostNowX] = useState("");
  const [postNowTelegram, setPostNowTelegram] = useState("");
  const [announcementText, setAnnouncementText] = useState("");
  const [announcementAi, setAnnouncementAi] = useState<{ xText: string; telegramText: string } | null>(null);
  const [announcementAiBusy, setAnnouncementAiBusy] = useState(false);
  const [announcementStatus, setAnnouncementStatus] = useState<PanelStatus>(null);
  /** The "at" time beside the date on the Calendar card ("HH:MM" local): every calendar draft and announcement is scheduled for the selected day at this time. */
  const [calendarTime, setCalendarTime] = useState(() => {
    const now = new Date();
    return defaultCalendarClockTime(toCalendarDayIso(now.getFullYear(), now.getMonth(), now.getDate()), now);
  });
  /** Today, on the chosen zone's clock — what "today" means everywhere on the calendar. */
  const todayInZone = wallClockIn(new Date(), timezone);
  /** Once the user has set the time themselves, switching days keeps it; until then each day gets its own sensible default. */
  const calendarTimeTouchedRef = useRef(false);
  const mascotFileInputRef = useRef<HTMLInputElement | null>(null);

  // Per-panel status (issue #340): errors/progress render next to the
  // control that triggered them instead of only in the far-below statusBar.
  const [voiceStatus, setVoiceStatus] = useState<PanelStatus>(null);
  const [mascotUploadStatus, setMascotUploadStatus] = useState<PanelStatus>(null);
  // Today's mascot-image allowance for this token, read from the server (null until known — never a guessed count).
  const [mascotImageUsage, setMascotImageUsage] = useState<MascotImageUsage | null>(null);
  // AI images on approved posts (owner decision, 6 Sep 2026): which draft an
  // image is being made for right now, a per-draft failure line, and the
  // drafts whose image the user skipped mid-generation (the result is
  // discarded when it lands — the slot is spent, per the no-remake rule).
  const [postImageBusyId, setPostImageBusyId] = useState<string | null>(null);
  const [postImageErrors, setPostImageErrors] = useState<Record<string, string>>({});
  const postImageSkippedIdsRef = useRef<Set<string>>(new Set());
  /** Resolvers for "Skip the image" while an approval is waiting on the image — resolving one lets the approval continue at once. */
  const postImageSkipResolversRef = useRef<Map<string, () => void>>(new Map());
  // Best-results read-out for the last uploaded reference — advice only, the upload proceeds regardless.
  const [mascotReferenceAssessment, setMascotReferenceAssessment] = useState<MascotReferenceAssessment | null>(null);
  const [telegramStatus, setTelegramStatus] = useState<PanelStatus>(null);

  // Real Telegram connect flow (issue #340): reconciles the Setup card with
  // the wallet-signed connect/disconnect routes instead of a bare, unverified
  // chat-ID text field. `telegramConfigured` is null while loading.
  // `telegramConnection` itself is derived from `connections` below (issue
  // #384) rather than kept as separate state.
  const [telegramConfigured, setTelegramConfigured] = useState<boolean | null>(null);
  // Connect X (owner request, 6 Sep 2026): the Setup card runs the real
  // 3-legged OAuth flow from issue #335 — wallet-signed start, X's own
  // authorize page, then /api/social/x/connect/callback redirects back here
  // with ?xConnect=success|error. `xConfigured` is null while loading.
  const router = useRouter();
  const [xConfigured, setXConfigured] = useState<boolean | null>(null);
  const [xConnectBusy, setXConnectBusy] = useState(false);
  const [xStatus, setXStatus] = useState<PanelStatus>(null);
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
  // Queue tab "How it's going" (owner decision, 6 Sep 2026: honest numbers only)
  // — holders and Telegram members are real reads; X and per-post figures come
  // back null and render as "not tracked yet".
  const [howItsGoing, setHowItsGoing] = useState<SocialStatsSummary | null>(null);
  const [howItsGoingStatus, setHowItsGoingStatus] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [queueTarget, setQueueTarget] = useState(DEFAULT_QUEUE_TARGET);
  const [scheduledPosts, setScheduledPosts] = useState<ScheduledPostSummary[]>([]);
  const [postsStatus, setPostsStatus] = useState<PanelStatus>(null);
  const [replenishStatus, setReplenishStatus] = useState<PanelStatus>(null);
  const [approvingItemId, setApprovingItemId] = useState<string | null>(null);
  const [cancelingPostId, setCancelingPostId] = useState<string | null>(null);
  const [itemScheduledAt, setItemScheduledAt] = useState<Record<string, string>>({});
  // Compact draft cards (issue #358): collapsed by default, showing only the
  // X preview — this tracks which Ready-to-review cards the user has
  // expanded into their full editable X/Telegram fields. Ephemeral UI state,
  // never persisted.
  const [expandedQueueItemIds, setExpandedQueueItemIds] = useState<Record<string, boolean>>({});
  // One-tap approvals (owner direction, 6 Sep 2026, replacing issue #380's
  // two-tap confirm for Approve — quick-send keeps its confirm since it
  // publishes immediately). The first approval of the day asks for ONE wallet
  // signature that unlocks approvals for 24h (POST /api/social/approval-session,
  // httpOnly cookie); after that, Approve is a single tap with no signature.
  // null = locked / unknown; the server is the source of truth for expiry.
  const [approvalSession, setApprovalSession] = useState<{ expiresAt: string } | null>(null);
  const [approvalSessionBusy, setApprovalSessionBusy] = useState(false);
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
  // Replenish guard (owner report, 6 Sep 2026: "this keeps regenerating
  // posts" — 13 drafts waiting against a target of 5, and still generating).
  // Two leaks, both closure staleness. (1) The Queue tab's window-focus
  // listener is registered once per effect run, so it kept calling the
  // replenishQueue() of THAT render — whose `queue` was whatever it was back
  // then (often empty, before the saved queue had loaded) — and every focus
  // topped the pool up again from that stale count. (2) Tab activation ran
  // replenish before the project's saved queue had loaded from IndexedDB, so
  // an empty in-memory queue looked like a shortfall of five. The listener
  // now goes through `queueTabActionsRef` (the latest render's functions),
  // the loop re-reads the live queue length from `queueRef` before every
  // paid request, and nothing replenishes until `loadedRecordProjectId`
  // says this project's saved queue is actually in state.
  const queueRef = useRef<QueueItem[]>([]);
  const queueTargetRef = useRef(DEFAULT_QUEUE_TARGET);
  const selectedProjectIdRef = useRef<string | null>(null);
  const queueTabActionsRef = useRef({
    loadScheduledPosts: async () => {},
    loadConnections: async () => {},
    replenishQueue: async () => {},
  });
  const [loadedRecordProjectId, setLoadedRecordProjectId] = useState<string | null>(null);
  /** Rotates the example-post window and fallback angle across successive draft requests (issue #360) — never reset, so repeated Setup/Calendar clicks vary too, not just a batch loop. */
  const draftAngleCounterRef = useRef(0);

  // Direction brief and posting cadence (issue #358), persisted per project
  // alongside the rest of the Social Studio record.
  const [directionBrief, setDirectionBrief] = useState("");
  const [postingCadence, setPostingCadence] = useState<PostingCadence>(DEFAULT_POSTING_CADENCE);
  // Settings & Rules wiring (owner direction, 6 Sep 2026): both persist per
  // project alongside the Direction brief and ride into every AI draft.
  const [wordsToAvoid, setWordsToAvoid] = useState<string[]>([...DEFAULT_WORDS_TO_AVOID]);
  const [toneDials, setToneDials] = useState<ToneDials>({ ...DEFAULT_TONE_DIALS });
  /** Carried from the loaded record so a save never drops the seed version (which is what stops removed subject words coming back). */
  const [wordsToAvoidSeed, setWordsToAvoidSeed] = useState(WORDS_TO_AVOID_SEED_VERSION);
  const [wordToAvoidDraft, setWordToAvoidDraft] = useState("");
  const [wordsToAvoidStatus, setWordsToAvoidStatus] = useState<PanelStatus>(null);

  // Server-side project-slot usage (issue #407) — "Project X of Y (Plan)".
  // Read-only summary from GET /api/social/project-slots; the server, not
  // this state, is the entitlement decision. Refreshed after any AI call or
  // post approval (which may auto-register a new slot) and after a release.
  const [slotUsage, setSlotUsage] = useState<SlotUsageSummary | null>(null);
  const [slotUsageStatus, setSlotUsageStatus] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [releasePending, setReleasePending] = useState(false);
  const [releaseBusy, setReleaseBusy] = useState(false);
  const [releaseStatus, setReleaseStatus] = useState<PanelStatus>(null);

  // Per-wallet project scoping (6 Sep 2026): the picker lists the confirmed
  // wallet's own saved projects only, and reloads (resetting the selection)
  // the moment the wallet is confirmed, changed or disconnected.
  const projectOwner = useProjectOwner();
  useEffect(() => {
    const loadedProjects = safeProjects(readProjectIndex(projectOwner));
    setProjects(loadedProjects);
    setWalletAddress(storedWalletAddress());
    setDetailsLater(readTokenDetailsLater(projectOwner));
    setDailyStartLater(readDailyStartLater(projectOwner));
    setEditingProjectId(null);

    const first = loadedProjects[0];
    setSelectedProjectId(first ? first.id : "");
  }, [projectOwner]);

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
    async function loadXConfigured() {
      try {
        const response = await fetch("/api/social/x/status", { cache: "no-store" });
        const payload = await readJsonResponse<{ configured?: boolean }>(response, "Could not check X configuration.");
        if (!cancelled) setXConfigured(Boolean(payload.configured));
      } catch {
        if (!cancelled) setXConfigured(false);
      }
    }
    void loadXConfigured();
    // Coming back from X's authorize page: the callback route lands on
    // /social?xConnect=success|error&reason=…; read it once, tell the user,
    // and clear it from the address bar so a reload does not repeat it.
    const params = new URLSearchParams(window.location.search);
    const xConnect = params.get("xConnect");
    if (xConnect) {
      setXStatus(describeXConnectReturn(xConnect, params.get("reason")));
      params.delete("xConnect");
      params.delete("reason");
      const rest = params.toString();
      // Through the app router, not raw history — Next re-syncs the address bar from its own state on hydration and would put the params back.
      router.replace(`${window.location.pathname}${rest ? `?${rest}` : ""}`, { scroll: false });
    }
    return () => {
      cancelled = true;
    };
  }, [router]);

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

  async function loadHowItsGoing() {
    if (!walletAddress) {
      setHowItsGoing(null);
      setHowItsGoingStatus("idle");
      return;
    }
    setHowItsGoingStatus("loading");
    try {
      const params = new URLSearchParams({ walletAddress });
      if (selectedProject?.chain === "robinhood" && !isExternalSelected && selectedProject.contractAddress?.trim()) params.set("tokenAddress", selectedProject.contractAddress.trim());
      const response = await fetch(`/api/social/stats?${params.toString()}`, { cache: "no-store" });
      const payload = await readJsonResponse<SocialStatsSummary>(response, "Could not load your numbers.");
      setHowItsGoing(payload);
      setHowItsGoingStatus("loaded");
    } catch {
      setHowItsGoingStatus("error");
    }
  }

  useEffect(() => {
    if (activeTab !== "queue" || !walletAddress) return;
    void loadHowItsGoing();
    // loadHowItsGoing closes over the latest wallet/project on every render already.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, walletAddress, selectedProjectId]);

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
  async function loadMascotImageUsage() {
    if (!walletAddress || !selectedProjectId) {
      setMascotImageUsage(null);
      return;
    }
    try {
      const response = await fetch(
        `/api/social/mascot/image?walletAddress=${encodeURIComponent(walletAddress)}&projectId=${encodeURIComponent(selectedProjectId)}`,
        { cache: "no-store" },
      );
      const payload = await readJsonResponse<{ usage: MascotImageUsage }>(response, "Could not read today's image allowance.");
      setMascotImageUsage(payload.usage);
    } catch {
      setMascotImageUsage(null);
    }
  }

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

  // The allowance is per token, so it is re-read when the project changes too.
  useEffect(() => {
    void loadMascotImageUsage();
    // loadMascotImageUsage closes over the latest walletAddress/selectedProjectId on every render already.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddress, selectedProjectId]);

  useEffect(() => {
    void loadApprovalSession();
    // loadApprovalSession closes over the latest walletAddress on every render already.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddress]);

  useEffect(() => {
    let cancelled = false;
    async function loadRecord() {
      setLoadedRecordProjectId(null);
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
      setWordsToAvoid(record.wordsToAvoid);
      setWordsToAvoidSeed(record.wordsToAvoidSeed);
      setToneDials(record.toneDials);
      setQuietHours(record.quietHours);
      setTimezone(record.timezone);
      setDailyStartTime(record.dailyStartTime);
      setDailyStartDraft(record.dailyStartTime ?? DEFAULT_DAILY_START_CLOCK);
      setAnnouncementText("");
      setAnnouncementAi(null);
      setAnnouncementStatus(null);
      setWordToAvoidDraft("");
      setWordsToAvoidStatus(null);
      setScheduledPosts([]);
      setItemScheduledAt({});
      setExpandedQueueItemIds({});
      // Only now may the Queue tab replenish: the saved queue is in state, so
      // its length is the real count (same batch of updates as setQueue above).
      setLoadedRecordProjectId(selectedProjectId);
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
      wordsToAvoid,
      wordsToAvoidSeed,
      toneDials,
      quietHours,
      timezone,
      dailyStartTime,
      sortedVoiceSourceKeys,
      ...overrides,
    };
  }

  function persistSocialStudio(overrides: Partial<SocialStudioProjectRecord> = {}) {
    if (!selectedProjectId) return;
    void putSocialStudioRecord(selectedProjectId, currentSocialStudioRecord(overrides));
  }

  /** Settings & Rules: adds the typed word/phrase to the banned list (trimmed, de-duplicated, capped) and saves at once. */
  function addWordToAvoidFromBox() {
    const result = addWordToAvoid(wordsToAvoid, wordToAvoidDraft);
    if (result.status === "empty") {
      setWordsToAvoidStatus({ tone: "error", message: "Type a word or phrase first." });
      return;
    }
    if (result.status === "duplicate") {
      setWordsToAvoidStatus({ tone: "error", message: "That one is already on the list." });
      return;
    }
    if (result.status === "limit") {
      setWordsToAvoidStatus({ tone: "error", message: `The list holds ${MAX_WORDS_TO_AVOID} words at most — remove one to add another.` });
      return;
    }
    setWordsToAvoid(result.words);
    setWordToAvoidDraft("");
    setWordsToAvoidStatus(null);
    persistSocialStudio({ wordsToAvoid: result.words });
  }

  function removeWordToAvoid(word: string) {
    const next = wordsToAvoid.filter((item) => item !== word);
    setWordsToAvoid(next);
    setWordsToAvoidStatus(null);
    persistSocialStudio({ wordsToAvoid: next });
  }

  /** Settings & Rules: one dial changes, the whole set saves — no separate save step, like the cadence tiles. */
  function updateToneDial<K extends keyof ToneDials>(key: K, value: ToneDials[K]) {
    const next = { ...toneDials, [key]: value };
    setToneDials(next);
    persistSocialStudio({ toneDials: next });
  }

  const selectedProject = useMemo(
    () => projects.find((item) => item.id === selectedProjectId) || null,
    [projects, selectedProjectId],
  );
  const isExternalSelected = Boolean(selectedProject && isExternalProject(selectedProject));

  useEffect(() => {
    if (!selectedProject) return;
    let cancelled = false;
    const inline = selectedProject.heroImage || "";
    queueMicrotask(() => {
      if (!cancelled) setSelectedProjectArtwork(inline);
    });
    getProjectBlob(selectedProject.id)
      .then((blob) => {
        if (!cancelled) setSelectedProjectArtwork(blob?.heroImage || inline);
      })
      .catch(() => {
        if (!cancelled) setSelectedProjectArtwork(inline);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedProject]);
  const projectArtwork = selectedProject ? selectedProjectArtwork : "";

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

  /** Same derivation for X (single source of truth: `connections`). */
  const xConnection = useMemo<TelegramConnectionState | null>(() => {
    const x = connections.find((connection) => connection.platform === "x");
    return x && (x.status === "connected" || x.status === "reconnect_needed")
      ? { status: x.status, displayName: x.displayName, externalId: x.externalId, reconnectReason: x.reconnectReason }
      : null;
  }, [connections]);

  /** The selected project's own Buy Bot, matched on its contract address — only Robinhood Chain Testnet launches have a curve to watch. */
  const selectedBuyBot = useMemo<BuyBotSummary | null>(() => {
    const contract = selectedProject?.contractAddress?.trim().toLowerCase();
    if (!contract || selectedProject?.chain !== "robinhood" || isExternalSelected) return null;
    return buyBots.find((bot) => bot.tokenAddress.toLowerCase() === contract && bot.chainId === ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL) ?? null;
  }, [buyBots, selectedProject, isExternalSelected]);
  const buyBotTokenAddress = selectedProject?.chain === "robinhood" && !isExternalSelected ? selectedProject.contractAddress?.trim() || "" : "";
  const buyBotUnavailableReason = !walletAddress
    ? "Connect your wallet first."
    : !selectedProject
      ? "Add your token details first."
      : isExternalSelected
        ? "This token was not launched on Hoodlums — the Buy Bot only watches Hoodlums curves."
        : !buyBotTokenAddress
          ? "Launch this token on Robinhood Chain Testnet first — the Buy Bot watches its curve."
          : null;

  const voiceExampleFilter = useMemo(() => filterUsableVoiceExamples(voiceExamplesText), [voiceExamplesText]);
  const voiceExampleCount = voiceExampleFilter.usable.length;
  const voiceProgressPercent = Math.min(100, Math.round((voiceExampleCount / VOICE_EXAMPLE_TARGET) * 100));
  // A selected project with no name and no ticker (a blank studio draft) reads
  // UNTITLED, never the "PROJECT" placeholder that means nothing is selected.
  const projectInitial = (selectedProject?.name?.trim() || selectedProject?.ticker?.trim() || (selectedProject ? "U" : "H")).slice(0, 1).toUpperCase();
  const projectTicker = selectedProject
    ? selectedProject.ticker?.trim().toUpperCase() || selectedProject.name?.trim().toUpperCase().slice(0, 14) || "UNTITLED"
    : "PROJECT";
  const xHandle = selectedProject?.xHandle ? cleanHandle(selectedProject.xHandle) : "";
  const isCurrentMonthView = calendarView.year === todayInZone.year && calendarView.month === todayInZone.month;
  const monthGrid = useMemo(
    () => buildMonthGrid(calendarView.year, calendarView.month),
    [calendarView.year, calendarView.month],
  );
  const monthDays = useMemo(
    () => monthGrid.filter((day): day is number => day !== null),
    [monthGrid],
  );
  const selectedDayLabel = `${selectedDay.day} ${MONTH_NAMES[selectedDay.month]} ${selectedDay.year}`;
  const selectedDayIso = toCalendarDayIso(selectedDay.year, selectedDay.month, selectedDay.day);
  /** Said before the tap: a picked time inside quiet hours is moved to the window's end at approval. */
  const calendarTimeQuietNote = useMemo(() => {
    const at = calendarDayAtTime(selectedDayIso, calendarTime, timezone);
    return quietHours && at && isInQuietHours(at, quietHours, timezone) ? `Inside quiet hours — it will go out at ${quietHours.end}.` : null;
  }, [selectedDayIso, calendarTime, quietHours, timezone]);
  /** Day markers for the month in view, from the approved posts already loaded and the drafts pinned to a day (never a second fetch). */
  const calendarDayMarks = useMemo(
    () => buildCalendarDayMarks(scheduledPosts, queue, calendarView.year, calendarView.month, timezone),
    [scheduledPosts, queue, calendarView.year, calendarView.month, timezone],
  );
  const selectedDayEntries = useMemo(
    () => listCalendarDayEntries(scheduledPosts, queue, selectedDay.year, selectedDay.month, selectedDay.day, timezone),
    [scheduledPosts, queue, selectedDay, timezone],
  );

  useEffect(() => {
    setDetectedTimezone(describeTimezone(timezone));
  }, [timezone]);

  useEffect(() => {
    setDeviceTimezone(detectTimezone());
  }, []);

  // A tap anywhere else closes the zone picker (owner recording, 7 Sep 2026:
  // it stayed open over the calendar until Cancel was pressed).
  useEffect(() => {
    if (!timezoneEditing) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      const picker = timezonePickerRef.current;
      if (picker && event.target instanceof Node && !picker.contains(event.target)) setTimezoneEditing(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [timezoneEditing]);

  // The record loads after mount, so an untouched "at" field follows the
  // start time (and zone) once they arrive.
  useEffect(() => {
    if (calendarTimeTouchedRef.current) return;
    setCalendarTime(defaultCalendarClockTime(selectedDayIso, new Date(), timezone, dailyStartTime));
  }, [dailyStartTime, timezone, selectedDayIso]);

  /**
   * The handful of zones the picker actually shows: what the user typed
   * matched against every zone, or a short suggestion list before they type.
   * Built only while the picker is open, so a few hundred names never render.
   */
  const timezoneMatches = useMemo(() => {
    if (!timezoneEditing) return [];
    return buildTimezoneOptions(listTimezones(timezone, deviceTimezone), timezoneQuery, timezone, deviceTimezone);
  }, [timezoneEditing, timezoneQuery, timezone, deviceTimezone]);

  // The mobile week strip opens on the selected day (today on arrival)
  // instead of the 1st, which put today off-screen for most of the month
  // (owner test, 7 Sep 2026). Scrolls the strip only, never the page.
  useEffect(() => {
    if (activeTab !== "calendar") return;
    const strip = mobileWeekRef.current;
    if (!strip || strip.clientWidth === 0) return;
    const target = strip.querySelector<HTMLElement>(`[data-day="${selectedDay.day}"]`);
    if (!target) return;
    strip.scrollTo({ left: Math.max(0, target.offsetLeft - strip.offsetLeft - 8), behavior: "auto" });
  }, [activeTab, calendarView.year, calendarView.month, selectedDay]);

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
        timezone,
      ),
    [scheduledPosts, timezone],
  );
  const cadencePostsPerDay = cadenceQueueTarget(postingCadence);

  const historyPosts = useMemo(
    () => scheduledPosts.filter((post) => isHistoryStatus(post.status)),
    [scheduledPosts],
  );
  const readyToReviewShortfall = replenishShortfall(queue.length, queueTarget);
  // The drafts the AI has picked for an image today (owner decision, 6 Sep
  // 2026) — as many as the shared daily allowance still has, best angles
  // first. A pick spends nothing until the user approves that draft.
  const postImageCandidateIds = useMemo(
    () => new Set(selectPostImageCandidates(queue, remainingAiImagesToday(mascotImageUsage))),
    [queue, mascotImageUsage],
  );

  function selectProject(id: string) {
    const project = projects.find((item) => item.id === id);
    if (!project) return;
    setSelectedProjectId(id);
    setProjectMenuOpen(false);
    setVoiceStatus(null);
    setMascotUploadStatus(null);
    setPostsStatus(null);
    setReplenishStatus(null);
  }

  // Opens the token-details box with a reason — every tool that needs a
  // project calls this instead of dead-ending on a status line.
  function promptForTokenDetails(reason: string) {
    writeTokenDetailsLater(projectOwner, false);
    setDetailsLater(false);
    setEditingProjectId(null);
    setAddTokenOpen(true);
    setExternalStatus({ tone: "progress", message: reason });
    window.requestAnimationFrame(() => {
      document.querySelector("[data-add-token-form]")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  async function connectX() {
    if (!getInjectedEvmProvider()) {
      setXStatus({ tone: "error", message: "Connect an EVM wallet before linking X." });
      return;
    }
    setXConnectBusy(true);
    setXStatus({ tone: "progress", message: "Sign once in your wallet, then approve Hoodlums on X…" });
    try {
      // The shared helper carries the issue #388 wallet-mismatch guard, so
      // this is not a new direct check site.
      const signed = await signSocialStudioChallenge(SOCIAL_STUDIO_ACTION_PURPOSES.xConnect, { platform: "x" });
      const startResponse = await fetch("/api/social/x/connect/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: signed.challengeId, nonce: signed.nonce, signature: signed.signature }),
      });
      const payload = await readJsonResponse<{ authorizeUrl: string }>(startResponse, "X could not start the connection.");
      if (!payload.authorizeUrl?.startsWith("https://")) throw new Error("X returned an unexpected authorize link.");
      setXStatus({ tone: "progress", message: "Opening X. Approve Hoodlums there and you'll land back here." });
      // Same tab: X redirects to /api/social/x/connect/callback, which sends
      // the browser back to /social?xConnect=… (read on mount above).
      window.location.assign(payload.authorizeUrl);
    } catch (error) {
      setXStatus({ tone: "error", message: error instanceof Error ? error.message : "X could not start the connection." });
      setXConnectBusy(false);
    }
  }

  async function disconnectX() {
    if (!getInjectedEvmProvider()) {
      setXStatus({ tone: "error", message: "Connect an EVM wallet before disconnecting X." });
      return;
    }
    setXConnectBusy(true);
    setXStatus({ tone: "progress", message: "Disconnecting X…" });
    try {
      const signed = await signSocialStudioChallenge(SOCIAL_STUDIO_ACTION_PURPOSES.xDisconnect, { platform: "x" });
      const disconnectResponse = await fetch("/api/social/x/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: signed.challengeId, nonce: signed.nonce, signature: signed.signature }),
      });
      await readJsonResponse<{ ok?: boolean }>(disconnectResponse, "X could not be disconnected.");
      // Immediate update, same as Telegram (issue #384): the Queue's
      // destinations drop X in the same render as the Setup card does.
      setConnections((current) => current.filter((connection) => connection.platform !== "x"));
      setConnectionsStatus("loaded");
      setXStatus({ tone: "success", message: "X disconnected. Hoodlums can no longer post to that account." });
    } catch (error) {
      setXStatus({ tone: "error", message: error instanceof Error ? error.message : "X could not be disconnected." });
    } finally {
      setXConnectBusy(false);
    }
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

  function draftProjectPayload() {
    if (!selectedProject) return null;
    return {
      name: selectedProject.name,
      ticker: selectedProject.ticker,
      description: selectedProject.description,
      chain: selectedProject.chain,
      network: selectedProject.network,
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
          wordsToAvoid,
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

  function cancelVoiceExamplesClose() {
    if (voiceExamplesCloseTimerRef.current !== null) {
      window.clearTimeout(voiceExamplesCloseTimerRef.current);
      voiceExamplesCloseTimerRef.current = null;
    }
  }

  /** Mouse only — a touch tap must never open or close the box through hover (it toggles through the trigger). */
  function openVoiceExamplesFromPointer(event: ReactPointerEvent<HTMLElement>) {
    if (event.pointerType !== "mouse") return;
    cancelVoiceExamplesClose();
    setVoiceExamplesOpen(true);
  }

  /** Mouse only, and delayed: the owner's recording showed the box vanishing mid-travel, before a × could be clicked. */
  function closeVoiceExamplesFromPointer(event: ReactPointerEvent<HTMLElement>) {
    if (event.pointerType !== "mouse") return;
    cancelVoiceExamplesClose();
    voiceExamplesCloseTimerRef.current = window.setTimeout(() => {
      voiceExamplesCloseTimerRef.current = null;
      setVoiceExamplesOpen(false);
    }, VOICE_EXAMPLES_HOVER_CLOSE_DELAY_MS);
  }

  useEffect(() => cancelVoiceExamplesClose, []);

  /** The × on an example row. */
  function removeVoiceExample(index: number) {
    const next = voiceExamples.filter((_, position) => position !== index);
    setVoiceExamples(next);
    persistSocialStudio({ voiceExamples: next });
    setVoiceAddStatus(null);
    if (next.length === 0) setVoiceExamplesOpen(false);
  }

  async function buildVoiceProfile() {
    const project = draftProjectPayload();
    if (!project) {
      setVoiceStatus({ tone: "error", message: "Add your token details before teaching the AI your voice." });
      promptForTokenDetails("Add your token details before teaching the AI your voice.");
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
      /** The picked calendar day ("YYYY-MM-DD") a Calendar-tab draft is scheduled on at approval. */
      scheduledDay?: string;
      /** The Calendar card's "at" time ("HH:MM") for that day. */
      scheduledTime?: string;
      /** Announcement mode: the user's own announcement to jazz up. The result is returned for review, never added to the Queue here. */
      announcement?: string;
      theme?: string;
      replenish?: boolean;
      recentDraftsOverride?: string[];
      recentTelegramDraftsOverride?: string[];
    } = {},
    report: (next: PanelStatus) => void = () => {},
  ): Promise<{ xText: string; telegramText: string } | null> {
    const project = draftProjectPayload();
    if (!project) {
      report({ tone: "error", message: "Add your token details before generating a draft." });
      promptForTokenDetails("Add your token details before generating a draft.");
      return null;
    }
    if (!project.description.trim() && !options.announcement) {
      // The AI only ever states facts from the description — with none, it has nothing to write from (an announcement supplies its own).
      if (selectedProject && isExternalProject(selectedProject)) {
        report({ tone: "error", message: "Add a sentence about the token first — the AI drafts from it." });
        openEditTokenDetails(selectedProject, "Add a sentence about the token — the AI only ever states facts from here.");
      } else {
        report({ tone: "error", message: "This project has no description yet. Add its story in the launch studio (Saved launches → open it), then draft again." });
      }
      return null;
    }

    report({ tone: "progress", message: options.announcement ? "Jazzing up your announcement…" : "Writing a draft with AI…" });
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
          announcement: options.announcement ?? null,
          likedSampleLines: likedReinforcementLines(sampleLineFeedback),
          directionBrief: directionBrief.trim() || null,
          voiceExamples: voiceExampleFilter.usable,
          recentDrafts: options.recentDraftsOverride ?? queue.map((item) => item.xText),
          recentTelegramDrafts: options.recentTelegramDraftsOverride ?? queue.map((item) => item.telegramText),
          angleIndex,
          wordsToAvoid,
          toneDials,
        }),
      });
      const payload = (await response.json()) as {
        draft?: { xText: string; telegramText: string };
        angleKey?: string | null;
        error?: string;
      };
      if (!response.ok || !payload.draft) {
        throw new Error(payload.error || "The draft could not be generated.");
      }
      void loadSlotUsage();

      if (options.announcement) {
        report({ tone: "success", message: "Jazzed up — check it, edit it if you like, then add it to the Queue." });
        return payload.draft;
      }

      {
        const item: QueueItem = {
          id: newQueueItemId(),
          xText: payload.draft.xText,
          telegramText: payload.draft.telegramText,
          artwork: null,
          source: options.dayLabel ? "calendar-ai" : "auto-replenish",
          dayLabel: options.dayLabel ?? null,
          scheduledDay: options.scheduledDay ?? null,
          scheduledTime: options.scheduledTime ?? null,
          createdAt: new Date().toISOString(),
          angleKey: payload.angleKey ?? null,
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
      }
      return payload.draft;
    } catch (error) {
      report({ tone: "error", message: error instanceof Error ? error.message : "The draft could not be generated." });
      return null;
    }
  }

  /**
   * The default time for a Calendar-tab draft: on its picked day (first
   * waking slot, one cadence spread past anything already pending that day),
   * or null for every other draft so the caller falls back to the ordinary
   * cadence spread from now. Used by the shown default and by approval, so
   * the time the row shows is the time approval uses.
   */
  function calendarDayScheduledAt(item: QueueItem, awaitingIso: string[], now: Date): Date | null {
    if (!item.scheduledDay) return null;
    // A time picked beside the date on the Calendar card is the exact default; otherwise the day's first free waking slot.
    const pinned = item.scheduledTime ? calendarDayAtTime(item.scheduledDay, item.scheduledTime, timezone) : null;
    return pinned ?? computeDefaultScheduledAtOnDay(item.scheduledDay, awaitingIso, now, cadenceSpreadHoursMs(postingCadence), timezone, dailyStartTime);
  }

  /** Calendar quiet hours: saved at once; a start equal to its end means off. */
  function updateQuietHours(next: QuietHours | null) {
    setQuietHours(next);
    persistSocialStudio({ quietHours: next });
  }

  /**
   * The zone every Calendar and Queue time is shown and scheduled in
   * (owner direction, 7 Sep 2026). Saved at once; "" means follow the
   * device, which is what the read-only line said before it could be
   * changed. Only the clock changes — no already-approved post moves,
   * since a scheduled post is stored as an instant.
   */
  function updateTimezone(next: string) {
    const chosen = next.trim() ? next : null;
    setTimezone(chosen);
    setTimezoneEditing(false);
    setTimezoneQuery("");
    persistSocialStudio({ timezone: chosen });
  }

  function openTimezonePicker() {
    setTimezoneQuery("");
    setTimezoneEditing(true);
    // On a phone the list opens in flow under the search box, so bring the
    // whole picker into view rather than leaving it behind the bottom nav.
    window.requestAnimationFrame(() => {
      timezonePickerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  /**
   * When the day's first post goes out (owner direction, 7 Sep 2026: "all
   * users should be prompted when do you want your first post to start …
   * and space posts out in accordance with the first initial post"). Saved
   * at once; every later post on that day steps one cadence spread from it.
   */
  function updateDailyStartTime(next: string) {
    if (parseClockTime(next) === null) return;
    setDailyStartTime(next);
    setDailyStartDraft(next);
    writeDailyStartLater(projectOwner, false);
    setDailyStartLater(false);
    persistSocialStudio({ dailyStartTime: next });
  }

  /** "Not now" leaves the question unanswered: scheduling keeps the behaviour it had before, and the row returns next visit. */
  function askDailyStartLater() {
    writeDailyStartLater(projectOwner, true);
    setDailyStartLater(true);
  }

  /** A native time field's "HH:MM" (a cleared field is ignored, never saved as off). */
  function setQuietHourBound(bound: keyof QuietHours, value: string) {
    if (parseClockTime(value) === null) return;
    const next = { ...(quietHours ?? DEFAULT_QUIET_HOURS), [bound]: value };
    updateQuietHours(next.start === next.end ? null : next);
  }

  /**
   * "Announcement post" (owner direction, 7 Sep 2026): the user's own
   * announcement, either as written ("My words") or rewritten by the AI in
   * the taught voice ("AI jazz-up", reviewed and editable first). Either
   * way it becomes an ordinary draft pinned to the selected day at the
   * card's time and takes the same Queue approve path as every AI draft —
   * nothing is sent from the calendar.
   */
  function addAnnouncementToQueue(mode: "own" | "ai") {
    const xText = (mode === "own" ? announcementText : announcementAi?.xText ?? "").trim();
    const telegramText = (mode === "own" ? announcementText : announcementAi?.telegramText ?? "").trim();
    if (!xText && !telegramText) {
      setAnnouncementStatus({ tone: "error", message: mode === "own" ? "Write the announcement first." : "Jazz it up first, or switch to My words." });
      return;
    }
    if (xText.length > X_CHARACTER_LIMIT) {
      setAnnouncementStatus({ tone: "error", message: `The X version is ${xText.length} characters — X allows ${X_CHARACTER_LIMIT}. Shorten it here, or add it and edit the X version in the Queue.` });
      return;
    }
    if (isCalendarDayBeforeToday(selectedDayIso, new Date(), timezone)) {
      setAnnouncementStatus({ tone: "error", message: `${selectedDayLabel} has already passed — pick today or a later day.` });
      return;
    }
    if (!selectedProject) {
      promptForTokenDetails("Add your token details before adding an announcement.");
      return;
    }
    const item: QueueItem = {
      id: newQueueItemId(),
      xText,
      telegramText,
      artwork: null,
      source: mode === "own" ? "announcement" : "announcement-ai",
      dayLabel: selectedDayLabel,
      scheduledDay: selectedDayIso,
      scheduledTime: calendarTime,
      createdAt: new Date().toISOString(),
      angleKey: null,
    };
    setQueue((current) => {
      const next = [item, ...current];
      persistSocialStudio({ queue: next });
      return next;
    });
    setAnnouncementText("");
    setAnnouncementAi(null);
    setAnnouncementStatus({ tone: "success", message: `In the Queue for ${selectedDayLabel} at ${calendarTime} — approve it there.` });
  }

  /** "AI jazz-up": one draft call with the announcement as the source of truth; the result is shown for editing, never queued or sent by itself. */
  async function jazzUpAnnouncement() {
    const text = announcementText.trim();
    if (!text) {
      setAnnouncementStatus({ tone: "error", message: "Write the announcement first — the AI rewrites your words, it doesn't invent them." });
      return;
    }
    if (isCalendarDayBeforeToday(selectedDayIso, new Date(), timezone)) {
      setAnnouncementStatus({ tone: "error", message: `${selectedDayLabel} has already passed — pick today or a later day.` });
      return;
    }
    setAnnouncementAiBusy(true);
    const draft = await generateDraft({ dayLabel: selectedDayLabel, announcement: text }, setAnnouncementStatus);
    if (draft) setAnnouncementAi(draft);
    setAnnouncementAiBusy(false);
  }

  /** Entering the Post now tab starts from whatever is written — the jazzed version when there is one, else the announcement as typed — without overwriting text already edited there. */
  function openPostNow() {
    setAnnouncementMode("now");
    setAnnouncementStatus(null);
    if (!postNowX.trim() && !postNowTelegram.trim()) {
      setPostNowX(announcementAi?.xText ?? announcementText);
      setPostNowTelegram(announcementAi?.telegramText ?? announcementText);
    }
  }

  /** X never posts through the API from here (issue #342 cost control): the free intent composer opens with the text filled in, and the user presses Post on X. */
  function postNowToX() {
    const text = postNowX.trim();
    if (!text) {
      setAnnouncementStatus({ tone: "error", message: "Write the X post first." });
      return;
    }
    if (text.length > X_CHARACTER_LIMIT) {
      setAnnouncementStatus({ tone: "error", message: `X posts must be ${X_CHARACTER_LIMIT} characters or fewer. Remove ${text.length - X_CHARACTER_LIMIT} characters.` });
      return;
    }
    window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
    setAnnouncementStatus({ tone: "success", message: "X composer opened with the post filled in. Review it and press Post on X." });
  }

  /** Telegram goes out immediately through the Hoodlums bot, to the verified channel connected in Setup. */
  async function postNowToTelegram() {
    if (!selectedProject) {
      promptForTokenDetails("Add your token details before publishing.");
      return;
    }
    const text = postNowTelegram.trim();
    if (!telegramConnection || telegramConnection.status !== "connected" || !text) {
      setAnnouncementStatus({ tone: "error", message: "Connect a verified Telegram channel in Setup and write the Telegram post first." });
      return;
    }
    setBusy(true);
    setAnnouncementStatus({ tone: "progress", message: "Sending through the Hoodlums Telegram bot…" });
    try {
      const response = await fetch("/api/social/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId: telegramConnection.externalId,
          text,
          artwork: includeArtwork ? projectArtwork : "",
        }),
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Telegram rejected the post.");
      }
      setAnnouncementStatus({ tone: "success", message: "Posted to Telegram through the Hoodlums bot." });
    } catch (error) {
      setAnnouncementStatus({ tone: "error", message: error instanceof Error ? error.message : "Telegram publishing failed." });
    } finally {
      setBusy(false);
    }
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
    // Never before this project's saved queue is in state — an unloaded queue
    // reads as empty and would be "refilled" with five paid drafts it already has.
    if (loadedRecordProjectId !== selectedProjectId) return;
    const liveQueue = queueRef.current;
    const shortfall = replenishShortfall(liveQueue.length, queueTargetRef.current);
    if (shortfall <= 0) return;

    replenishInFlightRef.current = true;
    const projectIdAtStart = selectedProjectId;
    let generated = 0;
    let rollingRecentDrafts = liveQueue.map((item) => item.xText);
    let rollingRecentTelegramDrafts = liveQueue.map((item) => item.telegramText);
    try {
      for (let index = 0; index < shortfall; index += 1) {
        // Re-check the live pool before every paid request: drafts added from
        // elsewhere (Setup, Calendar, another loop) count, and a project
        // switch mid-loop must not keep writing into the old project.
        if (selectedProjectIdRef.current !== projectIdAtStart) break;
        if (queueRef.current.length >= queueTargetRef.current) break;
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
    if (!selectedProject) {
      promptForTokenDetails("Add your token details before adding the Buy Bot.");
      return;
    }
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
      const projectId = selectedProject?.id ?? "";
      const auth = await signSocialStudioChallenge(SOCIAL_STUDIO_ACTION_PURPOSES.buyBotEnable, {
        chainId,
        tokenAddress: buyBotTokenAddress,
        chatId,
        thresholdWei: buyBotThresholdWei,
        projectId,
      });
      const response = await fetch("/api/social/buy-bot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chainId,
          tokenAddress: buyBotTokenAddress,
          chatId,
          thresholdWei: buyBotThresholdWei,
          projectId,
          displayName: selectedProject?.name ?? "",
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

  function setItemScheduledAtValue(itemId: string, value: string) {
    setItemScheduledAt((current) => ({ ...current, [itemId]: value }));
    setScheduleManuallySet((current) => ({ ...current, [itemId]: true }));
  }

  /**
   * Approve is ONE tap (owner direction, 6 Sep 2026), from the collapsed row
   * or the expanded card — both buttons call this. Issue #380's two-tap
   * confirm step is gone for Approve: an approved post is scheduled, visible
   * in Coming up and cancellable there, so a second tap protected nothing a
   * cancel doesn't. Quick send (Post to X / Send to Telegram) publishes
   * immediately and keeps its confirm.
   */
  function handleApproveClick(item: QueueItem) {
    void approveQueueItem(item);
  }

  /** Today's approval session for this wallet, from the server — never assumed. */
  async function loadApprovalSession() {
    if (!walletAddress) {
      setApprovalSession(null);
      return;
    }
    try {
      const response = await fetch(`/api/social/approval-session?walletAddress=${encodeURIComponent(walletAddress)}`, { cache: "no-store" });
      const payload = await readJsonResponse<{ active: boolean; expiresAt: string | null }>(response, "Could not read the approval session.");
      setApprovalSession(payload.active && payload.expiresAt ? { expiresAt: payload.expiresAt } : null);
    } catch {
      setApprovalSession(null);
    }
  }

  /**
   * One wallet signature a day (owner direction, 6 Sep 2026: "it shouldn't
   * need a signature every approval"). Returns how this approval will be
   * authorised: "session" when the day's approval session is live (or was
   * just unlocked with one signature), or "signature" — the old per-post
   * signing path — when the server has no approval-session table yet, so
   * approvals never break before migration 034 is applied. A refused
   * signature throws and the approval stops.
   */
  async function ensureApprovalSession(): Promise<"session" | "signature"> {
    if (approvalSession && new Date(approvalSession.expiresAt).getTime() > Date.now()) return "session";
    setApprovalSessionBusy(true);
    try {
      const auth = await signSocialStudioChallenge(SOCIAL_STUDIO_ACTION_PURPOSES.approvalSession, SOCIAL_APPROVAL_SESSION_PAYLOAD);
      const response = await fetch("/api/social/approval-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: auth.challengeId, nonce: auth.nonce, signature: auth.signature }),
      });
      if (response.status === 503) return "signature";
      const payload = await readJsonResponse<{ active: boolean; expiresAt: string | null }>(response, "Approvals could not be unlocked.");
      if (!payload.active || !payload.expiresAt) return "signature";
      setApprovalSession({ expiresAt: payload.expiresAt });
      return "session";
    } finally {
      setApprovalSessionBusy(false);
    }
  }

  /** "Lock" — approvals ask for a signature again from the next tap. */
  async function lockApprovals() {
    setApprovalSessionBusy(true);
    try {
      await fetch("/api/social/approval-session", { method: "DELETE" });
    } catch {
      // The cookie is cleared server-side on the next request either way.
    } finally {
      setApprovalSession(null);
      setApprovalSessionBusy(false);
    }
  }

  /**
   * AI image for a picked draft, made inside the approval (owner decision,
   * 6 Sep 2026: images are made on approval). Resolves to the image, or null
   * when it failed, the allowance was used up, or the user tapped "Skip the
   * image" — the approval then goes ahead as text. A skipped in-flight image
   * is discarded when it lands; the allowance was spent, per the no-remake
   * rule the card states before the tap.
   */
  async function generatePostImageForApproval(item: QueueItem): Promise<string | null> {
    const project = draftProjectPayload();
    if (!project || !selectedProject) return null;
    postImageSkippedIdsRef.current.delete(item.id);
    setPostImageBusyId(item.id);
    setPostImageErrors((current) => (item.id in current ? { ...current, [item.id]: "" } : current));
    const skipped = new Promise<null>((resolve) => {
      postImageSkipResolversRef.current.set(item.id, () => resolve(null));
    });
    const generated = (async (): Promise<string | null> => {
      try {
        const response = await fetch("/api/social/post-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            walletAddress,
            projectId: selectedProject.id,
            displayName: selectedProject.name,
            project: { name: project.name, ticker: project.ticker, description: project.description },
            postText: item.xText.trim() || item.telegramText.trim(),
            mascotVisualDNA,
          }),
        });
        const payload = (await response.json()) as { imageDataUrl?: string; usage?: MascotImageUsage; error?: string };
        if (payload.usage) setMascotImageUsage(payload.usage);
        if (!response.ok || !payload.imageDataUrl) {
          throw new Error(payload.error || "The image could not be made for this post.");
        }
        // Skipped while it was being made: the slot is spent, the result is not used.
        if (postImageSkippedIdsRef.current.has(item.id)) {
          postImageSkippedIdsRef.current.delete(item.id);
          return null;
        }
        return payload.imageDataUrl;
      } catch (error) {
        setPostImageErrors((current) => ({
          ...current,
          [item.id]: error instanceof Error ? error.message : "The image could not be made for this post.",
        }));
        return null;
      }
    })();
    try {
      return await Promise.race([generated, skipped]);
    } finally {
      postImageSkipResolversRef.current.delete(item.id);
      setPostImageBusyId((current) => (current === item.id ? null : current));
      void loadMascotImageUsage();
    }
  }

  /** "No image" on a picked draft before approving: nothing was made, so the pick simply moves to the next best draft. */
  function declinePostImage(id: string) {
    setQueue((current) => {
      const next = current.map((item) => (item.id === id ? { ...item, imageDeclined: true } : item));
      persistSocialStudio({ queue: next });
      return next;
    });
  }

  /** "Skip the image" while it is being made: the approval continues at once as text; the in-flight result is discarded (the allowance was spent). */
  function skipPostImage(id: string) {
    postImageSkippedIdsRef.current.add(id);
    postImageSkipResolversRef.current.get(id)?.();
    setQueue((current) => {
      const next = current.map((item) => (item.id === id ? { ...item, imageDeclined: true } : item));
      persistSocialStudio({ queue: next });
      return next;
    });
  }

  /**
   * Approves a Ready-to-review draft (issue #352 -> issue #335's
   * approval-is-creation POST /api/social/posts), one tap. Destinations are
   * derived, never toggled (owner direction, 6 Sep 2026): every connected
   * platform whose field carries text. The backend stores one shared `body`
   * per post but xText and telegramText usually differ, so each destination
   * becomes its own approval call — under the day's approval session when
   * one is live, else wallet-signed per post. A picked draft gets its AI
   * image made first; the schedule is computed NOW and never in the past.
   */
  async function approveQueueItem(item: QueueItem) {
    if (!selectedProject) {
      setPostsStatus({ tone: "error", message: "Add your token details before approving a post." });
      promptForTokenDetails("Add your token details before approving a post.");
      return;
    }
    const destinations = approvalDestinations(item, myConnectedPlatforms);
    if (destinations.length === 0) {
      setPostsStatus({
        tone: "error",
        message: myConnectedPlatforms.length === 0 ? "Connect X or Telegram in Setup before approving a post." : "Give this post text for X or Telegram before approving it.",
      });
      return;
    }
    if (destinations.includes("x") && item.xText.trim().length > 280) {
      setPostsStatus({ tone: "error", message: `X posts must be 280 characters or fewer. Remove ${item.xText.trim().length - 280} characters.` });
      return;
    }
    const sendingTemplate = destinations.some((platform) => isUneditedTemplateText(platform === "x" ? item.xText : item.telegramText, templateOutputs));
    if (sendingTemplate && !templateAcknowledgedIds[item.id]) {
      setExpandedQueueItemIds((current) => ({ ...current, [item.id]: true }));
      setPostsStatus({ tone: "error", message: "This is unedited template text — tick the box on the draft to send it as-is, or edit it first." });
      return;
    }

    setApprovingItemId(item.id);
    setPostsStatus({ tone: "progress", message: "Approving…" });
    let approvedAny = false;
    let replacedAny = false;
    let failureMessage = "";
    /** Set when quiet hours moved the approval time, so the success line says where it went. */
    let quietHoursMovedTo = "";
    try {
      let artwork = item.artwork;
      if (postImageCandidateIds.has(item.id) && !artwork && !item.imageDeclined) {
        setPostsStatus({ tone: "progress", message: "Making the AI image for this post — about 30 seconds…" });
        artwork = await generatePostImageForApproval(item);
        setPostsStatus({ tone: "progress", message: "Approving…" });
      }

      // The time is decided now, at approval, never when the card first
      // appeared (owner report, 6 Sep 2026: "the time has passed"): the
      // user's own pick if they made one, else the cadence spread from what
      // is pending right now — and never earlier than two minutes from now.
      const now = new Date();
      const awaitingIso = scheduledPosts.filter((post) => isPendingSendStatus(post.status)).map((post) => post.scheduledAt);
      const rawPicked =
        scheduleManuallySet[item.id] && itemScheduledAt[item.id]
          ? fromDateTimeLocalValue(itemScheduledAt[item.id], timezone)
          : calendarDayScheduledAt(item, awaitingIso, now) ?? computeDefaultScheduledAt(awaitingIso, now, cadenceSpreadHoursMs(postingCadence), dailyStartTime, timezone);
      // Quiet hours apply to every approval, the user's own pick included:
      // the future clamp runs first so a lifted past time can't land back
      // inside the window, and the clamp below is then a no-op.
      const picked = shiftOutOfQuietHours(ensureFutureScheduledAt(rawPicked, now), quietHours, timezone);
      const scheduledAtIso = ensureFutureScheduledAt(picked, now).toISOString();
      if (picked.getTime() !== ensureFutureScheduledAt(rawPicked, now).getTime()) quietHoursMovedTo = formatScheduledAt(scheduledAtIso, timezone);

      let authMode: "session" | "signature";
      try {
        authMode = await ensureApprovalSession();
      } catch (error) {
        failureMessage = error instanceof Error ? error.message : "Approvals could not be unlocked.";
        return;
      }

      for (const platform of destinations) {
        const body = (platform === "x" ? item.xText : item.telegramText).trim();
        try {
          const proof =
            authMode === "signature"
              ? await signSocialStudioChallenge(SOCIAL_STUDIO_ACTION_PURPOSES.postCreate, {
                  body,
                  destinations: platform,
                  scheduledAt: scheduledAtIso,
                })
              : null;
          const response = await fetch("/api/social/posts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              body,
              walletAddress,
              projectId: selectedProject.id,
              displayName: selectedProject.name,
              artworkDataUrl: artwork || undefined,
              destinations: [platform],
              scheduledAt: scheduledAtIso,
              ...(proof ? { challengeId: proof.challengeId, nonce: proof.nonce, signature: proof.signature } : {}),
            }),
          });
          if (response.status === 401 && authMode === "session") {
            // The day's session lapsed between the check and the call.
            setApprovalSession(null);
            throw new Error("Approvals locked again — tap Approve once more to unlock with one signature.");
          }
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
      : quietHoursMovedTo
        ? `Approved and scheduled — moved to ${quietHoursMovedTo} to stay out of quiet hours.`
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
    setPostsStatus({ tone: "success", message: "X composer opened with the approved post filled in." });
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

  // Fills in a shown default schedule time for any Ready-to-review draft that
  // doesn't have one yet (new drafts from Setup/Calendar/replenish) — never
  // overwrites a time the user picked. Display only: approveQueueItem
  // recomputes the default at approval time unless the user picked their own.
  useEffect(() => {
    const awaitingIso = scheduledPosts.filter((post) => isPendingSendStatus(post.status)).map((post) => post.scheduledAt);
    setItemScheduledAt((current) => {
      let changed = false;
      const next = { ...current };
      for (const item of queue) {
        if (next[item.id] === undefined) {
          const now = new Date();
          const base = calendarDayScheduledAt(item, awaitingIso, now) ?? computeDefaultScheduledAt(awaitingIso, now, cadenceSpreadHoursMs(postingCadence), dailyStartTime, timezone);
          next[item.id] = toDateTimeLocalValue(shiftOutOfQuietHours(base, quietHours, timezone), timezone);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [queue, scheduledPosts, postingCadence, quietHours, timezone, dailyStartTime]);

  // Queue tab data is fetched client-side only (never in the background) on
  // tab open, on window/tab focus while the tab is active, and after
  // approve/cancel actions elsewhere — issue #352's explicit "replenish on
  // app open / tab focus" boundary, not a poller or a server cron.
  // Every render publishes the live queue, target, project and the latest
  // Queue-tab functions into refs, so long-lived listeners and the replenish
  // loop read what is true now rather than what was true when they were created.
  useEffect(() => {
    queueRef.current = queue;
    queueTargetRef.current = queueTarget;
    selectedProjectIdRef.current = selectedProjectId;
    queueTabActionsRef.current = { loadScheduledPosts, loadConnections, replenishQueue };
  });

  // Scheduled posts used to load only when the Queue tab opened, so the
  // header's TODAY x/5 pill read 0/5 on every other tab until then (owner
  // test, 7 Sep 2026). Load once per wallet on arrival and again whenever
  // the Calendar tab opens; the Queue tab keeps its own load below.
  const postsLoadedForWalletRef = useRef("");
  useEffect(() => {
    if (!walletAddress) return;
    const firstLoadForWallet = postsLoadedForWalletRef.current !== walletAddress;
    postsLoadedForWalletRef.current = walletAddress;
    if (activeTab === "queue") return;
    if (!firstLoadForWallet && activeTab !== "calendar") return;
    void queueTabActionsRef.current.loadScheduledPosts();
  }, [activeTab, walletAddress]);

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
      // Through the ref, never the closure: this listener outlives many
      // renders, and a replenish frozen at an earlier (emptier) queue kept
      // generating paid drafts on every focus.
      void queueTabActionsRef.current.loadScheduledPosts();
      void queueTabActionsRef.current.loadConnections();
      void queueTabActionsRef.current.replenishQueue();
    }
    window.addEventListener("focus", handleFocusOrVisible);
    document.addEventListener("visibilitychange", handleFocusOrVisible);
    return () => {
      window.removeEventListener("focus", handleFocusOrVisible);
      document.removeEventListener("visibilitychange", handleFocusOrVisible);
    };
    // Re-runs when the Queue tab is opened, the active project/wallet changes, or the project's saved queue finishes loading (so the first replenish sees the real count); the activation calls close over that render's fresh state, and the focus handler reads the latest functions through queueTabActionsRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, selectedProjectId, walletAddress, loadedRecordProjectId]);

  async function handleMascotFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const project = draftProjectPayload();
    if (!project) {
      setMascotUploadStatus({ tone: "error", message: "Add your token details before uploading mascot artwork." });
      promptForTokenDetails("Add your token details before uploading mascot artwork.");
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
            ? "Mascot identity locked in. Your post images will feature them."
            : `Mascot identity locked in — ${assessment.summary} Your post images will feature them.`,
      });
    } catch (error) {
      setMascotUploadStatus({ tone: "error", message: error instanceof Error ? error.message : "The mascot artwork could not be analysed." });
    } finally {
      setMascotBusy(false);
    }
  }


  /** Clears a stale approval or quick-send confirmation (issue #380, extended #382) — any edit to what will be sent must be re-reviewed before it can be approved or quick-sent. */
  function clearApprovalConfirmation(id: string) {
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
    setItemScheduledAt((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
    if (!options.silent) {
      setPostsStatus({ tone: "success", message: "Removed from Ready to review." });
      void replenishQueue();
    }
  }

  function postQueueItemToX(item: QueueItem) {
    if (!item.xText.trim()) {
      setPostsStatus({ tone: "error", message: "Write the X text before posting." });
      return;
    }
    if (item.xText.length > 280) {
      setPostsStatus({ tone: "error", message: `X posts must be 280 characters or fewer. Remove ${item.xText.length - 280} characters.` });
      return;
    }
    const url = `https://x.com/intent/post?text=${encodeURIComponent(item.xText)}`;
    window.open(url, "_blank", "noopener,noreferrer");
    setPostsStatus({ tone: "success", message: "X composer opened with the queued post filled in." });
  }

  async function sendQueueItemToTelegram(item: QueueItem) {
    if (!selectedProject) {
      promptForTokenDetails("Add your token details before publishing.");
      return;
    }
    if (!telegramConnection || telegramConnection.status !== "connected" || !item.telegramText.trim()) {
      setPostsStatus({ tone: "error", message: "Connect a verified Telegram channel in Setup and add post text first." });
      return;
    }

    setBusy(true);
    setPostsStatus({ tone: "progress", message: "Sending the queued post through the Hoodlums Telegram bot…" });
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
      setPostsStatus({ tone: "success", message: "Queued post published through the Hoodlums Telegram bot." });
    } catch (error) {
      setPostsStatus({ tone: "error", message: error instanceof Error ? error.message : "Telegram publishing failed." });
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
    setCalendarView({ year: todayInZone.year, month: todayInZone.month });
    setSelectedDay({ year: todayInZone.year, month: todayInZone.month, day: todayInZone.day });
    if (!calendarTimeTouchedRef.current) setCalendarTime(defaultCalendarClockTime(toCalendarDayIso(todayInZone.year, todayInZone.month, todayInZone.day), now, timezone, dailyStartTime));
  }

  function selectDay(day: number) {
    setSelectedDay({ year: calendarView.year, month: calendarView.month, day });
    if (!calendarTimeTouchedRef.current) setCalendarTime(defaultCalendarClockTime(toCalendarDayIso(calendarView.year, calendarView.month, day), new Date(), timezone, dailyStartTime));
  }

  function setCalendarTimeFromField(value: string) {
    if (parseClockTime(value) === null) return;
    calendarTimeTouchedRef.current = true;
    setCalendarTime(value);
  }


  async function handleExternalArtwork(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      setExternalStatus({ tone: "error", message: "Use a PNG, JPG or WEBP image." });
      return;
    }
    if (file.size > MAX_MASCOT_IMAGE_BYTES) {
      setExternalStatus({ tone: "error", message: "Keep the artwork under 3 MB." });
      return;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setExternalForm((current) => ({ ...current, artworkDataUrl: dataUrl }));
      setExternalStatus(null);
    } catch (error) {
      setExternalStatus({ tone: "error", message: error instanceof Error ? error.message : "The artwork could not be read." });
    }
  }

  function fillOutTokenDetailsLater() {
    writeTokenDetailsLater(projectOwner, true);
    setDetailsLater(true);
    setAddTokenOpen(false);
    setEditingProjectId(null);
    setExternalStatus(null);
  }

  function closeTokenDetails() {
    if (projects.length === 0) {
      fillOutTokenDetailsLater();
      return;
    }
    setAddTokenOpen(false);
    setEditingProjectId(null);
    setExternalForm(EMPTY_EXTERNAL_FORM);
    setExternalStatus(null);
  }

  /** Prefills the details box with an added (external) token so its details can be changed in place. */
  function openEditTokenDetails(project: TokenProject, reason?: string) {
    setEditingProjectId(project.id);
    setExternalForm({
      name: project.name,
      ticker: project.ticker,
      networkChoice: project.network ? "other" : project.chain,
      networkOther: project.network ?? "",
      contractAddress: project.contractAddress,
      description: project.description,
      xHandle: project.xHandle,
      telegram: project.telegram,
      artworkDataUrl: project.id === selectedProjectId ? projectArtwork : "",
    });
    setProjectMenuOpen(false);
    setAddTokenOpen(true);
    setExternalStatus(reason ? { tone: "progress", message: reason } : null);
    window.requestAnimationFrame(() => {
      document.querySelector("[data-add-token-form]")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  // Saves a token launched anywhere into the confirmed wallet's own vault as
  // an external project (Social-only: the launch tooling filters it out) and
  // selects it — or, when editing, rewrites that added token in place.
  // Requires a confirmed wallet — the project must land in that wallet's
  // partition and nowhere else. Handles are stored bare (no "@", no
  // "t.me/"): cleanHandle/cleanTelegram add the prefix when a post needs it.
  async function addExternalProject() {
    if (!projectOwner) {
      setExternalStatus({ tone: "error", message: "Confirm your wallet in Account first — the token is saved to that wallet." });
      return;
    }
    const name = externalForm.name.trim();
    const ticker = externalForm.ticker.trim().replace(/^\$/, "").toUpperCase();
    const description = externalForm.description.trim();
    const networkOther = externalForm.networkOther.replace(/\s+/g, " ").trim();
    const contractAddress = externalForm.contractAddress.trim();
    const xHandle = bareXHandle(externalForm.xHandle);
    const telegram = bareTelegramHandle(externalForm.telegram);
    if (!name) {
      setExternalStatus({ tone: "error", message: "Give the token a name." });
      return;
    }
    if (!/^[A-Z0-9]{1,12}$/.test(ticker)) {
      setExternalStatus({ tone: "error", message: "Ticker: 1–12 letters or numbers, no symbols." });
      return;
    }
    if (externalForm.networkChoice === "other" && !networkOther) {
      setExternalStatus({ tone: "error", message: "Name the network the token lives on." });
      return;
    }
    if (externalForm.networkChoice === "robinhood" && contractAddress && !isAddress(contractAddress)) {
      setExternalStatus({ tone: "error", message: "That is not a valid contract address for Robinhood Chain." });
      return;
    }
    if (!description) {
      setExternalStatus({ tone: "error", message: "Add a sentence about the token — the AI drafts from it." });
      return;
    }

    const now = new Date().toISOString();
    const looksEvm = /^0x[0-9a-fA-F]{40}$/.test(contractAddress);
    const chain: TokenProject["chain"] =
      externalForm.networkChoice === "solana" ? "solana" : externalForm.networkChoice === "robinhood" ? "robinhood" : looksEvm ? "robinhood" : "solana";
    const editing = editingProjectId ? projects.find((item) => item.id === editingProjectId && isExternalProject(item)) ?? null : null;
    const project: TokenProject = {
      id: editing?.id ?? crypto.randomUUID(),
      createdAt: editing?.createdAt ?? now,
      updatedAt: now,
      status: contractAddress ? "launched" : "draft",
      chain,
      origin: "external",
      ...(externalForm.networkChoice === "other" ? { network: networkOther } : {}),
      name,
      ticker,
      description,
      supply: "",
      decimals: chain === "solana" ? 9 : 18,
      websiteSlug: "",
      contractAddress,
      xHandle,
      telegram,
      heroImage: externalForm.artworkDataUrl,
      theme: "hoodlums",
    };

    setExternalSaving(true);
    setExternalStatus({ tone: "progress", message: "Saving to your wallet's projects…" });
    try {
      const outcome = await saveProjectToStorage(project, readProjectIndex(projectOwner), projectOwner);
      if (!outcome.success) {
        setExternalStatus({ tone: "error", message: outcome.error });
        return;
      }
      setProjects(safeProjects(readProjectIndex(projectOwner)));
      setSelectedProjectId(project.id);
      if (!editing) {
      }
      setExternalForm(EMPTY_EXTERNAL_FORM);
      setEditingProjectId(null);
      setAddTokenOpen(false);
      setExternalStatus(null);
      writeTokenDetailsLater(projectOwner, false);
      setDetailsLater(false);
      setExternalStatus({ tone: "success", message: editing ? `${name} updated.` : `${name} added to Hoodlums Social. Only wallet ${shortAddress(projectOwner)} sees it.` });
    } finally {
      setExternalSaving(false);
    }
  }

  function renderAddTokenForm() {
    const isOther = externalForm.networkChoice === "other";
    return (
      <div className={styles.connectionDrawer} data-add-token-form>
        <span className={styles.eyebrow}>{editingProjectId ? "EDIT TOKEN DETAILS" : projects.length === 0 ? "TELL US ABOUT YOUR TOKEN" : "ADD AN EXISTING TOKEN"}</span>
        <p className={styles.connectionHelper}>
          {editingProjectId
            ? "Changes apply to this token everywhere in Hoodlums Social."
            : projects.length === 0
              ? "Everything our tools work from. Nothing here is required right now — fill it out later and any tool that needs a detail will ask for it. Saved to your confirmed wallet only."
              : "For a token launched anywhere else. It is saved to your confirmed wallet and appears only in Hoodlums Social — never in the launch tools."}
        </p>
        {!projectOwner ? (
          <p className={styles.connectionStateWarning}>Confirm your wallet in Account first — the token is saved to that wallet.</p>
        ) : null}
        <div className={styles.addTokenGrid}>
          <label className={styles.connectionField}>
            <span>Token name</span>
            <input value={externalForm.name} maxLength={80} placeholder="Token name" onChange={(event) => setExternalForm((current) => ({ ...current, name: event.target.value }))} />
          </label>
          <label className={styles.connectionField}>
            <span>Ticker</span>
            <input value={externalForm.ticker} maxLength={13} placeholder="TICKER" onChange={(event) => setExternalForm((current) => ({ ...current, ticker: event.target.value }))} />
          </label>
          <label className={styles.connectionField}>
            <span>Network</span>
            <select value={externalForm.networkChoice} onChange={(event) => setExternalForm((current) => ({ ...current, networkChoice: event.target.value as ExternalNetworkChoice }))}>
              <option value="robinhood">Robinhood Chain</option>
              <option value="solana">Solana</option>
              <option value="other">Other network</option>
            </select>
          </label>
          {isOther ? (
            <label className={styles.connectionField}>
              <span>Network name</span>
              <input value={externalForm.networkOther} maxLength={40} placeholder="Ethereum, Base, PulseChain…" onChange={(event) => setExternalForm((current) => ({ ...current, networkOther: event.target.value }))} />
            </label>
          ) : null}
          <label className={styles.connectionField}>
            <span>Contract or mint address <em>optional</em></span>
            <input value={externalForm.contractAddress} maxLength={120} placeholder="0x…" onChange={(event) => setExternalForm((current) => ({ ...current, contractAddress: event.target.value }))} />
          </label>
          <label className={styles.connectionField}>
            <span>X handle <em>optional · no @</em></span>
            <input value={externalForm.xHandle} maxLength={60} placeholder="yourhandle" onChange={(event) => setExternalForm((current) => ({ ...current, xHandle: event.target.value }))} />
          </label>
          <label className={styles.connectionField}>
            <span>Telegram <em>optional · username only</em></span>
            <input value={externalForm.telegram} maxLength={60} placeholder="yourchannel" onChange={(event) => setExternalForm((current) => ({ ...current, telegram: event.target.value }))} />
          </label>
          <label className={`${styles.connectionField} ${styles.addTokenWide}`}>
            <span>What is the token about?</span>
            <textarea rows={3} value={externalForm.description} maxLength={600} placeholder="One or two sentences. The AI only ever states facts from here." onChange={(event) => setExternalForm((current) => ({ ...current, description: event.target.value }))} />
          </label>
          <label className={`${styles.connectionField} ${styles.addTokenWide}`}>
            <span>Artwork <em>optional · PNG, JPG or WEBP up to 3 MB</em></span>
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleExternalArtwork} />
            {externalForm.artworkDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className={styles.addTokenArtworkPreview} src={externalForm.artworkDataUrl} alt="" />
            ) : null}
          </label>
        </div>
        <div className={styles.composerActions}>
          <button type="button" className={styles.connectionActionPrimary} onClick={addExternalProject} disabled={externalSaving || !projectOwner}>
            {editingProjectId ? "Save changes" : projects.length === 0 ? "Save token details" : "Add to Hoodlums Social"}
          </button>
          <button type="button" className={styles.connectionAction} onClick={closeTokenDetails}>
            {projects.length === 0 && !editingProjectId ? "Fill out later" : "Cancel"}
          </button>
        </div>
        <InlineStatus status={externalStatus} />
      </div>
    );
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
                        <small>${project.ticker || "TOKEN"} · {projectNetworkLabel(project)}{isExternalProject(project) ? " · added" : ""}</small>
                      </span>
                    </button>
                  ))}
                  {selectedProject && isExternalProject(selectedProject) ? (
                    <button type="button" className={styles.projectMenuItem} onClick={() => openEditTokenDetails(selectedProject)} role="option" aria-selected={false}>
                      <span className={styles.projectMenuMark}>✎</span>
                      <span>
                        <b>Edit token details</b>
                        <small>{selectedProject.name || "This token"} · name, network, description, handles, artwork</small>
                      </span>
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={styles.projectMenuItem}
                    onClick={() => {
                      setProjectMenuOpen(false);
                      setEditingProjectId(null);
                      setExternalForm(EMPTY_EXTERNAL_FORM);
                      setAddTokenOpen(true);
                    }}
                    role="option"
                    aria-selected={false}
                  >
                    <span className={styles.projectMenuMark}>+</span>
                    <span>
                      <b>Add an existing token</b>
                      <small>Any network · launched anywhere</small>
                    </span>
                  </button>
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

        {(() => {
          // The studio is always usable. With no project for this wallet the
          // token-details box opens on arrival (never mandatory — "Fill out
          // later" hides it and tools ask at the moment they need details).
          const showDetailsBox = addTokenOpen || (projects.length === 0 && !detailsLater);
          return (
          <section className={styles.studioPanel}>
            {showDetailsBox ? <div className={styles.addTokenPanel}>{renderAddTokenForm()}</div> : null}
            {selectedProjectId && !dailyStartTime && !dailyStartLater && !showDetailsBox ? (
              <div className={styles.detailsReminder}>
                <span>
                  <b>What time should your posts start each day?</b> The day&apos;s first post goes out then, and the rest space out from it.
                </span>
                <div className={styles.startTimeAsk}>
                  <input
                    type="time"
                    aria-label="Daily start time"
                    value={dailyStartDraft}
                    onChange={(event) => setDailyStartDraft(event.target.value)}
                  />
                  <button type="button" className={styles.connectionAction} onClick={() => updateDailyStartTime(dailyStartDraft)}>
                    Set this time
                  </button>
                  <button type="button" className={styles.quietHoursToggle} onClick={askDailyStartLater}>
                    Not now
                  </button>
                </div>
              </div>
            ) : null}
            {projects.length === 0 && !showDetailsBox ? (
              <div className={styles.detailsReminder}>
                <span>
                  <b>No token details yet.</b> Tools that need them will ask. Launched on Hoodlums? <Link href="/">Open the launch studio</Link>.
                </span>
                <button type="button" className={styles.connectionAction} onClick={() => promptForTokenDetails("Tell us about your token.")}>
                  Add token details
                </button>
              </div>
            ) : null}
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
                  {mascotImageUsage ? (
                    <>
                      <i className={styles.metaPillDivider} aria-hidden="true" />
                      <b>{describeMascotImageAllowance(mascotImageUsage).split(" ")[0]}</b> AI images
                    </>
                  ) : null}
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
                            <span>
                              {xConfigured === false
                                ? "Not configured on this deployment"
                                : xConnection?.status === "connected"
                                  ? xConnection.displayName
                                  : xConnection?.status === "reconnect_needed"
                                    ? "Needs reconnecting"
                                    : xHandle
                                      ? `${xHandle} · not connected yet`
                                      : "Not connected yet"}
                            </span>
                          </div>
                          {xConnection?.status === "connected" ? (
                            <button
                              type="button"
                              className={styles.connectionAction}
                              onClick={disconnectX}
                              disabled={xConnectBusy}
                            >
                              {xConnectBusy ? "Disconnecting…" : "Disconnect"}
                            </button>
                          ) : xConfigured ? (
                            <button
                              type="button"
                              className={styles.connectionActionPrimary}
                              onClick={connectX}
                              disabled={xConnectBusy || !walletAddress}
                              title={walletAddress ? "Sign once in your wallet, then approve Hoodlums on X." : "Connect your wallet first."}
                            >
                              {xConnectBusy ? "Opening X…" : xConnection?.status === "reconnect_needed" ? "Reconnect" : "Connect X"}
                            </button>
                          ) : (
                            <span className={xConfigured === false ? styles.connectionStateError : styles.connectionState}>
                              {xConfigured === null ? "Checking…" : "Not configured"}
                            </span>
                          )}
                        </div>
                        {xConnection?.status === "reconnect_needed" && xConnection.reconnectReason ? (
                          <p className={styles.connectionHelper}>{xConnection.reconnectReason}</p>
                        ) : xConnection?.status === "connected" ? (
                          <p className={styles.connectionHelper}>{X_BIO_LINK_NOTE}</p>
                        ) : xConfigured === false ? (
                          <p className={styles.connectionHelper}>Until X is switched on, “Post to X” below opens X&apos;s own composer with your text filled in, so you tap send yourself.</p>
                        ) : null}
                        <InlineStatus status={xStatus} />
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
                                disabled={(Boolean(buyBotUnavailableReason) && Boolean(selectedProject)) || telegramConfigured === false}
                                title={buyBotUnavailableReason ?? undefined}
                                onClick={() => {
                                  if (!selectedProject) {
                                    promptForTokenDetails("Add your token details before adding the Buy Bot.");
                                    return;
                                  }
                                  setBuyBotDrawerOpen((current) => !current);
                                }}
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
                        <div
                          className={`${styles.exampleDrawer} ${voiceExamplesOpen ? styles.exampleDrawerOpen : ""}`}
                          onPointerEnter={openVoiceExamplesFromPointer}
                          onPointerLeave={closeVoiceExamplesFromPointer}
                        >
                          <button
                            type="button"
                            className={styles.exampleDrawerToggle}
                            aria-expanded={voiceExamplesOpen}
                            aria-controls="voice-saved-examples"
                            onClick={() => setVoiceExamplesOpen((open) => !open)}
                          >
                            <span>Saved examples</span>
                            <b>{voiceExamples.length}</b>
                            <i aria-hidden="true">{voiceExamplesOpen ? "▴" : "▾"}</i>
                          </button>
                          <div className={styles.exampleDrawerBox} id="voice-saved-examples">
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
                          </div>
                        </div>
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
                        </div>
                      </div>

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
                    <div className={styles.sectionHeading}>
                      <div>
                        <h2>Your mascot</h2>
                        <p>
                          {mascotVisualDNA
                            ? "Locked in. Every image made for an approved post features this character — and only them."
                            : "Upload once. Every image made for an approved post will feature this character — and only them. Nothing is generated here."}
                        </p>
                      </div>
                    </div>
                    <div className={styles.mascotSingle}>
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
                        <p>Tap a day to add something. Lime marks scheduled posts, hollow marks drafts waiting for your approve tap.</p>
                      </div>
                      <div className={styles.timezoneControl}>
                        <span>ALL TIMES SHOWN IN</span>
                        <b>{detectedTimezone}</b>
                        {timezoneEditing ? (
                          <div className={styles.timezonePicker} ref={timezonePickerRef}>
                            <input
                              type="text"
                              autoFocus
                              value={timezoneQuery}
                              aria-label="Search time zones"
                              placeholder="Type a city — London, New York…"
                              onChange={(event) => setTimezoneQuery(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" && timezoneMatches[0]) updateTimezone(timezoneMatches[0]);
                                if (event.key === "Escape") setTimezoneEditing(false);
                              }}
                            />
                            <div className={styles.timezoneResults} role="listbox" aria-label="Time zones">
                              <button type="button" role="option" aria-selected={!timezone} onClick={() => updateTimezone("")}>
                                <b>Follow this device</b>
                                {deviceTimezone ? <em>{timezone ? deviceTimezone : `✓ ${deviceTimezone}`}</em> : null}
                              </button>
                              {timezoneMatches.map((zone) => (
                                <button
                                  type="button"
                                  key={zone}
                                  role="option"
                                  aria-selected={zone === timezone}
                                  onClick={() => updateTimezone(zone)}
                                >
                                  <b>{zone.replace(/_/g, " ")}</b>
                                  <em>{zone === timezone ? `✓ ${timezoneOffsetLabel(zone)}` : timezoneOffsetLabel(zone)}</em>
                                </button>
                              ))}
                              {timezoneQuery.trim() && timezoneMatches.length === 0 ? (
                                <p>No zone matches that. Try a city name.</p>
                              ) : null}
                            </div>
                            <button type="button" className={styles.timezoneEdit} onClick={() => setTimezoneEditing(false)}>
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button type="button" className={styles.timezoneEdit} onClick={openTimezonePicker}>
                            {timezone ? "Change" : "Edit local time"}
                          </button>
                        )}
                      </div>
                    </div>

                    <div className={styles.calendarLayout}>
                      <div>
                        <div className={styles.desktopCalendar}>
                          {CALENDAR_DAY_NAMES.map((day) => <span key={day}>{day}</span>)}
                          {monthGrid.map((day, index) => {
                            const isToday = day !== null && isCurrentMonthView && day === todayInZone.day;
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
                            const marks = day !== null ? calendarDayMarks.get(day) : undefined;
                            return (
                              <button
                                type="button"
                                disabled={day === null}
                                key={`${calendarView.year}-${calendarView.month}-${day ?? "blank"}-${index}`}
                                className={className}
                                title={day !== null ? describeCalendarDayMarks(marks, isToday) : undefined}
                                onClick={day !== null ? () => selectDay(day) : undefined}
                              >
                                {day}
                                {marks ? (
                                  <span className={styles.dayMarks} aria-hidden="true">
                                    {marks.scheduled ? <i className={styles.limeDot} /> : null}
                                    {marks.drafts ? <i className={styles.draftDot} /> : null}
                                    {marks.sent || marks.failed ? <i className={styles.greyDot} /> : null}
                                  </span>
                                ) : null}
                              </button>
                            );
                          })}
                        </div>
                        <div className={styles.mobileWeek} ref={mobileWeekRef}>
                          {monthDays.map((day) => {
                            const weekdayIndex = (new Date(calendarView.year, calendarView.month, day).getDay() + 6) % 7;
                            const isToday = isCurrentMonthView && day === todayInZone.day;
                            const isSelected =
                              selectedDay.year === calendarView.year &&
                              selectedDay.month === calendarView.month &&
                              day === selectedDay.day;
                            return (
                              <button
                                type="button"
                                key={day}
                                data-day={day}
                                onClick={() => selectDay(day)}
                                className={isSelected ? styles.weekSelected : isToday ? styles.weekToday : styles.weekDay}
                              >
                                <span>{CALENDAR_DAY_NAMES[weekdayIndex]}</span>
                                <b>{day}</b>
                                <small>{describeCalendarDayMarks(calendarDayMarks.get(day), isToday)}</small>
                              </button>
                            );
                          })}
                        </div>
                        <div className={styles.calendarLegend}>
                          <span><i className={styles.limeDot} />Scheduled</span>
                          <span><i className={styles.draftDot} />Draft to approve</span>
                          <span><i className={styles.greyDot} />Sent</span>
                        </div>
                      </div>

                      <aside className={styles.scheduleCard}>
                        <div>
                          <span className={styles.eyebrow}>ADD TO</span>
                          <h3>{selectedDayLabel}</h3>
                          <label className={styles.addToTime}>
                            <span>at</span>
                            <input
                              type="time"
                              aria-label="Time on this day"
                              value={calendarTime}
                              onChange={(event) => setCalendarTimeFromField(event.target.value)}
                            />
                            {calendarTimeQuietNote ? <small>{calendarTimeQuietNote}</small> : null}
                          </label>
                        </div>
                        {selectedDayEntries.length > 0 ? (
                          <ul className={styles.dayEntries}>
                            {selectedDayEntries.map((entry) => (
                              <li key={`${entry.kind}-${entry.id}`}>
                                <button type="button" onClick={() => setActiveTab("queue")} title="Open in the Queue">
                                  {entry.kind === "post" ? (
                                    <>
                                      <b>{entry.timeLabel}</b>
                                      <span>{entry.platforms.join(" + ") || "no destination"} · {describeCalendarPostStatus(entry.status)}</span>
                                    </>
                                  ) : (
                                    <>
                                      <b>Draft</b>
                                      <span>Waiting for your approve tap · {describeDraftSource(entry.source)}</span>
                                    </>
                                  )}
                                  <em>{entry.body}</em>
                                </button>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        <span className={styles.eyebrow}>ANNOUNCEMENT</span>
                        <div className={styles.ownPostComposer}>
                            <div className={styles.announcementTabs} role="tablist" aria-label="Announcement mode">
                              <button
                                type="button"
                                role="tab"
                                aria-selected={announcementMode === "own"}
                                className={announcementMode === "own" ? styles.announcementTabActive : styles.announcementTab}
                                onClick={() => { setAnnouncementMode("own"); setAnnouncementStatus(null); }}
                              >
                                My words
                              </button>
                              <button
                                type="button"
                                role="tab"
                                aria-selected={announcementMode === "ai"}
                                className={announcementMode === "ai" ? styles.announcementTabActive : styles.announcementTab}
                                onClick={() => { setAnnouncementMode("ai"); setAnnouncementStatus(null); }}
                              >
                                AI jazz-up
                              </button>
                              <button
                                type="button"
                                role="tab"
                                aria-selected={announcementMode === "now"}
                                className={announcementMode === "now" ? styles.announcementTabActive : styles.announcementTab}
                                onClick={openPostNow}
                              >
                                Post now
                              </button>
                            </div>
                            {announcementMode !== "now" ? (
                              <textarea
                                value={announcementText}
                                onChange={(event) => setAnnouncementText(event.target.value)}
                                placeholder={`Your announcement for ${selectedDayLabel}`}
                                rows={4}
                                maxLength={ANNOUNCEMENT_MAX_LENGTH}
                              />
                            ) : null}
                            {announcementMode === "now" ? (
                              <>
                                <div className={styles.announcementResult}>
                                  <label>
                                    <span className={postNowX.trim().length > X_CHARACTER_LIMIT ? styles.ownPostOver : undefined}>
                                      X · {postNowX.trim().length}/{X_CHARACTER_LIMIT}
                                    </span>
                                    <textarea value={postNowX} onChange={(event) => setPostNowX(event.target.value)} placeholder="The X post" rows={3} />
                                  </label>
                                  <label>
                                    <span>Telegram</span>
                                    <textarea value={postNowTelegram} onChange={(event) => setPostNowTelegram(event.target.value)} placeholder="The Telegram post" rows={4} />
                                  </label>
                                </div>
                                <label className={styles.checkbox}>
                                  <input type="checkbox" checked={includeArtwork} onChange={(event) => setIncludeArtwork(event.target.checked)} />
                                  <span>Attach the token artwork to Telegram</span>
                                </label>
                                <div className={styles.composerActions}>
                                  <button type="button" className={styles.ownPostAdd} onClick={() => void postNowToTelegram()} disabled={busy}>
                                    {busy ? "Sending…" : "Send to Telegram now"}
                                  </button>
                                  <button type="button" onClick={postNowToX}>Post to X now</button>
                                </div>
                              </>
                            ) : announcementMode === "own" ? (
                              <>
                                <div className={styles.ownPostMeta}>
                                  <span className={announcementText.trim().length > X_CHARACTER_LIMIT ? styles.ownPostOver : undefined}>
                                    {announcementText.trim().length}/{X_CHARACTER_LIMIT} for X
                                  </span>
                                </div>
                                <div className={styles.composerActions}>
                                  <button type="button" className={styles.ownPostAdd} onClick={() => addAnnouncementToQueue("own")}>
                                    Add to Queue for {selectedDay.day} {MONTH_NAMES[selectedDay.month]}
                                  </button>
                                </div>
                              </>
                            ) : (
                              <>
                                {announcementAi ? (
                                  <div className={styles.announcementResult}>
                                    <label>
                                      <span className={announcementAi.xText.length > X_CHARACTER_LIMIT ? styles.ownPostOver : undefined}>
                                        X · {announcementAi.xText.length}/{X_CHARACTER_LIMIT}
                                      </span>
                                      <textarea
                                        value={announcementAi.xText}
                                        onChange={(event) => setAnnouncementAi((current) => (current ? { ...current, xText: event.target.value } : current))}
                                        rows={3}
                                      />
                                    </label>
                                    <label>
                                      <span>Telegram</span>
                                      <textarea
                                        value={announcementAi.telegramText}
                                        onChange={(event) => setAnnouncementAi((current) => (current ? { ...current, telegramText: event.target.value } : current))}
                                        rows={4}
                                      />
                                    </label>
                                  </div>
                                ) : null}
                                <div className={styles.composerActions}>
                                  {announcementAi ? (
                                    <button type="button" className={styles.ownPostAdd} onClick={() => addAnnouncementToQueue("ai")}>
                                      Add to Queue for {selectedDay.day} {MONTH_NAMES[selectedDay.month]}
                                    </button>
                                  ) : null}
                                  <button type="button" onClick={() => void jazzUpAnnouncement()} disabled={announcementAiBusy}>
                                    {announcementAiBusy ? "Jazzing it up…" : announcementAi ? "Try again" : "Jazz it up with AI"}
                                  </button>
                                </div>
                              </>
                            )}
                        </div>
                        <InlineStatus status={announcementStatus} />
                        <div className={styles.miniDivider} />
                        <span className={styles.eyebrow}>WHERE IT POSTS</span>
                        <div className={styles.destinationChips}>
                          <span className={myConnectedPlatforms.includes("x") ? styles.chipConnected : styles.chipOff}>
                            <XMark /> X{myConnectedPlatforms.includes("x") ? "" : " · not connected"}
                          </span>
                          <span className={myConnectedPlatforms.includes("telegram") ? styles.chipConnected : styles.chipOff}>
                            <TelegramMark /> Telegram{myConnectedPlatforms.includes("telegram") ? "" : " · not connected"}
                          </span>
                        </div>
                        {myConnectedPlatforms.length < 2 ? <p>Connect {myConnectedPlatforms.length === 0 ? "X or Telegram" : myConnectedPlatforms.includes("x") ? "Telegram" : "X"} in Setup.</p> : null}
                        <div className={styles.miniDivider} />
                        <span className={styles.eyebrow}>POSTS START AT</span>
                        <div className={styles.quietHours}>
                          <span>First post of the day</span>
                          <input
                            type="time"
                            aria-label="Daily start time"
                            value={dailyStartTime ?? DEFAULT_DAILY_START_CLOCK}
                            onChange={(event) => updateDailyStartTime(event.target.value)}
                          />
                        </div>
                        <p className={styles.exampleLabel}>
                          {dailyStartTime
                            ? `The rest of the day's posts space out from ${dailyStartTime}, about ${describeSpreadHours(cadenceSpreadHoursMs(postingCadence))} apart.`
                            : `Not set — posts are scheduled from the moment you approve them. Pick a time and the day starts there instead.`}
                        </p>
                        <div className={styles.miniDivider} />
                        <span className={styles.eyebrow}>QUIET HOURS</span>
                        <div className={styles.quietHours}>
                          <span>Never post between</span>
                          {/* A native time field: the wheel picker on iPhone, a compact inline hh:mm on desktop — never a 24-row dropdown. */}
                          <input
                            type="time"
                            aria-label="Quiet hours start"
                            value={(quietHours ?? DEFAULT_QUIET_HOURS).start}
                            disabled={!quietHours}
                            onChange={(event) => setQuietHourBound("start", event.target.value)}
                          />
                          <span>and</span>
                          <input
                            type="time"
                            aria-label="Quiet hours end"
                            value={(quietHours ?? DEFAULT_QUIET_HOURS).end}
                            disabled={!quietHours}
                            onChange={(event) => setQuietHourBound("end", event.target.value)}
                          />
                          <button
                            type="button"
                            className={styles.quietHoursToggle}
                            onClick={() => updateQuietHours(quietHours ? null : { ...DEFAULT_QUIET_HOURS })}
                          >
                            {quietHours ? "Turn off" : "Turn on"}
                          </button>
                        </div>
                        <p className={styles.exampleLabel}>
                          {quietHours ? "Your local time. Anything landing in this window moves to its end when you approve." : "Off — posts can go out at any hour."}
                        </p>
                      </aside>
                    </div>
                  </section>
                </div>
              ) : null}

              {activeTab === "queue" ? (
                <div className={styles.queueStack}>
                  <div className={styles.queueHeader}>
                    <div>
                      <h2>What&apos;s going out</h2>
                      <p>Nothing goes out until you say so.</p>
                    </div>
                    <div className={styles.queueHeaderAside}>
                      <span className={styles.queueModeNote}>Approve first · every post</span>
                      {approvalSession ? (
                        <span className={styles.approvalUnlock}>
                          Approvals unlocked until {formatScheduledAt(approvalSession.expiresAt)} · one tap, no signature
                          <button type="button" onClick={() => void lockApprovals()} disabled={approvalSessionBusy}>
                            Lock
                          </button>
                        </span>
                      ) : (
                        <span className={styles.approvalUnlock}>First approval today asks for one wallet signature · then one tap for 24h</span>
                      )}
                    </div>
                  </div>
                  <InlineStatus status={replenishStatus} />

                  <section className={styles.queueSection}>
                    <div className={styles.queueEyebrowRow}>
                      <span className={styles.eyebrow}>WAITING FOR YOU</span>
                      <span className={styles.queueCountBadge}>{queue.length}</span>
                      <span className={styles.queueEyebrowNote}>
                        {readyToReviewShortfall > 0 ? "Refilling now" : `${queue.length} draft${queue.length === 1 ? "" : "s"} · target ${queueTarget}`}
                        {" · cadence in Settings & Rules"}
                        {mascotImageUsage ? ` · ${describePostImageSlot(mascotImageUsage)}` : ""}
                      </span>
                    </div>
                    {queue.length === 0 ? (
                      <div className={styles.queueEmpty}>
                        <b>Nothing waiting.</b>
                        <p>Use &quot;Draft with AI&quot; in Setup, write an announcement in Calendar, or wait a moment — new drafts generate automatically.</p>
                      </div>
                    ) : null}
                    {queue.length > 0 ? (
                      <div className={styles.queueList}>
                        {queue.map((item) => {
                          const destinations = approvalDestinations(item, myConnectedPlatforms);
                          const isExpanded = Boolean(expandedQueueItemIds[item.id]);
                          const isPendingQuickSendX = pendingQuickSendId?.itemId === item.id && pendingQuickSendId.platform === "x";
                          const isPendingQuickSendTelegram =
                            pendingQuickSendId?.itemId === item.id && pendingQuickSendId.platform === "telegram";
                          const xIsTemplate = isUneditedTemplateText(item.xText, templateOutputs);
                          const telegramIsTemplate = isUneditedTemplateText(item.telegramText, templateOutputs);
                          const isTemplateItem = xIsTemplate || telegramIsTemplate;
                          const sendingTemplate = destinations.some((platform) => (platform === "x" ? xIsTemplate : telegramIsTemplate));
                          const templateAcknowledged = Boolean(templateAcknowledgedIds[item.id]);
                          const requiresTemplateAck = sendingTemplate && !templateAcknowledged;
                          const telegramSameAsX = item.telegramText.trim() === item.xText.trim();
                          const destinationTag =
                            destinations.length === 2 ? "Both" : destinations.length === 1 ? platformLabel(destinations[0]) : "Nowhere yet";
                          const isPickedForImage = postImageCandidateIds.has(item.id);
                          const isApproving = approvingItemId === item.id;
                          const approveDisabled = isApproving || destinations.length === 0 || requiresTemplateAck;
                          const approveTitle =
                            destinations.length === 0
                              ? myConnectedPlatforms.length === 0
                                ? "Connect X or Telegram in Setup first."
                                : "Give this post text for X or Telegram first."
                              : requiresTemplateAck
                                ? "Open the draft and tick 'send this template as-is' first."
                                : undefined;
                          const approveLabel = isApproving ? (postImageBusyId === item.id ? "Making the image…" : "Approving…") : "Approve";
                          return (
                            <article className={isExpanded ? styles.queueItemExpanded : styles.queueItem} key={item.id}>
                              <div className={styles.queueRow}>
                                {item.artwork ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img className={styles.queueThumb} src={item.artwork} alt="Queued post artwork" />
                                ) : null}
                                <div className={styles.queueRowMain}>
                                  <div className={styles.queueItemHead}>
                                    <span className={styles.exampleLabel}>
                                      {item.source === "calendar-ai"
                                        ? `Calendar AI · ${item.dayLabel}`
                                        : item.source === "setup-ai"
                                          ? "Setup AI"
                                          : item.source === "auto-replenish"
                                            ? "Auto-generated"
                                            : item.dayLabel
                                              ? `${describeDraftSource(item.source)} · ${item.dayLabel}`
                                              : "Manual"}
                                      {isTemplateItem ? <span className={styles.templateBadge}>Template</span> : null}
                                      {isPickedForImage ? (
                                        <>
                                          <span
                                            className={styles.imageComingBadge}
                                            title={`The AI picked this post. Nothing is made yet: if you approve it, an image is made from today's AI-image allowance and posted with it. Delete it or tap No image and nothing is made. ${POST_IMAGE_REMOVE_NOTE}`}
                                          >
                                            AI image on approve
                                          </span>
                                          <button type="button" className={styles.imageDeclineLink} onClick={() => declinePostImage(item.id)}>
                                            No image
                                          </button>
                                        </>
                                      ) : item.aiImage && item.artwork ? (
                                        <span className={styles.imageComingBadge}>AI image</span>
                                      ) : null}
                                    </span>
                                    <span className={destinations.length === 2 ? styles.destTagBoth : destinations.length === 1 ? styles.destTag : styles.destTagEmpty}>
                                      {destinationTag}
                                    </span>
                                  </div>
                                  {!isExpanded ? (
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
                                  ) : null}
                                </div>
                                <div className={styles.queueRowActions}>
                                  {postImageBusyId === item.id ? (
                                    <button type="button" className={styles.queueExpandToggle} onClick={() => skipPostImage(item.id)}>
                                      Skip the image
                                    </button>
                                  ) : null}
                                  {!isExpanded ? (
                                    <button
                                      type="button"
                                      className={styles.queueActionApprove}
                                      onClick={() => handleApproveClick(item)}
                                      disabled={approveDisabled}
                                      title={approveTitle}
                                    >
                                      {approveLabel}
                                    </button>
                                  ) : null}
                                  <button
                                    type="button"
                                    className={styles.queueExpandToggle}
                                    aria-expanded={isExpanded}
                                    aria-label={isExpanded ? "Hide details" : "Show details"}
                                    onClick={() => toggleQueueItemExpanded(item.id)}
                                  >
                                    {isExpanded ? "Less ▴" : "More ▾"}
                                  </button>
                                </div>
                              </div>
                              {isExpanded ? (
                              <div className={styles.queueItemBody}>
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
                                {myConnectedPlatforms.length === 0 ? (
                                  connectionsStatus === "error" ? (
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
                                  )
                                ) : null}
                                {sendingTemplate ? (
                                  <label className={styles.confirmTemplateCheckbox}>
                                    <input
                                      type="checkbox"
                                      checked={templateAcknowledged}
                                      onChange={(event) => setTemplateAcknowledgedIds((current) => ({ ...current, [item.id]: event.target.checked }))}
                                    />
                                    This is unedited template text — I want to send it as-is.
                                  </label>
                                ) : null}
                                {postImageErrors[item.id] ? (
                                  <p className={styles.postImageError}>{postImageErrors[item.id]} The post can still be approved without one.</p>
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
                                    disabled={approveDisabled}
                                    title={approveTitle}
                                  >
                                    {approveLabel}
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
                                  <label className={styles.scheduleCompact}>
                                    <span>Scheduled</span>
                                    <input
                                      type="datetime-local"
                                      className={styles.scheduleCompactInput}
                                      value={itemScheduledAt[item.id] ?? ""}
                                      onChange={(event) => setItemScheduledAtValue(item.id, event.target.value)}
                                    />
                                  </label>
                                </div>
                              </div>
                              ) : null}
                            </article>
                          );
                        })}
                      </div>
                    ) : null}
                  </section>

                  <section className={styles.queueSection}>
                    <div className={styles.queueEyebrowRow}>
                      <span className={styles.eyebrow}>COMING UP</span>
                      <span className={styles.queueEyebrowNote}>Approved &amp; scheduled — waiting to send. Cancel any time before it goes out.</span>
                    </div>
                    <InlineStatus status={postsStatus} />
                    {awaitingSendPosts.length === 0 ? (
                      <div className={styles.queueEmpty}>
                        <b>Nothing scheduled yet.</b>
                        <p>Approve a draft above to schedule it.</p>
                      </div>
                    ) : (
                      <div className={styles.queueList}>
                        {awaitingSendPosts.map((post) => {
                          const postExpanded = Boolean(expandedQueueItemIds[post.id]);
                          const needsComposer = post.destinations.some((destination) => destination.status === "needs_composer");
                          return (
                            <article className={postExpanded ? styles.queueItemExpanded : styles.queueItem} key={post.id}>
                              <div className={styles.queueRow}>
                                {post.artworkDataUrl ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img className={styles.queueThumb} src={post.artworkDataUrl} alt="Approved post artwork" />
                                ) : null}
                                <span className={styles.queueWhen}>{formatScheduledAt(post.scheduledAt)}</span>
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
                                <p className={postExpanded ? styles.queueRowTextFull : styles.queueRowText}>{post.body}</p>
                                <div className={styles.queueRowActions}>
                                  <button
                                    type="button"
                                    className={styles.queueExpandToggle}
                                    aria-expanded={postExpanded}
                                    aria-label={postExpanded ? "Hide options" : "Show options"}
                                    onClick={() => toggleQueueItemExpanded(post.id)}
                                  >
                                    {postExpanded ? "Less ▴" : "More ▾"}
                                  </button>
                                </div>
                              </div>
                              {postExpanded ? (
                                <div className={styles.queueItemBody}>
                                  {needsComposer ? (
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
                              ) : null}
                            </article>
                          );
                        })}
                      </div>
                    )}
                  </section>

                  <section className={styles.queueSection}>
                    <div className={styles.queueEyebrowRow}>
                      <span className={styles.eyebrow}>ALREADY PUBLISHED</span>
                      <span className={styles.queueEyebrowNote}>Sent, failed and canceled posts, with the outcome per destination.</span>
                    </div>
                    {historyPosts.length === 0 ? (
                      <div className={styles.historyPlaceholder}>
                        <span>No publish history yet.</span>
                      </div>
                    ) : (
                      <div className={styles.historyTable}>
                        {historyPosts.map((post) => (
                          <div className={styles.historyRow} key={post.id}>
                            <span className={styles.historyWhen}>{post.status === "canceled" ? "Canceled" : formatScheduledAt(post.scheduledAt)}</span>
                            <p className={styles.historyText}>{post.body}</p>
                            {post.status === "canceled" ? (
                              <span className={styles.historyOutcomeMuted}>Canceled before it was sent.</span>
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
                        ))}
                      </div>
                    )}
                  </section>

                  <section className={styles.howPanel}>
                    <div className={styles.queueHeader}>
                      <div>
                        <h2>How it&apos;s going</h2>
                        <p>Your numbers, updated as they move.</p>
                      </div>
                      <span className={styles.privateBadge}>🔒 ONLY YOU CAN SEE THIS</span>
                    </div>
                    <div className={styles.howStats}>
                      <div className={styles.howStat}>
                        <span className={styles.eyebrow}>HOLDERS</span>
                        <b>{howItsGoing?.holders !== null && howItsGoing?.holders !== undefined ? howItsGoing.holders.toLocaleString("en-US") : "—"}</b>
                        <small>{howItsGoing?.holders !== null && howItsGoing?.holders !== undefined ? "live on-chain count" : selectedProject?.chain === "robinhood" && selectedProject.contractAddress ? "not available right now" : "launch the token first"}</small>
                      </div>
                      <div className={styles.howStat}>
                        <span className={styles.eyebrow}>X FOLLOWERS</span>
                        <b>—</b>
                        <small>not tracked yet</small>
                      </div>
                      <div className={styles.howStat}>
                        <span className={styles.eyebrow}>TELEGRAM MEMBERS</span>
                        <b>{howItsGoing?.telegramMembers !== null && howItsGoing?.telegramMembers !== undefined ? howItsGoing.telegramMembers.toLocaleString("en-US") : "—"}</b>
                        <small>{howItsGoing?.telegramMembers !== null && howItsGoing?.telegramMembers !== undefined ? "live channel count" : telegramConnection?.status === "connected" ? "not available right now" : "connect Telegram in Setup"}</small>
                      </div>
                    </div>
                    <span className={styles.eyebrow}>AVERAGE PER POST</span>
                    <div className={styles.howAverages}>
                      {["Views", "Reactions", "Replies"].map((label) => (
                        <div className={styles.howAverage} key={label}>
                          <span>{label}</span>
                          <b title="Needs paid X reads and Telegram post analytics — not tracked yet.">—</b>
                        </div>
                      ))}
                    </div>
                    <p className={styles.howNote}>
                      {howItsGoingStatus === "error"
                        ? "Your numbers could not be loaded just now — they will refresh next time you open this tab."
                        : "Only real numbers are shown. X followers and per-post views, reactions and replies need paid X reads, so they stay blank until that is switched on."}
                    </p>
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
                          <p>The AI will never use these, or go near the subjects they name — a draft that slips one in is thrown out and redone.</p>
                        </div>
                      </div>
                      <div className={styles.bannedPanel}>
                        {wordsToAvoid.map((word) => (
                          <span key={word} className={styles.wordChip}>
                            {word}
                            <button type="button" className={styles.wordChipRemove} aria-label={`Remove ${word}`} onClick={() => removeWordToAvoid(word)}>
                              ×
                            </button>
                          </span>
                        ))}
                        <form
                          className={styles.wordAddForm}
                          onSubmit={(event) => {
                            event.preventDefault();
                            addWordToAvoidFromBox();
                          }}
                        >
                          <input
                            value={wordToAvoidDraft}
                            onChange={(event) => setWordToAvoidDraft(event.target.value)}
                            placeholder="+ add a word or phrase"
                            aria-label="Word or phrase to avoid"
                            maxLength={40}
                          />
                          <button type="submit" disabled={!wordToAvoidDraft.trim()}>Add</button>
                        </form>
                      </div>
                      <InlineStatus status={wordsToAvoidStatus} />
                      <p className={styles.exampleLabel}>
                        {wordsToAvoid.length === 0 ? "No banned words — the AI's own safety rules still apply." : `${wordsToAvoid.length} / ${MAX_WORDS_TO_AVOID} words banned across X and Telegram.`}
                      </p>
                    </div>

                    <div className={styles.blockInner}>
                      <div className={styles.sectionHeading}>
                        <div>
                          <h2>How it should sound</h2>
                          <p>Nudge the tone whenever you like — every new draft follows the dials as they stand.</p>
                        </div>
                      </div>
                      <div className={styles.dialList}>
                        {TONE_DIAL_OPTIONS.map((dial) => (
                          <label key={dial.key}>
                            <span>{dial.label}</span>
                            <select
                              value={toneDials[dial.key]}
                              onChange={(event) => updateToneDial(dial.key, event.target.value as ToneDials[typeof dial.key])}
                            >
                              {dial.options.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
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
                  </section>
                </div>
              ) : null}
            </div>
          </section>
          );
        })()}
      </div>
    </main>
  );
}
