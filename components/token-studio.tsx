"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import {
  REOPEN_GENERATED_SITE_EVENT,
  SAVE_GENERATED_SITE_EVENT,
  SAVE_GENERATED_SITE_RESULT_EVENT,
  type PublishableSitePayload,
} from "@/components/full-website-generator";
import { CHAIN_CONFIG, ROBINHOOD_MAINNET } from "@/lib/chains";
import { FREE_SITE_SECTION_DEFAULTS, type FreeSiteSectionKey } from "@/lib/free-site-sections";
import { isCompleteGeneratedPageHtml } from "@/lib/generated-site-page";
import { launchPathLabel } from "@/lib/launch-paths";
import { isPaidLaunchPath } from "@/lib/plan-payments";
import { PROJECT_SAVE_RESULT_EVENT } from "@/lib/project-save-result";
import { findSlugCollision, slugify, validateSlug } from "@/lib/slug";
import {
  deleteProjectFromStorage,
  loadProjectFromStorage,
  saveProjectToStorage,
} from "@/lib/token-project-persistence";
import {
  migrateLegacySavedProjects,
  serialiseSavedTokenProjects,
  TOKEN_STUDIO_PROJECTS_STORAGE_KEY,
  type SavedProjectIndexEntry,
} from "@/lib/token-project-storage";
import type { LaunchPath, SupportedChain, TokenProject, WalletState } from "@/lib/types";
import { TokenPathChooser } from "./token-path-chooser";

// CHAIN_CONFIG.label carries the wallet-facing "Robinhood Chain Testnet"
// name (lib/chains.ts is left untouched, since that name must stay accurate
// wherever a wallet reads it); this is neutral display copy for the studio's
// own chain picker/labels instead (issue #308).
const CHAIN_DISPLAY_LABEL: Record<SupportedChain, string> = {
  solana: CHAIN_CONFIG.solana.label,
  robinhood: "Robinhood Chain · 46630",
};

const SECTION_TOGGLE_FIELDS: ReadonlyArray<{ key: FreeSiteSectionKey; label: string }> = [
  { key: "about", label: "About" },
  { key: "tokenomics", label: "Tokenomics" },
  { key: "howToBuy", label: "How to buy" },
];

type EthereumProvider = {
  request: (args: {
    method: string;
    params?: unknown[] | Record<string, unknown>;
  }) => Promise<unknown>;
};

type SolanaProvider = {
  isPhantom?: boolean;
  publicKey?: { toString: () => string };
  connect: () => Promise<{ publicKey: { toString: () => string } }>;
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
    solana?: SolanaProvider;
    phantom?: { solana?: SolanaProvider };
  }
}

const DEFAULT_PROJECT: TokenProject = {
  id: "",
  createdAt: "",
  updatedAt: "",
  status: "draft",
  chain: "robinhood",
  name: "",
  ticker: "",
  description: "",
  supply: "1000000000",
  decimals: 18,
  websiteSlug: "",
  contractAddress: "",
  xHandle: "",
  telegram: "",
  heroImage: "",
  theme: "hoodlums",
  siteSections: FREE_SITE_SECTION_DEFAULTS,
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "Something went wrong. Try again in a moment.";
}

function makeProject(): TokenProject {
  const now = new Date().toISOString();
  return {
    ...DEFAULT_PROJECT,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
  };
}

function shortAddress(address: string): string {
  return address.length > 12
    ? `${address.slice(0, 6)}…${address.slice(-5)}`
    : address;
}

function formatSupply(value: string): string {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toLocaleString("en-GB") : value;
}

function publishableSiteFromProject(target: TokenProject): PublishableSitePayload | null {
  if (!target.generatedSiteHtml) return null;
  return {
    slug: target.websiteSlug || slugify(target.name) || "",
    name: target.name.trim(),
    ticker: target.ticker.trim().toUpperCase(),
    description: target.description.trim(),
    supply: target.supply,
    decimals: target.decimals,
    chain: target.chain,
    chainId: target.chain === "robinhood" ? "46630" : "solana-devnet",
    contractAddress: target.contractAddress.trim(),
    generatedSiteHtml: target.generatedSiteHtml,
    artworkReference: target.heroImage,
    xHandle: target.xHandle.trim(),
    telegram: target.telegram.trim(),
    status: "prepared",
  };
}

