"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { CHAIN_CONFIG, ROBINHOOD_MAINNET } from "@/lib/chains";
import { isCompleteGeneratedPageHtml } from "@/lib/generated-site-page";
import { PROJECT_SAVE_RESULT_EVENT } from "@/lib/project-save-result";
import { getSiteDesignVariant } from "@/lib/site-design-variants";
import { findSlugCollision, slugify, validateSlug } from "@/lib/slug";
import type { SupportedChain, TokenProject, WalletState } from "@/lib/types";

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

const STORAGE_KEY = "private-meme-token-studio-projects-v1";

const DEFAULT_PROJECT: TokenProject = {
  id: "hoodlums-demo",
  createdAt: "",
  updatedAt: "",
  status: "draft",
  chain: "robinhood",
  name: "Hoodlums",
  ticker: "HOODLUMS",
  description:
    "The code-running crew taking meme culture to a new chain. No masters. No middlemen. Just the heist.",
  supply: "1000000000",
  decimals: 18,
  websiteSlug: "hoodlums",
  contractAddress: "",
  xHandle: "@hoodlums",
  telegram: "t.me/hoodlums",
  heroImage: "",
  theme: "hoodlums",
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "Something went wrong.";
}

function makeProject(): TokenProject {
  const now = new Date().toISOString();
  return {
    ...DEFAULT_PROJECT,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    name: "",
    ticker: "",
    description: "",
    websiteSlug: "",
    contractAddress: "",
    xHandle: "",
    telegram: "",
    heroImage: "",
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

const IDENTITY_KEYS = new Set<keyof TokenProject>([
  "name",
  "ticker",
  "description",
  "heroImage",
]);

export function TokenStudio() {
  const [project, setProject] = useState<TokenProject>(DEFAULT_PROJECT);
  const [projects, setProjects] = useState<TokenProject[]>([]);
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [notice, setNotice] = useState(
    "Safe mode is on — no launch transaction can be sent from this build.",
  );
  const [isConnecting, setIsConnecting] = useState(false);
  const [showProjects, setShowProjects] = useState(false);
  const [showLaunchSummary, setShowLaunchSummary] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as TokenProject[];
      if (Array.isArray(parsed)) setProjects(parsed);
    } catch {
      setNotice("Saved projects could not be read. A new local workspace was opened.");
    }
  }, []);

  useEffect(() => {
    function onSiteGenerated(event: Event) {
      const detail = (event as CustomEvent<{
        fullPage?: boolean;
        html?: unknown;
        variantId?: unknown;
        variantLabel?: unknown;
      }>).detail;
      if (!detail?.fullPage || typeof detail.html !== "string") return;
      if (!isCompleteGeneratedPageHtml(detail.html)) return;
      const variant = getSiteDesignVariant(typeof detail.variantId === "string" ? detail.variantId : "");
      if (!variant || detail.variantLabel !== variant.label) return;
      const html = detail.html;
      setProject((current) => ({
        ...current,
        generatedSiteHtml: html,
        generatedSiteVersion: (current.generatedSiteVersion || 0) + 1,
        generatedSiteVariantId: variant.id,
        generatedSiteVariantLabel: variant.label,
        updatedAt: new Date().toISOString(),
      }));
    }

    window.addEventListener("launchpad:site-generated", onSiteGenerated);
    return () => window.removeEventListener("launchpad:site-generated", onSiteGenerated);
  }, []);

  const chain = CHAIN_CONFIG[project.chain];
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
        generatedSiteVariantId: identityChanged ? null : current.generatedSiteVariantId,
        generatedSiteVariantLabel: identityChanged ? null : current.generatedSiteVariantLabel,
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
      generatedSiteVariantId: current.name !== value ? null : current.generatedSiteVariantId,
      generatedSiteVariantLabel: current.name !== value ? null : current.generatedSiteVariantLabel,
      updatedAt: new Date().toISOString(),
    }));
  }

  function persist(nextProjects: TokenProject[]) {
    setProjects(nextProjects);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextProjects));
  }

  function saveProject(nextStatus: TokenProject["status"] = project.status): boolean {
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
    const nextProjects = [
      saved,
      ...projects.filter((item) => item.id !== saved.id),
    ];
    setProject(saved);
    persist(nextProjects);
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
    setNotice("New private token project created.");
  }

  function deleteProject(id: string) {
    const nextProjects = projects.filter((item) => item.id !== id);
    persist(nextProjects);
    if (project.id === id) setProject(makeProject());
    setNotice("Project removed from local storage.");
  }

  function loadProject(saved: TokenProject) {
    setProject(saved);
    setWallet(null);
    setShowProjects(false);
    setNotice(`${saved.name} loaded. Reconnect the correct wallet before launching.`);
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

  function prepareLaunch() {
    const essentials = readiness.slice(0, 5);
    if (!essentials.every((item) => item.complete)) {
      setNotice("Complete the required launch checks before preparing the transaction.");
      return;
    }
    if (!saveProject("prepared")) return;
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
      <header className="topbar">
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

      <section className="workspace">
        <aside className="builder-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">BUILD 01</p>
              <h2>Token setup</h2>
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
                  <span className={`chain-dot ${item}`} />
                  <span>{CHAIN_CONFIG[item].label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="two-column-fields">
            <label>
              <span className="field-label">Token name</span>
              <input
                value={project.name}
                onChange={(event) => updateName(event.target.value)}
                placeholder="Hoodlums"
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
                  placeholder="HOOD"
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
                placeholder="hoodlums"
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
            <div className="matrix-rain" aria-hidden="true">
              {Array.from({ length: 26 }, (_, index) => (
                <span key={index} style={{ left: `${index * 4}%`, animationDelay: `${-(index % 8)}s` }}>
                  01<br />10<br />$<br />01<br />H<br />00<br />1
                </span>
              ))}
            </div>

            <nav className="preview-nav">
              <strong>{displayName.toUpperCase()}</strong>
              <div>
                <a href="#tokenomics">Tokenomics</a>
                <a href="#roadmap">The heist</a>
                <a href="#buy">Buy</a>
              </div>
              <button>BUY ${displayTicker}</button>
            </nav>

            <section className="hero-section">
              <div className="hero-copy">
                <p className="terminal-line">root@{displaySlug}:~$ initiate_heist</p>
                <h2>{displayName.toUpperCase()}</h2>
                <div className="graffiti-ticker">${displayTicker}</div>
                <p>{project.description || "Give the crew a story worth joining."}</p>
                <div className="hero-buttons">
                  <button>JOIN THE HEIST</button>
                  <button className="outline">VIEW CHART ↗</button>
                </div>
                <div className="contract-strip">
                  <span>CA:</span>
                  <code>
                    {project.contractAddress
                      ? shortAddress(project.contractAddress)
                      : "appears-after-wallet-launch"}
                  </code>
                  <b>COPY</b>
                </div>
              </div>

              <div className="hero-art">
                <div className="spray-ring" />
                {project.heroImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={project.heroImage} alt={`${displayName} artwork`} />
                ) : (
                  <div className="hooded-placeholder">
                    <span className="hood" />
                    <span className="face">H</span>
                    <span className="body" />
                    <small>UPLOAD<br />THE CREW</small>
                  </div>
                )}
                <div className="chain-stamp">LIVE ON<br /><b>{chain.label}</b></div>
              </div>
            </section>

            <div className="ticker-tape">
              {Array.from({ length: 5 }, (_, index) => (
                <span key={index}>${displayTicker} ✦ STEAL THE MEMES ✦ {chain.shortLabel} ✦ </span>
              ))}
            </div>

            <section className="preview-content" id="tokenomics">
              <div className="section-tag">// THE LOOT</div>
              <h3>TOKENOMICS</h3>
              <div className="terminal-card">
                <div className="terminal-bar"><i /><i /><i /><span>tokenomics.sh</span></div>
                <div className="token-stats">
                  <article><span>SUPPLY</span><strong>{formatSupply(project.supply || "0")}</strong></article>
                  <article><span>TAX</span><strong>0 / 0</strong></article>
                  <article><span>CHAIN</span><strong>{chain.shortLabel}</strong></article>
                  <article><span>STATUS</span><strong>{project.status.toUpperCase()}</strong></article>
                </div>
                <pre>{`> mint_authority: decide_before_launch\n> freeze_authority: decide_before_launch\n> private_keys_stored: false\n> wallet_signature_required: true`}</pre>
              </div>
            </section>

            <section className="preview-content road-section" id="roadmap">
              <div className="section-tag">// THE PLAN</div>
              <h3>THE HEIST</h3>
              <div className="roadmap-grid">
                <article><b>01</b><h4>ASSEMBLE</h4><p>Build the identity, website and social pack.</p></article>
                <article><b>02</b><h4>BREACH</h4><p>Launch through a wallet-signed transaction.</p></article>
                <article><b>03</b><h4>ESCAPE</h4><p>Publish the contract and bring in the crew.</p></article>
              </div>
            </section>

            <section className="buy-section" id="buy">
              <p className="terminal-line">READY WHEN THE WALLET SIGNS</p>
              <h3>TAKE FROM THE RICH.<br />GIVE TO THE MEMES.</h3>
              <button>BUY ${displayTicker}</button>
              <div className="social-row">
                <span>{project.xHandle || "X account pending"}</span>
                <span>{project.telegram || "Telegram pending"}</span>
              </div>
            </section>
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
                      <span><b>{saved.name || "Untitled"}</b><small>${saved.ticker || "TOKEN"} · {CHAIN_CONFIG[saved.chain].label}</small></span>
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
              <span><b>{displayName}</b><small>${displayTicker} on {chain.label}</small></span>
            </div>
            <dl>
              <div><dt>Total supply</dt><dd>{formatSupply(project.supply)}</dd></div>
              <div><dt>Decimals</dt><dd>{project.decimals}</dd></div>
              <div><dt>Signer</dt><dd>{wallet ? shortAddress(wallet.address) : "Not connected"}</dd></div>
              <div><dt>Private key handling</dt><dd>Never stored</dd></div>
              <div><dt>Mainnet transaction</dt><dd className="blocked">BLOCKED IN SAFE MODE</dd></div>
            </dl>
            <div className="warning-box">
              The deployment adapter is deliberately not active in this first commit. The next step is a testnet-only wallet transaction, followed by a reviewed mainnet switch.
            </div>
            <button className="primary-button full-width" onClick={() => setShowLaunchSummary(false)}>Return to builder</button>
          </div>
        </div>
      )}
    </main>
  );
}
