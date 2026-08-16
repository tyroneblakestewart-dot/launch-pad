"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { createWalletClient, custom } from "viem";
import {
  ACCOUNT_WALLET_STORAGE_KEY,
  parseStoredAccountWallet,
} from "@/lib/account-wallet-state";
import { MIN_USABLE_VOICE_EXAMPLES, filterUsableVoiceExamples } from "@/lib/social-voice-examples";
import { getSocialStudioRecord, putSocialStudioRecord } from "@/lib/social-studio-db";
import type {
  MascotVisualDNA,
  QueueItem,
  SocialStudioProjectRecord,
  VoiceProfile,
} from "@/lib/social-studio-types";
import { EMPTY_SOCIAL_STUDIO_RECORD } from "@/lib/social-studio-types";
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

type TelegramConnectionState = {
  status: "connected" | "reconnect_needed";
  displayName: string;
  externalId: string;
  reconnectReason: string | null;
};

/** Shape returned by GET /api/social/connections for one platform row. */
type SocialConnectionSummary = {
  platform: "x" | "telegram";
  status: "connected" | "reconnect_needed";
  displayName: string;
  externalId: string;
  reconnectReason: string | null;
};

async function readJsonResponse<T>(response: Response, fallback: string): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as { error?: string } & Partial<T>;
  if (!response.ok) throw new Error(payload.error || fallback);
  return payload as T;
}