// Redisplays a project's last captured generation (inline preview, full
// screen, and the publish payload all read this same object) instead of
// forcing a fresh, non-deterministic model call just to look at it again
// (issue #198).
function reopenGeneratedSite(target: TokenProject) {
  const site = publishableSiteFromProject(target);
  if (!site) return;
  window.dispatchEvent(
    new CustomEvent(REOPEN_GENERATED_SITE_EVENT, {
      detail: { imageDataUrl: target.heroImage, site },
    }),
  );
}

const IDENTITY_KEYS = new Set<keyof TokenProject>([
  "name",
  "ticker",
  "description",
  "heroImage",
]);

export function TokenStudio() {
  const [project, setProject] = useState<TokenProject>(DEFAULT_PROJECT);
  const [projects, setProjects] = useState<SavedProjectIndexEntry[]>([]);
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [notice, setNotice] = useState(
    "Safe mode is on — no launch transaction can be sent from this build.",
  );
  const [isConnecting, setIsConnecting] = useState(false);
  const [showProjects, setShowProjects] = useState(false);
  const [showLaunchSummary, setShowLaunchSummary] = useState(false);
  const [showPathChooser, setShowPathChooser] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadIndex() {
      const raw = localStorage.getItem(TOKEN_STUDIO_PROJECTS_STORAGE_KEY);
      const { index, migratedCount, droppedCount } = await migrateLegacySavedProjects(raw);
      if (cancelled) return;

      if (migratedCount > 0 || droppedCount > 0) {
        try {
          localStorage.setItem(TOKEN_STUDIO_PROJECTS_STORAGE_KEY, serialiseSavedTokenProjects(index));
        } catch {
          // Nothing more useful to do if even the small index can't be
          // written back; the in-memory list below is still correct.
        }
      }

      setProjects(index);
      if (droppedCount > 0) {
        setNotice(
          `${droppedCount} saved launch${droppedCount === 1 ? "" : "es"} could not be recovered and ${droppedCount === 1 ? "was" : "were"} removed.`,
        );
      }
    }

    loadIndex().catch(() => {
      if (!cancelled) {
        setNotice("Saved projects could not be read. A new local workspace was opened.");
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onSiteGenerated(event: Event) {
      const detail = (event as CustomEvent<{ fullPage?: boolean; html?: unknown }>).detail;
      if (!detail?.fullPage || typeof detail.html !== "string") return;
      if (!isCompleteGeneratedPageHtml(detail.html)) return;
      const html = detail.html;
      setProject((current) => ({
        ...current,
        generatedSiteHtml: html,
        generatedSiteVersion: (current.generatedSiteVersion || 0) + 1,
        updatedAt: new Date().toISOString(),
      }));
    }

    window.addEventListener("launchpad:site-generated", onSiteGenerated);
    return () => window.removeEventListener("launchpad:site-generated", onSiteGenerated);
  }, []);

  // The "Save preview" control in the generated-site overlay lives outside
  // this component (components/full-website-generator.tsx), so it asks for
  // a save over this event instead of holding a reference to saveProject
  // directly. This reuses the exact same durable IndexedDB + localStorage
  // persistence path as the "Save project" button (issue #318) rather than
  // adding a second way to save a project.
  useEffect(() => {
    function onSavePreviewRequest() {
      saveProject()
        .then((success) => {
          window.dispatchEvent(
            new CustomEvent(SAVE_GENERATED_SITE_RESULT_EVENT, {
              detail: {
                success,
                message: success
                  ? "Preview saved. Your generated site is kept with this launch."
                  : "The preview could not be saved — see the notice above for details.",
              },
            }),
          );
        })
        .catch(() => {
          window.dispatchEvent(
            new CustomEvent(SAVE_GENERATED_SITE_RESULT_EVENT, {
              detail: { success: false, message: "The preview could not be saved." },
            }),
          );
        });
    }

    window.addEventListener(SAVE_GENERATED_SITE_EVENT, onSavePreviewRequest);
    return () => window.removeEventListener(SAVE_GENERATED_SITE_EVENT, onSavePreviewRequest);
  }, [project, projects]);

  const chain = CHAIN_CONFIG[project.chain];
  // Projects saved before this field existed have none; fall back to the
  // studio default (about + tokenomics on, the rest off — issue #171).
  const siteSections = project.siteSections ?? FREE_SITE_SECTION_DEFAULTS;
  const displayTicker = project.ticker.trim().toUpperCase() || "TOKEN";
  const displayName = project.name.trim() || "Untitled Meme";
  const displaySlug = project.websiteSlug || slugify(project.name) || "new-token";

  const readiness = useMemo(
    () => [
      { label: "Token name", complete: project.name.trim().length >= 2 },
      { label: "Ticker", complete: /^[A-Za-z0-9]{2,12}$/.test(project.ticker.trim()) },
      { label: "Description", complete: project.description.trim().length >= 20 },
      { label: "Supply", complete: Number(project.supply) > 0 },
      { label: "Wallet", complete: wallet?.chain === project.chain },
      { label: "Artwork", complete: Boolean(project.heroImage) },
    ],
    [project, wallet],
  );

  const completedChecks = readiness.filter((item) => item.complete).length;

  function updateProject<K extends keyof TokenProject>(
    key: K,
    value: TokenProject[K],
  ) {
    setProject((current) => {
      const identityChanged = IDENTITY_KEYS.has(key) && current[key] !== value;
      return {
        ...current,
        [key]: value,
        generatedSiteHtml: identityChanged ? null : current.generatedSiteHtml,
        generatedSiteVersion: identityChanged ? null : current.generatedSiteVersion,
        updatedAt: new Date().toISOString(),
      };
    });
  }

  function updateName(value: string) {
    setProject((current) => ({
      ...current,
      name: value,
      websiteSlug:
        !current.websiteSlug || current.websiteSlug === slugify(current.name)
          ? slugify(value)
          : current.websiteSlug,
      generatedSiteHtml: current.name !== value ? null : current.generatedSiteHtml,
      generatedSiteVersion: current.name !== value ? null : current.generatedSiteVersion,
      updatedAt: new Date().toISOString(),
    }));
  }

  // Every save is awaited and error-handled end to end (heavy IndexedDB
  // write, then the small localStorage index write). A failure at either
  // step is surfaced to the user and never updates `projects` or `project`
  // state, so a save that didn't actually persist can never leave a "Saved
  // launches" row that reopens to nothing (issue #307).
  async function saveProject(nextStatus: TokenProject["status"] = project.status): Promise<boolean> {
    const slug = displaySlug;
    const validation = validateSlug(slug);
    if (!validation.valid) {
      setNotice(validation.reason);
      window.dispatchEvent(
        new CustomEvent(PROJECT_SAVE_RESULT_EVENT, { detail: { success: false } }),
      );
      return false;
    }

    const collision = findSlugCollision(projects, slug, project.id);
    if (collision) {
      setNotice(
        `"${slug}" is already used by ${collision.name || "another saved project"} in this browser. Choose a different website path.`,
      );
      window.dispatchEvent(
        new CustomEvent(PROJECT_SAVE_RESULT_EVENT, { detail: { success: false } }),
      );
      return false;
    }

    const now = new Date().toISOString();
    const saved: TokenProject = {
      ...project,
      id: project.id || crypto.randomUUID(),
      createdAt: project.createdAt || now,
      updatedAt: now,
      status: nextStatus,
      ticker: project.ticker.trim().toUpperCase(),
      websiteSlug: slug,
    };

    const outcome = await saveProjectToStorage(saved, projects);
    if (!outcome.success) {
      setNotice(outcome.error);
      window.dispatchEvent(
        new CustomEvent(PROJECT_SAVE_RESULT_EVENT, { detail: { success: false } }),
      );
      return false;
    }

    setProject(saved);
    setProjects(outcome.index);
    setNotice(`${saved.name || "Project"} saved privately in this browser.`);
    window.dispatchEvent(
      new CustomEvent(PROJECT_SAVE_RESULT_EVENT, { detail: { success: true } }),
    );
    return true;
  }

  function startNewProject() {
    setProject(makeProject());
    setWallet(null);
    setShowProjects(false);
    setShowPathChooser(true);
    setNotice("New private token project created.");
  }

  function confirmLaunchPath(path: LaunchPath) {
    updateProject("launchPath", path);
    setShowPathChooser(false);
  }

  function changeLaunchPath() {
    setShowPathChooser(true);
  }

  async function deleteProject(id: string) {
    const outcome = await deleteProjectFromStorage(id, projects);
    if (!outcome.success) {
      setNotice(outcome.error);
      return;
    }
    setProjects(outcome.index);
    if (project.id === id) setProject(makeProject());
    setNotice("Project removed from local storage.");
  }

  async function loadProject(entry: SavedProjectIndexEntry) {
    const outcome = await loadProjectFromStorage(entry);
    if (!outcome.success) {
      setNotice(outcome.error);
      return;
    }
    const saved = outcome.project;
    const requiresPayment = isPaidLaunchPath(saved.launchPath);
    setProject(saved);
    setWallet(null);
    setShowProjects(false);
    setShowPathChooser(requiresPayment);
    setNotice(
      requiresPayment
        ? `${saved.name} loaded. Verify the saved paid plan before the builder or generated preview can reopen.`
        : `${saved.name} loaded. Reconnect the correct wallet before launching.`,
    );
    if (!requiresPayment) reopenGeneratedSite(saved);
  }

  async function handleImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setNotice("Please choose an image file.");
      return;
    }
    if (file.size > 1_500_000) {
      setNotice("Keep preview artwork below 1.5 MB so local saving remains reliable.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => updateProject("heroImage", String(reader.result || ""));
    reader.onerror = () => setNotice("The artwork could not be read.");
    reader.readAsDataURL(file);
  }

  async function connectWallet() {
    setIsConnecting(true);
    try {
      if (project.chain === "robinhood") {
        if (!window.ethereum) {
          throw new Error("No EVM wallet was found. Install MetaMask or Robinhood Wallet.");
        }
        const accounts = (await window.ethereum.request({
          method: "eth_requestAccounts",
        })) as string[];
        if (!accounts?.[0]) throw new Error("The wallet returned no account.");

        try {
          await window.ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: ROBINHOOD_MAINNET.chainId }],
          });
        } catch (switchError) {
          const code = (switchError as { code?: number })?.code;
          if (code !== 4902) throw switchError;
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [ROBINHOOD_MAINNET],
          });
        }

        setWallet({ chain: "robinhood", address: accounts[0] });
        setNotice("Robinhood Chain wallet connected. Safe mode still prevents deployment.");
      } else {
        const provider = window.phantom?.solana || window.solana;
        if (!provider) {
          throw new Error("No Solana wallet was found. Install Phantom first.");
        }
        const response = await provider.connect();
        setWallet({ chain: "solana", address: response.publicKey.toString() });
        setNotice("Solana wallet connected. Safe mode still prevents mint creation.");
      }
    } catch (error) {
      setNotice(getErrorMessage(error));
    } finally {
      setIsConnecting(false);
    }
  }

  async function prepareLaunch() {
    const essentials = readiness.slice(0, 5);
    if (!essentials.every((item) => item.complete)) {
      setNotice("Complete the required launch checks before preparing the transaction.");
      return;
    }
    if (!(await saveProject("prepared"))) return;
    setShowLaunchSummary(true);
  }

  // Once a site is generated, this is a one-step shortcut to saving and
  // opening the launch summary. It reuses saveProject directly rather than
  // routing through prepareLaunch's separate launch-readiness gate, since
  // generating a site already required the artwork/copy those checks look
  // for. The launch window never opens if the save fails.
  async function saveAndLaunch() {
    if (!(await saveProject("prepared"))) return;
    setShowLaunchSummary(true);
  }

  function exportProject() {
    const payload = JSON.stringify(
      {
        ...project,
        ticker: displayTicker,
        websiteSlug: displaySlug,
        exportedAt: new Date().toISOString(),
      },
      null,
      2,
    );
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${displaySlug}-launch-project.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice("Project JSON exported.");
  }

  return (
    <main className="app-shell">
      <header className="topbar" inert={showPathChooser || undefined}>
        <div className="brand-lockup">
          <div className="brand-mark">H</div>
          <div>
            <p className="eyebrow">PRIVATE BUILD</p>
            <h1>Meme Token Studio</h1>
          </div>
        </div>
        <div className="topbar-actions">
          <span className="safe-badge"><i /> Safe mode</span>
          <button className="ghost-button" onClick={() => setShowProjects(true)}>
            Projects <b>{projects.length}</b>
          </button>
          <button className="primary-button compact" onClick={startNewProject}>
            + New token
          </button>
        </div>
      </header>

      <section className="notice-bar">
        <span>●</span>
        <p>{notice}</p>
      </section>

      <section
        className="workspace"
        aria-disabled={showPathChooser || undefined}
        inert={showPathChooser || undefined}
      >
        <aside
          className={showPathChooser ? "builder-panel path-locked" : "builder-panel"}
          role="group"
          aria-disabled={showPathChooser || undefined}
          inert={showPathChooser || undefined}
        >
          <div className="panel-heading">
            <div>
              <p className="eyebrow">BUILD 01</p>
              <h2>Token setup</h2>
              {project.launchPath && (
                <p className="plan-indicator">
                  Plan: {launchPathLabel(project.launchPath)} ·{" "}
                  <button type="button" className="change-plan-button" onClick={changeLaunchPath}>
                    Change plan
                  </button>
                </p>
              )}
            </div>
            <span className="progress-count">{completedChecks}/{readiness.length}</span>
          </div>

          <div className="field-group">
            <span className="field-label">Network</span>
            <div className="chain-picker">
              {(["robinhood", "solana"] as SupportedChain[]).map((item) => (
                <button
                  key={item}
                  className={project.chain === item ? "chain-option active" : "chain-option"}
                  onClick={() => {
                    updateProject("chain", item);
                    updateProject("decimals", item === "robinhood" ? 18 : 9);
                    setWallet(null);
                  }}
                >
                  <span className={`chain-icon ${item}`} aria-hidden="true">
                    {item === "robinhood" ? (
                      <svg viewBox="0 0 24 24" width="19" height="19">
                        <path
                          d="M6.7 21.2c-.5-4.9.4-9 2.8-12.2C11.8 5.9 15.4 3.7 20.2 2.5c.6-.15.95.5.5.9-3.1 2.7-5.3 5.5-6.7 8.3-1.4 2.9-2.1 6-2.1 9.5 0 .55-.45 1-1 1H7.7c-.52 0-.95-.4-1-.99z"
                          fill="#CCFF00"
                        />
                        <path
                          d="M4 21.2c0-3.6.5-6.6 1.6-9 .2-.45.85-.4 1 .07.5 1.7.72 3.6.65 5.7-.03 1.05-.13 2.15-.3 3.3-.07.5-.5.87-1 .87H5c-.55 0-1-.45-1-.94z"
                          fill="#8FD400"
                        />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 20" width="19" height="16">
                        <defs>
                          <linearGradient id="chain-icon-solana" x1="0" y1="20" x2="24" y2="0" gradientUnits="userSpaceOnUse">
                            <stop offset="0" stopColor="#9945FF" />
                            <stop offset="1" stopColor="#14F195" />
                          </linearGradient>
                        </defs>
                        <g fill="url(#chain-icon-solana)">
                          <path d="M4.9 14.6a.9.9 0 0 1 .64-.27h17.1c.4 0 .6.48.32.76l-3.78 3.78a.9.9 0 0 1-.64.27H1.42c-.4 0-.6-.48-.32-.76z" />
                          <path d="M4.9 1.13A.92.92 0 0 1 5.54.86h17.1c.4 0 .6.48.32.76l-3.78 3.79a.9.9 0 0 1-.64.26H1.42c-.4 0-.6-.48-.32-.76z" />
                          <path d="M18.98 7.82a.9.9 0 0 0-.64-.27H1.42c-.4 0-.6.48-.32.76L4.9 12.1a.9.9 0 0 0 .64.26h16.92c.4 0 .6-.48.32-.76z" />
                        </g>
                      </svg>
                    )}
                  </span>
                  <span>{CHAIN_DISPLAY_LABEL[item]}</span>
                  <span className={`chain-dot ${item}`} />
                </button>
              ))}
            </div>
          </div>

          <div className="two-column-fields">
            <label>
              <span className="field-label">Token name</span>
              <input
                id="token-name-input"
                value={project.name}
                onChange={(event) => updateName(event.target.value)}
                placeholder="Token name"
                maxLength={32}
              />
            </label>
            <label>
              <span className="field-label">Ticker</span>
              <div className="ticker-input">
                <span>$</span>
                <input
                  value={project.ticker}
                  onChange={(event) =>
                    updateProject(
                      "ticker",
                      event.target.value.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12),
                    )
                  }
                  placeholder="TICKER"
                />
              </div>
            </label>
          </div>

          <label>
            <span className="field-label">Project story</span>
            <textarea
              value={project.description}
              onChange={(event) => updateProject("description", event.target.value)}
              placeholder="What is the meme and why will people care?"
              rows={4}
              maxLength={360}
            />
            <small>{project.description.length}/360</small>
          </label>

          <div className="two-column-fields">
            <label>
              <span className="field-label">Total supply</span>
              <input
                value={project.supply}
                inputMode="numeric"
                onChange={(event) =>
                  updateProject("supply", event.target.value.replace(/\D/g, ""))
                }
                placeholder="1000000000"
              />
            </label>
            <label>
              <span className="field-label">Decimals</span>
              <input
                type="number"
                min={0}
                max={project.chain === "solana" ? 9 : 18}
                value={project.decimals}
                onChange={(event) =>
                  updateProject("decimals", Number(event.target.value))
                }
              />
            </label>
          </div>

          <label>
            <span className="field-label">Website path</span>
            <div className="url-input">
              <span>hoodlums.dev/</span>
              <input
                value={project.websiteSlug}
                onChange={(event) =>
                  updateProject("websiteSlug", slugify(event.target.value))
                }
                placeholder="your-token-name"
              />
            </div>
          </label>

          <label className="upload-box">
            <input type="file" accept="image/*" onChange={handleImage} />
            <span className="upload-icon">↑</span>
            <span>
              <b>{project.heroImage ? "Replace artwork" : "Upload token artwork"}</b>
              <small>PNG, JPG or WEBP · maximum 1.5 MB</small>
            </span>
            {project.heroImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={project.heroImage} alt="Token artwork preview" />
            )}
          </label>

          <div className="two-column-fields">
            <label>
              <span className="field-label">X handle</span>
              <input
                value={project.xHandle}
                onChange={(event) => updateProject("xHandle", event.target.value)}
                placeholder="@hoodlums"
              />
            </label>
            <label>
              <span className="field-label">Telegram</span>
              <input
                value={project.telegram}
                onChange={(event) => updateProject("telegram", event.target.value)}
                placeholder="t.me/hoodlums"
              />
            </label>
          </div>

          <label>
            <span className="field-label">Contract / mint address</span>
            <input
              value={project.contractAddress}
              onChange={(event) => updateProject("contractAddress", event.target.value.trim())}
              placeholder="Filled automatically after launch"
            />
          </label>

          <div className="field-group">
            <span className="field-label">Free site sections</span>
            <div className="section-toggle-grid">
              {SECTION_TOGGLE_FIELDS.map(({ key, label }) => (
                <label key={key} className="section-toggle">
                  <input
                    type="checkbox"
                    checked={siteSections[key]}
                    onChange={(event) =>
                      updateProject("siteSections", { ...siteSections, [key]: event.target.checked })
                    }
                  />
                  <span className="field-label">{label}</span>
                </label>
              ))}
            </div>
            <small>
              Hero always shows. Pick which other sections the free site generator writes — the
              rest are skipped instead of filled with invented copy.
            </small>
          </div>

          <div className="readiness-card">
            <div className="readiness-title">
              <span>Launch checks</span>
              <b>{Math.round((completedChecks / readiness.length) * 100)}%</b>
            </div>
            <div className="progress-track">
              <span style={{ width: `${(completedChecks / readiness.length) * 100}%` }} />
            </div>
            <ul>
              {readiness.map((item) => (
                <li key={item.label} className={item.complete ? "complete" : ""}>
                  <span>{item.complete ? "✓" : "·"}</span> {item.label}
                </li>
              ))}
            </ul>
          </div>

          <div className="wallet-row">
            <button className="wallet-button" onClick={connectWallet} disabled={isConnecting}>
              {wallet?.chain === project.chain
                ? `${chain.walletLabel}: ${shortAddress(wallet.address)}`
                : isConnecting
                  ? "Connecting…"
                  : `Connect ${chain.walletLabel}`}
            </button>
          </div>

          <div className="action-grid">
            <button className="secondary-button" onClick={() => saveProject()}>
              Save project
            </button>
            <button className="primary-button" onClick={prepareLaunch}>
              Prepare launch
            </button>
          </div>
          {project.generatedSiteHtml && (
            <button className="primary-button full-width" onClick={saveAndLaunch}>
              Save and launch
            </button>
          )}
          <button className="text-button" onClick={exportProject}>
            Export project JSON
          </button>
        </aside>

        <section className="preview-panel">
          <div className="preview-toolbar">
            <div>
              <span className="live-dot" /> Live website preview
            </div>
            <span>/{displaySlug}</span>
          </div>

          <div className="site-preview">
            {project.generatedSiteHtml && (
              <div className="site-preview-reopen-card">
                <strong>Your generated site is saved</strong>
                <p>
                  Closing the preview keeps your generated site. Reopen the branded overlay to
                  review it, publish a draft, or save it again.
                </p>
                <button
                  type="button"
                  className="reopen-generated-site-button"
                  onClick={() => reopenGeneratedSite(project)}
                >
                  Reopen generated site
                </button>
              </div>
            )}
            {!project.generatedSiteHtml && (
              <div className="site-preview-empty-state">
                <strong>Your generated site will appear here</strong>
                <p>
                  Upload artwork, fill in the project details, then generate a site to see a live
                  preview.
                </p>
              </div>
            )}
          </div>
        </section>
      </section>

      {showProjects && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card projects-modal">
            <div className="modal-heading">
              <div><p className="eyebrow">LOCAL VAULT</p><h2>Saved projects</h2></div>
              <button onClick={() => setShowProjects(false)}>×</button>
            </div>
            {projects.length === 0 ? (
              <div className="empty-state">No saved projects yet.</div>
            ) : (
              <div className="project-list">
                {projects.map((saved) => (
                  <article key={saved.id}>
                    <button className="project-main" onClick={() => loadProject(saved)}>
                      <span className={`chain-dot ${saved.chain}`} />
                      <span><b>{saved.name || "Untitled"}</b><small>${saved.ticker || "TOKEN"} · {CHAIN_DISPLAY_LABEL[saved.chain]}</small></span>
                      <em>{saved.status}</em>
                    </button>
                    <button className="delete-button" onClick={() => deleteProject(saved.id)}>Delete</button>
                  </article>
                ))}
              </div>
            )}
            <button className="primary-button full-width" onClick={startNewProject}>+ Create another token</button>
          </div>
        </div>
      )}

      {showLaunchSummary && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card launch-modal">
            <div className="modal-heading">
              <div><p className="eyebrow">TRANSACTION PREVIEW</p><h2>Launch prepared</h2></div>
              <button onClick={() => setShowLaunchSummary(false)}>×</button>
            </div>
            <div className="summary-token">
              <div>{project.heroImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={project.heroImage} alt="" />
              ) : "H"}</div>
              <span><b>{displayName}</b><small>${displayTicker} on {CHAIN_DISPLAY_LABEL[project.chain]}</small></span>
            </div>
            <dl>
              <div><dt>Total supply</dt><dd>{formatSupply(project.supply)}</dd></div>
              <div><dt>Decimals</dt><dd>{project.decimals}</dd></div>
              <div><dt>Signer</dt><dd>{wallet ? shortAddress(wallet.address) : "Not connected"}</dd></div>
              <div><dt>Private key handling</dt><dd>Never stored</dd></div>
              <div><dt>Mainnet transaction</dt><dd className="blocked">BLOCKED IN SAFE MODE</dd></div>
            </dl>
            <div className="warning-box">
              Deployment isn&apos;t connected yet — this preview shows what your transaction will
              look like once it is. The next step is a wallet-signed test transaction, followed
              by a reviewed mainnet switch.
            </div>
            <button className="primary-button full-width" onClick={() => setShowLaunchSummary(false)}>Return to builder</button>
          </div>
        </div>
      )}

      <TokenPathChooser
        open={showPathChooser}
        selected={project.launchPath ?? null}
        onConfirm={confirmLaunchPath}
      />
    </main>
  );
}
