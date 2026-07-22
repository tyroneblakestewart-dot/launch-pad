"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { TokenProject } from "@/lib/types";
import styles from "./social-hub.module.css";

const PROJECT_STORAGE_KEY = "private-meme-token-studio-projects-v1";
const DRAFT_STORAGE_KEY = "private-meme-token-studio-social-drafts-v1";
const TELEGRAM_CHAT_STORAGE_KEY = "private-meme-token-studio-telegram-chats-v1";

type TemplateId = "launch" | "countdown" | "contract" | "community" | "custom";

type DraftMap = Record<string, string>;
type ChatMap = Record<string, string>;

const TEMPLATES: Array<{ id: TemplateId; label: string; description: string }> = [
  { id: "launch", label: "Launch announcement", description: "Introduce the token and its story." },
  { id: "countdown", label: "Launch countdown", description: "Build attention before the contract is live." },
  { id: "contract", label: "Contract is live", description: "Publish the verified contract address." },
  { id: "community", label: "Community call", description: "Bring followers into X and Telegram." },
  { id: "custom", label: "Custom post", description: "Start with a blank composer." },
];

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

export function SocialHub() {
  const [projects, setProjects] = useState<TokenProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [templateId, setTemplateId] = useState<TemplateId>("launch");
  const [message, setMessage] = useState("");
  const [telegramBotToken, setTelegramBotToken] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [includeArtwork, setIncludeArtwork] = useState(true);
  const [status, setStatus] = useState(
    "Choose a saved project, review the post and approve each destination.",
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const loadedProjects = safeProjects(localStorage.getItem(PROJECT_STORAGE_KEY));
    const drafts = safeMap(localStorage.getItem(DRAFT_STORAGE_KEY));
    const chats = safeMap(localStorage.getItem(TELEGRAM_CHAT_STORAGE_KEY));
    setProjects(loadedProjects);

    if (loadedProjects[0]) {
      const first = loadedProjects[0];
      setSelectedProjectId(first.id);
      setTelegramChatId(chats[first.id] || "");
      setMessage(drafts[first.id] || buildTemplate(first, "launch"));
    }
  }, []);

  const selectedProject = useMemo(
    () => projects.find((item) => item.id === selectedProjectId) || null,
    [projects, selectedProjectId],
  );

  const xCharacterCount = message.length;
  const xReady = xCharacterCount > 0 && xCharacterCount <= 280;
  const telegramReady = Boolean(
    selectedProject && telegramBotToken.trim() && telegramChatId.trim() && message.trim(),
  );

  function selectProject(id: string) {
    const project = projects.find((item) => item.id === id);
    if (!project) return;
    const drafts = safeMap(localStorage.getItem(DRAFT_STORAGE_KEY));
    const chats = safeMap(localStorage.getItem(TELEGRAM_CHAT_STORAGE_KEY));
    setSelectedProjectId(id);
    setTelegramChatId(chats[id] || "");
    setTemplateId("launch");
    setMessage(drafts[id] || buildTemplate(project, "launch"));
    setStatus(`${project.name || "Project"} loaded into the social composer.`);
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

  async function postTelegram() {
    if (!selectedProject) {
      setStatus("Choose a project before publishing.");
      return false;
    }
    if (!telegramReady) {
      setStatus("Enter the Telegram bot token, channel ID and post text first.");
      return false;
    }

    setBusy(true);
    setStatus("Sending the approved post to Telegram…");
    try {
      const response = await fetch("/api/social/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          botToken: telegramBotToken.trim(),
          chatId: telegramChatId.trim(),
          text: message.trim(),
          artwork: includeArtwork ? selectedProject.heroImage : "",
        }),
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Telegram rejected the post.");
      }

      const chats: ChatMap = safeMap(localStorage.getItem(TELEGRAM_CHAT_STORAGE_KEY));
      chats[selectedProject.id] = telegramChatId.trim();
      localStorage.setItem(TELEGRAM_CHAT_STORAGE_KEY, JSON.stringify(chats));
      setTelegramBotToken("");
      setStatus("Telegram post published. The bot token was cleared from the form and was not saved.");
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

  return (
    <main className={styles.shell}>
      <header className={styles.topbar}>
        <div>
          <p>SOCIAL OPERATIONS</p>
          <h1>Project Social Hub</h1>
          <span>Prepare once. Review every destination. Publish without sharing passwords.</span>
        </div>
        <nav>
          <Link href="/">← Studio</Link>
          <Link href="/providers">Provider desk</Link>
        </nav>
      </header>

      <section className={styles.status} role="status">
        <span>●</span>
        <p>{status}</p>
      </section>

      <section className={styles.grid}>
        <aside className={styles.sidebar}>
          <section className={styles.card}>
            <div className={styles.cardHeading}>
              <div><p>STEP 01</p><h2>Choose project</h2></div>
              <b>{projects.length}</b>
            </div>

            {projects.length === 0 ? (
              <div className={styles.empty}>
                No saved projects were found. Return to the studio and save the token project first.
              </div>
            ) : (
              <div className={styles.projectList}>
                {projects.map((project) => (
                  <button
                    type="button"
                    key={project.id}
                    className={project.id === selectedProjectId ? styles.projectActive : styles.project}
                    onClick={() => selectProject(project.id)}
                  >
                    <span className={styles.projectImage}>
                      {project.heroImage ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={project.heroImage} alt="" />
                      ) : (
                        project.name.slice(0, 1).toUpperCase() || "T"
                      )}
                    </span>
                    <span>
                      <b>{project.name || "Untitled project"}</b>
                      <small>${project.ticker || "TOKEN"} · {project.chain}</small>
                    </span>
                    <em>{project.status}</em>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className={styles.card}>
            <div className={styles.cardHeading}>
              <div><p>STEP 02</p><h2>Post type</h2></div>
            </div>
            <div className={styles.templateList}>
              {TEMPLATES.map((template) => (
                <button
                  type="button"
                  key={template.id}
                  className={template.id === templateId ? styles.templateActive : styles.template}
                  onClick={() => chooseTemplate(template.id)}
                  disabled={!selectedProject}
                >
                  <b>{template.label}</b>
                  <span>{template.description}</span>
                </button>
              ))}
            </div>
          </section>
        </aside>

        <section className={styles.composerColumn}>
          <section className={styles.composerCard}>
            <div className={styles.cardHeading}>
              <div><p>STEP 03</p><h2>Review the post</h2></div>
              <span className={xReady ? styles.countReady : styles.countWarning}>
                {xCharacterCount}/280
              </span>
            </div>

            {selectedProject && (
              <div className={styles.projectSummary}>
                <span className={styles.summaryArtwork}>
                  {selectedProject.heroImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={selectedProject.heroImage} alt={`${selectedProject.name} artwork`} />
                  ) : (
                    selectedProject.name.slice(0, 1).toUpperCase() || "T"
                  )}
                </span>
                <span>
                  <b>{selectedProject.name || "Untitled project"}</b>
                  <small>
                    ${selectedProject.ticker || "TOKEN"} · {selectedProject.chain}
                    {selectedProject.contractAddress
                      ? ` · ${shortAddress(selectedProject.contractAddress)}`
                      : " · contract pending"}
                  </small>
                </span>
              </div>
            )}

            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Choose a project and write the announcement…"
              rows={12}
            />

            <div className={styles.composerActions}>
              <button type="button" onClick={saveDraft}>Save draft</button>
              <button type="button" onClick={copyPost}>Copy post</button>
              <button type="button" onClick={downloadArtwork} disabled={!selectedProject?.heroImage}>
                Download artwork
              </button>
            </div>
          </section>

          <section className={styles.destinationGrid}>
            <article className={styles.destinationCard}>
              <div className={styles.destinationTitle}>
                <span className={styles.xBadge}>X</span>
                <div><h3>X account</h3><p>Approval through the official X composer</p></div>
              </div>
              <ul>
                <li>Uses the account already signed into X</li>
                <li>No X password or access token is stored</li>
                <li>Artwork must be attached manually</li>
              </ul>
              <button
                type="button"
                className={styles.xButton}
                onClick={openXComposer}
                disabled={!xReady}
              >
                APPROVE & OPEN X COMPOSER ↗
              </button>
            </article>

            <article className={styles.destinationCard}>
              <div className={styles.destinationTitle}>
                <span className={styles.telegramBadge}>T</span>
                <div><h3>Telegram channel</h3><p>Direct publishing through your Telegram bot</p></div>
              </div>

              <label>
                <span>Bot token</span>
                <input
                  type="password"
                  value={telegramBotToken}
                  onChange={(event) => setTelegramBotToken(event.target.value)}
                  placeholder="Paste the BotFather token for this post"
                  autoComplete="off"
                />
                <small>Never saved. Cleared after a successful post.</small>
              </label>

              <label>
                <span>Channel username or chat ID</span>
                <input
                  value={telegramChatId}
                  onChange={(event) => setTelegramChatId(event.target.value)}
                  placeholder="@yourchannel or -1001234567890"
                />
                <small>The bot must be an administrator allowed to post.</small>
              </label>

              <label className={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={includeArtwork}
                  onChange={(event) => setIncludeArtwork(event.target.checked)}
                />
                <span>Include project artwork when available</span>
              </label>

              <button
                type="button"
                className={styles.telegramButton}
                onClick={postTelegram}
                disabled={!telegramReady || busy}
              >
                {busy ? "PUBLISHING…" : "APPROVE & POST TO TELEGRAM"}
              </button>
            </article>
          </section>

          <section className={styles.publishBar}>
            <div>
              <b>Publish to both</b>
              <span>Opens X for your final click, then sends the approved Telegram post.</span>
            </div>
            <button
              type="button"
              onClick={publishBoth}
              disabled={!xReady || !telegramReady || busy}
            >
              APPROVE BOTH DESTINATIONS
            </button>
          </section>

          <section className={styles.securityNote}>
            <b>Current security boundary</b>
            <p>
              This version does not create social accounts, solve captchas, store passwords or schedule background posts.
              Full one-click X API publishing requires an X Developer application, OAuth authorization and encrypted server-side token storage.
            </p>
          </section>
        </section>
      </section>
    </main>
  );
}