function newQueueItemId(): string {
  return `queue-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function storedWalletAddress(): string {
  try {
    return parseStoredAccountWallet(localStorage.getItem(ACCOUNT_WALLET_STORAGE_KEY))?.account ?? "";
  } catch {
    return "";
  }
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
    description: "Announces every purchase in your channel, with the size and the buyer.",
  },
  {
    name: "Hype Bot",
    description: "Keeps the chat moving between announcements — memes, questions and GMs.",
  },
  {
    name: "Watchtower",
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

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function TelegramIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21.94 4.3 18.9 19.1c-.23 1.02-.84 1.27-1.7.79l-4.7-3.46-2.27 2.18c-.25.25-.46.46-.94.46l.33-4.78 8.7-7.86c.38-.34-.08-.53-.59-.19l-10.75 6.77-4.63-1.45c-1.01-.31-1.03-1 .21-1.49l18.1-6.98c.84-.3 1.57.2 1.28 1.21z" />
    </svg>
  );
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
  const [voiceExamplesText, setVoiceExamplesText] = useState("");
  const [voiceProfile, setVoiceProfile] = useState<VoiceProfile | null>(null);
  const [voiceBusy, setVoiceBusy] = useState(false);
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
  const [mascotSceneStatus, setMascotSceneStatus] = useState<PanelStatus>(null);
  const [setupDraftStatus, setSetupDraftStatus] = useState<PanelStatus>(null);
  const [calendarDraftStatus, setCalendarDraftStatus] = useState<PanelStatus>(null);
  const [telegramStatus, setTelegramStatus] = useState<PanelStatus>(null);

  // Real Telegram connect flow (issue #340): reconciles the Setup card with
  // the wallet-signed connect/disconnect routes instead of a bare, unverified
  // chat-ID text field. `telegramConfigured` is null while loading.
  const [telegramConfigured, setTelegramConfigured] = useState<boolean | null>(null);
  const [telegramConnection, setTelegramConnection] = useState<TelegramConnectionState | null>(null);
  const [telegramConnectInput, setTelegramConnectInput] = useState("");
  const [telegramConnectBusy, setTelegramConnectBusy] = useState(false);

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

  useEffect(() => {
    let cancelled = false;
    async function loadTelegramConnection() {
      if (!walletAddress) {
        setTelegramConnection(null);
        return;
      }
      try {
        const response = await fetch(`/api/social/connections?walletAddress=${encodeURIComponent(walletAddress)}`, { cache: "no-store" });
        const payload = await readJsonResponse<{ connections?: SocialConnectionSummary[] }>(response, "Could not load your connections.");
        if (cancelled) return;
        const connections = Array.isArray(payload.connections) ? payload.connections : [];
        const telegram = connections.find((connection) => connection.platform === "telegram");
        setTelegramConnection(
          telegram && (telegram.status === "connected" || telegram.status === "reconnect_needed")
            ? {
                status: telegram.status,
                displayName: telegram.displayName,
                externalId: telegram.externalId,
                reconnectReason: telegram.reconnectReason,
              }
            : null,
        );
      } catch {
        if (!cancelled) setTelegramConnection(null);
      }
    }
    void loadTelegramConnection();
    return () => {
      cancelled = true;
    };
  }, [walletAddress]);

  useEffect(() => {
    let cancelled = false;
    async function loadRecord() {
      if (!selectedProjectId) {
        setVoiceProfile(null);
        setVoiceExamplesText("");
        setMascotVisualDNA(null);
        setMascotReferenceImage(null);
        setQueue([]);
        return;
      }
      const record = await getSocialStudioRecord(selectedProjectId).catch(() => EMPTY_SOCIAL_STUDIO_RECORD);
      if (cancelled) return;
      setVoiceProfile(record.voiceProfile);
      setVoiceExamplesText(record.voiceExamples.join("\n"));
      setMascotVisualDNA(record.mascotVisualDNA);
      setMascotReferenceImage(record.mascotReferenceImage);
      setQueue(record.queue);
    }
    void loadRecord();
    return () => {
      cancelled = true;
    };
  }, [selectedProjectId]);

  function currentSocialStudioRecord(overrides: Partial<SocialStudioProjectRecord> = {}): SocialStudioProjectRecord {
    return {
      voiceProfile,
      voiceExamples: voiceExamplesText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
      mascotVisualDNA,
      mascotReferenceImage,
      queue,
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

  const xCharacterCount = message.length;
  const xReady = xCharacterCount > 0 && xCharacterCount <= 280;
  const telegramReady = Boolean(
    selectedProject && telegramConnection?.status === "connected" && (telegramMessage || message).trim(),
  );
  const voiceExampleFilter = useMemo(() => filterUsableVoiceExamples(voiceExamplesText), [voiceExamplesText]);
  const voiceExampleCount = voiceExampleFilter.usable.length;
  const voiceProgressPercent = Math.min(100, Math.round((voiceExampleCount / 20) * 100));
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
      setTelegramConnection(payload.connection);
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
      setTelegramConnection(null);
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
        body: JSON.stringify({ walletAddress, project, examples }),
      });
      const payload = (await response.json()) as { voiceProfile?: VoiceProfile; error?: string };
      if (!response.ok || !payload.voiceProfile) {
        throw new Error(payload.error || "The voice profile could not be built.");
      }
      setVoiceProfile(payload.voiceProfile);
      persistSocialStudio({ voiceProfile: payload.voiceProfile });
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
    options: { dayLabel?: string; theme?: string } = {},
    report: (next: PanelStatus) => void = () => {},
  ): Promise<boolean> {
    const project = draftProjectPayload();
    if (!project) {
      report({ tone: "error", message: "Choose a project before generating a draft." });
      return false;
    }

    report({ tone: "progress", message: "Writing a draft with AI…" });
    try {
      const response = await fetch("/api/social/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress,
          project,
          voiceProfile,
          dayLabel: options.dayLabel ?? null,
          theme: options.theme ?? null,
        }),
      });
      const payload = (await response.json()) as {
        draft?: { xText: string; telegramText: string };
        error?: string;
      };
      if (!response.ok || !payload.draft) {
        throw new Error(payload.error || "The draft could not be generated.");
      }

      if (options.dayLabel) {
        const item: QueueItem = {
          id: newQueueItemId(),
          xText: payload.draft.xText,
          telegramText: payload.draft.telegramText,
          artwork: null,
          source: "calendar-ai",
          dayLabel: options.dayLabel,
          createdAt: new Date().toISOString(),
        };
        setQueue((current) => {
          const next = [item, ...current];
          persistSocialStudio({ queue: next });
          return next;
        });
        report({ tone: "success", message: `AI draft for ${options.dayLabel} added to the Queue.` });
      } else {
        setMessage(payload.draft.xText);
        setTelegramMessage(payload.draft.telegramText);
        setComposeOpen(true);
        report({ tone: "success", message: "AI draft ready. Review it below before posting." });
      }
      return true;
    } catch (error) {
      report({ tone: "error", message: error instanceof Error ? error.message : "The draft could not be generated." });
      return false;
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
      const response = await fetch("/api/social/mascot/visual-dna", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress, project, imageDataUrl }),
      });
      const payload = (await response.json()) as { mascotVisualDNA?: MascotVisualDNA; error?: string };
      if (!response.ok || !payload.mascotVisualDNA) {
        throw new Error(payload.error || "The mascot artwork could not be analysed.");
      }
      setMascotVisualDNA(payload.mascotVisualDNA);
      setMascotReferenceImage(imageDataUrl);
      persistSocialStudio({ mascotVisualDNA: payload.mascotVisualDNA, mascotReferenceImage: imageDataUrl });
      setMascotUploadStatus({ tone: "success", message: "Mascot identity locked in. Choose a scene to generate artwork." });
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
        body: JSON.stringify({ walletAddress, project, mascotVisualDNA, sceneInput }),
      });
      const payload = (await response.json()) as { imageDataUrl?: string; error?: string };
      if (!response.ok || !payload.imageDataUrl) {
        throw new Error(payload.error || "The mascot scene image could not be generated.");
      }
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

  function updateQueueItem(id: string, patch: Partial<QueueItem>) {
    setQueue((current) => {
      const next = current.map((item) => (item.id === id ? { ...item, ...patch } : item));
      persistSocialStudio({ queue: next });
      return next;
    });
  }

  function removeQueueItem(id: string) {
    setQueue((current) => {
      const next = current.filter((item) => item.id !== id);
      persistSocialStudio({ queue: next });
      return next;
    });
    setStatus("Removed from the Queue.");
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
    <main className={styles.shell}>
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
            <span className={styles.proBadge}>PRO · AI SOCIAL STUDIO</span>
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
                <span className={styles.metaPill}><b>X + TELEGRAM</b> live tools</span>
                <span className={styles.metaPill}><b>AI TOOLS</b> live</span>
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
                          <span className={styles.xIcon}><XIcon /></span>
                          <div>
                            <b>X</b>
                            <span>{xHandle || "Uses the account already signed into X"}</span>
                          </div>
                          <span className={styles.connectionState}>Browser handoff</span>
                        </div>
                        <p className={styles.connectionHelper}>
                          Uses the X account already signed into your browser — no password or access token is stored.
                        </p>
                      </article>
                      <article className={styles.connectionCard}>
                        <div className={styles.connectionCardTop}>
                          <span className={styles.telegramIcon}><TelegramIcon /></span>
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
                          <span
                            className={
                              telegramConfigured === false
                                ? styles.connectionStateError
                                : telegramConnection?.status === "connected"
                                  ? styles.connectionStateLive
                                  : telegramConnection?.status === "reconnect_needed"
                                    ? styles.connectionStateWarning
                                    : styles.connectionState
                            }
                          >
                            {telegramConfigured === null
                              ? "Checking…"
                              : telegramConfigured === false
                                ? "Not configured"
                                : telegramConnection?.status === "connected"
                                  ? "Connected"
                                  : telegramConnection?.status === "reconnect_needed"
                                    ? "Reconnect needed"
                                    : "Not connected"}
                          </span>
                        </div>

                        {telegramConfigured === false ? (
                          <p className={styles.connectionHelper}>
                            The Hoodlums Telegram bot isn&apos;t set up on this deployment yet. Ask the site owner to set{" "}
                            <code>TELEGRAM_BOT_TOKEN</code> (and optionally <code>TELEGRAM_BOT_USERNAME</code>) in Vercel.
                          </p>
                        ) : telegramConnection?.status === "connected" ? (
                          <>
                            <p className={styles.connectionHelper}>
                              The Hoodlums bot can post in {telegramConnection.displayName}.
                            </p>
                            <div className={styles.composerActions}>
                              <button type="button" onClick={disconnectTelegramChannel} disabled={telegramConnectBusy}>
                                {telegramConnectBusy ? "Disconnecting…" : "Disconnect"}
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <label className={styles.connectionField}>
                              <span>Channel username or chat ID</span>
                              <input
                                value={telegramConnectInput}
                                onChange={(event) => setTelegramConnectInput(event.target.value)}
                                placeholder="@yourchannel or -1001234567890"
                                disabled={!telegramConfigured || telegramConnectBusy}
                              />
                            </label>
                            {telegramConnection?.status === "reconnect_needed" && telegramConnection.reconnectReason ? (
                              <p className={styles.connectionHelper}>{telegramConnection.reconnectReason}</p>
                            ) : null}
                            <button
                              type="button"
                              className={styles.aiMakeButton}
                              onClick={connectTelegramChannel}
                              disabled={!telegramConfigured || telegramConnectBusy || !walletAddress}
                            >
                              <b>{telegramConnectBusy ? "Verifying…" : "Connect Telegram"}</b>
                              <span>
                                {walletAddress
                                  ? "Add the Hoodlums bot as an admin in your channel first, then connect it here."
                                  : "Connect your wallet first, then link a Telegram channel here."}
                              </span>
                            </button>
                          </>
                        )}
                        <label className={styles.checkbox}>
                          <input
                            type="checkbox"
                            checked={includeArtwork}
                            onChange={(event) => setIncludeArtwork(event.target.checked)}
                          />
                          <span>Include project artwork when available</span>
                        </label>
                        <InlineStatus status={telegramStatus} />
                      </article>
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
                          value={voiceExamplesText}
                          onChange={(event) => setVoiceExamplesText(event.target.value)}
                          onBlur={() => persistSocialStudio()}
                          placeholder="Paste a post here, one per line"
                          rows={5}
                        />
                        <div className={styles.disabledActions}>
                          <button type="button" onClick={noteScreenshotsUnavailable}>Upload screenshots</button>
                          <span>
                            {voiceExampleFilter.pastedLineCount > 0
                              ? `${voiceExampleCount} usable / ${voiceExampleFilter.pastedLineCount} pasted`
                              : `${voiceExampleCount} / 20 examples`}
                          </span>
                        </div>
                      </div>
                      {voiceExampleFilter.rejectedCount > 0 ? (
                        <p className={styles.exampleLabel}>
                          {voiceExampleFilter.rejectedCount} pasted line{voiceExampleFilter.rejectedCount === 1 ? "" : "s"} skipped as too
                          short, page furniture, or duplicates.
                        </p>
                      ) : (
                        <p className={styles.exampleLabel}>Screenshot-to-text isn&apos;t available yet — paste post text above instead.</p>
                      )}
                      <div className={styles.progressRow}>
                        <div><span>EXAMPLES ADDED</span><b>{voiceExampleCount} / 20</b></div>
                        <div className={styles.progressTrack}><span style={{ width: `${voiceProgressPercent}%` }} /></div>
                      </div>
                      <button
                        type="button"
                        className={styles.aiMakeButton}
                        onClick={buildVoiceProfile}
                        disabled={voiceBusy || voiceExampleCount < MIN_USABLE_VOICE_EXAMPLES}
                      >
                        <b>{voiceBusy ? "Learning your voice…" : "Learn my voice"}</b>
                        <span>Builds a reusable voice profile for AI drafts and mascot posts.</span>
                      </button>
                      <InlineStatus status={voiceStatus} />
                      <p className={styles.limeNote}>Your examples teach style only — the AI will only ever talk about your project.</p>
                    </div>

                    <div className={styles.blockInner}>
                      <div className={styles.sectionHeading}>
                        <div>
                          <h2>Voice preview</h2>
                          <p>Here&apos;s how it would sound writing about your project.</p>
                        </div>
                      </div>
                      {voiceProfile ? (
                        <div className={styles.insetPanel}>
                          <p className={styles.exampleLabel}>
                            Tone: {voiceProfile.tone} · Vocabulary: {voiceProfile.vocabulary} · Cadence: {voiceProfile.cadence} · Emoji: {voiceProfile.emojiHabits}
                          </p>
                          {voiceProfile.sampleLines.map((line, index) => (
                            <p className={styles.limeNote} key={index}>{line}</p>
                          ))}
                        </div>
                      ) : (
                        <div className={styles.previewEmpty}>
                          <span>AI VOICE PREVIEW</span>
                          <b>Add examples to unlock voice samples.</b>
                          <p>Paste at least two example posts, then select &quot;Learn my voice&quot;.</p>
                        </div>
                      )}
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
                            <XIcon /> Approve &amp; open X composer
                          </button>
                          <button
                            type="button"
                            className={styles.telegramButton}
                            onClick={postTelegram}
                            disabled={!telegramReady || busy}
                          >
                            <TelegramIcon /> {busy ? "Publishing…" : "Approve & post to Telegram"}
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
                        <span className={styles.eyebrow}>PICK A HOODLUMS BOT</span>
                        <p>Choose one of our bots and add it to your channel. Nothing to paste, nothing to set up.</p>
                      </div>
                      <ComingSoon compact />
                    </div>
                    <div className={styles.botList}>
                      {BOTS.map((bot) => (
                        <div className={styles.botRow} key={bot.name}>
                          <div className={styles.botRowInfo}>
                            <b>{bot.name}</b>
                            <span>{bot.description}</span>
                          </div>
                          <button type="button" disabled>Add to your channel</button>
                        </div>
                      ))}
                    </div>
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
                          <span><XIcon /> X</span>
                          <span><TelegramIcon /> Telegram</span>
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
                        <p>Drafts from Setup and Calendar land here. Nothing posts until you tap approve — real cron scheduling is not built yet.</p>
                      </div>
                      <div className={styles.segmentedDisabled}>
                        <span className={styles.segmentActive}>Approve first</span>
                        <span>Auto-publish</span>
                      </div>
                    </div>
                    {queue.length === 0 ? (
                      <div className={styles.queueEmpty}>
                        <b>The queue is empty.</b>
                        <p>Use &quot;Draft with AI&quot; in Setup, &quot;AI makes it&quot; in Calendar, or &quot;Add to Queue&quot; after generating mascot artwork.</p>
                      </div>
                    ) : (
                      <div className={styles.queueList}>
                        {queue.map((item) => (
                          <article className={styles.queueItem} key={item.id}>
                            {item.artwork ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img className={styles.queueThumb} src={item.artwork} alt="Queued post artwork" />
                            ) : null}
                            <div className={styles.queueItemBody}>
                              <span className={styles.exampleLabel}>
                                {item.source === "calendar-ai" ? `Calendar AI · ${item.dayLabel}` : item.source === "setup-ai" ? "Setup AI" : "Manual"}
                              </span>
                              <label className={styles.connectionField}>
                                <span>X ({item.xText.length}/280)</span>
                                <textarea
                                  value={item.xText}
                                  onChange={(event) => updateQueueItem(item.id, { xText: event.target.value })}
                                  rows={3}
                                />
                              </label>
                              <label className={styles.connectionField}>
                                <span>Telegram</span>
                                <textarea
                                  value={item.telegramText}
                                  onChange={(event) => updateQueueItem(item.id, { telegramText: event.target.value })}
                                  rows={3}
                                />
                              </label>
                              <div className={styles.composerActions}>
                                <button type="button" onClick={() => postQueueItemToX(item)}>
                                  <XIcon /> Post to X
                                </button>
                                <button type="button" onClick={() => sendQueueItemToTelegram(item)} disabled={busy}>
                                  <TelegramIcon /> Send to Telegram
                                </button>
                                <button type="button" onClick={() => removeQueueItem(item.id)}>Remove</button>
                              </div>
                            </div>
                          </article>
                        ))}
                      </div>
                    )}
                  </section>

                  <section className={styles.performanceCard}>
                    <div className={styles.sectionHeading}>
                      <div>
                        <h2>How it&apos;s going</h2>
                        <p>Your numbers, updated as they move.</p>
                      </div>
                      <span className={styles.privateBadge}>ONLY YOU CAN SEE THIS</span>
                    </div>
                    <div className={styles.metricGrid}>
                      {["Posts published", "Approval rate", "Best post"].map((label) => (
                        <div key={label}>
                          <span>{label}</span>
                          <b>—</b>
                          <small>Coming soon</small>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className={styles.block}>
                    <div className={styles.sectionHeading}>
                      <div>
                        <span className={styles.eyebrow}>HISTORY</span>
                        <p>Real publish history will be stored here when queue persistence is implemented.</p>
                      </div>
                      <ComingSoon compact />
                    </div>
                    <div className={styles.historyPlaceholder}>
                      <span>No fabricated history.</span>
                    </div>
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
                          <div key={label}>
                            <span>{label}</span>
                            <div>
                              {options.map((option, index) => (
                                <button type="button" disabled key={option} className={index === 1 ? styles.dialSelected : undefined}>{option}</button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </section>

                  <section className={styles.block}>
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
