"use client";

import { useEffect, useState } from "react";
import { CHAIN_CONFIG } from "@/lib/chains";
import type { TokenProject } from "@/lib/types";
import { TokenStudio } from "./token-studio";
import styles from "./token-studio-workspace.module.css";

const STORAGE_KEY = "private-meme-token-studio-projects-v1";
const CURVE_PLAN_STORAGE_KEY = "hoodlums-testnet-bonding-curve-plans-v1";
const HOODLUMS_CONTRACT = "0x3bf7447cd055f1475a8b09090c7b062abc9d3798";

const HOODLUMS_LAUNCH: TokenProject = {
  id: "hoodlums-robinhood-testnet-46630",
  createdAt: "2026-07-16T00:00:00.000Z",
  updatedAt: "2026-07-16T00:00:00.000Z",
  status: "launched",
  chain: "robinhood",
  name: "Hoodlums",
  ticker: "HOODLUMS",
  description:
    "The code-running crew taking meme culture to a new chain. No masters. No middlemen. Just the heist.",
  supply: "1000000000",
  decimals: 18,
  websiteSlug: "hoodlums",
  contractAddress: HOODLUMS_CONTRACT,
  xHandle: "@hoodlums",
  telegram: "t.me/hoodlums",
  heroImage: "",
  theme: "hoodlums",
};

type PendingAction = "new" | "saved" | null;
type StudioTab = "create" | "launched" | "curve";
type CurveModel = "unselected" | "linear" | "virtual-reserves";

type BondingCurvePlan = {
  projectId: string;
  allocationPercent: string;
  graduationTarget: string;
  virtualLiquidity: string;
  model: CurveModel;
  updatedAt: string;
};

const STUDIO_TABS: Array<{ id: StudioTab; label: string; description: string }> = [
  { id: "create", label: "Create Token", description: "Setup and prepare" },
  { id: "launched", label: "Launched Tokens", description: "Testnet contracts" },
  { id: "curve", label: "Bonding Curve", description: "Plan the curve" },
];

function isHoodlumsRecord(project: TokenProject) {
  return (
    project.id === HOODLUMS_LAUNCH.id ||
    project.contractAddress.toLowerCase() === HOODLUMS_CONTRACT ||
    (project.name.toLowerCase() === "hoodlums" &&
      project.ticker.toUpperCase() === "HOODLUMS")
  );
}

function readProjects(): TokenProject[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as TokenProject[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function seedHoodlumsLaunch(): TokenProject[] {
  try {
    const projects = readProjects();
    const existing = projects.find(isHoodlumsRecord);
    const protectedRecord: TokenProject = {
      ...HOODLUMS_LAUNCH,
      ...existing,
      id: HOODLUMS_LAUNCH.id,
      status: "launched",
      chain: "robinhood",
      name: "Hoodlums",
      ticker: "HOODLUMS",
      supply: "1000000000",
      decimals: 18,
      websiteSlug: "hoodlums",
      contractAddress: HOODLUMS_CONTRACT,
      updatedAt: existing?.updatedAt || HOODLUMS_LAUNCH.updatedAt,
    };
    const nextProjects = [
      protectedRecord,
      ...projects.filter((project) => !isHoodlumsRecord(project)),
    ];

    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextProjects));
    return nextProjects;
  } catch {
    // The deployed contract remains safely recorded on-chain even if browser storage is unavailable.
    return [HOODLUMS_LAUNCH];
  }
}

export function filterLaunchedProjects(projects: TokenProject[]): TokenProject[] {
  return projects.filter(
    (project) => project.status === "launched" && project.contractAddress.trim().length > 0,
  );
}

function readCurvePlans(): Record<string, BondingCurvePlan> {
  try {
    const raw = localStorage.getItem(CURVE_PLAN_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, BondingCurvePlan>;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function createDefaultCurvePlan(projectId: string): BondingCurvePlan {
  return {
    projectId,
    allocationPercent: "70",
    graduationTarget: "10",
    virtualLiquidity: "1",
    model: "unselected",
    updatedAt: "",
  };
}

export function calculateCurveSupply(supply: string, allocationPercent: string): string {
  try {
    const total = BigInt(supply.trim());
    const percent = Number(allocationPercent);
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) return "—";
    const basisPoints = BigInt(Math.round(percent * 100));
    return ((total * basisPoints) / 10_000n).toLocaleString("en-GB");
  } catch {
    return "—";
  }
}

function formatSupply(value: string): string {
  try {
    return BigInt(value).toLocaleString("en-GB");
  } catch {
    return value || "—";
  }
}

function shortAddress(address: string): string {
  return address.length > 18 ? `${address.slice(0, 8)}…${address.slice(-6)}` : address;
}

function explorerUrl(project: TokenProject): string {
  const baseUrl = CHAIN_CONFIG[project.chain].explorerBaseUrl;
  const suffix = project.chain === "solana" ? "?cluster=devnet" : "";
  return `${baseUrl}${project.contractAddress}${suffix}`;
}

function findStudioButton(label: string) {
  return Array.from(
    document.querySelectorAll<HTMLButtonElement>("#launch-studio button"),
  ).find((button) => button.textContent?.toLowerCase().includes(label.toLowerCase()));
}

export function TokenStudioWorkspace() {
  const [activeTab, setActiveTab] = useState<StudioTab>("create");
  const [isOpen, setIsOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [launchedProjects, setLaunchedProjects] = useState<TokenProject[]>([HOODLUMS_LAUNCH]);
  const [selectedLaunchId, setSelectedLaunchId] = useState(HOODLUMS_LAUNCH.id);
  const [curvePlans, setCurvePlans] = useState<Record<string, BondingCurvePlan>>({});
  const [curveNotice, setCurveNotice] = useState(
    "Planning only — no bonding-curve contract or transaction is connected yet.",
  );

  useEffect(() => {
    seedHoodlumsLaunch();
  }, []);

  useEffect(() => {
    if (!isOpen || !pendingAction) return;

    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      const button = findStudioButton(pendingAction === "new" ? "new token" : "projects");
      if (button) {
        button.click();
        setPendingAction(null);
        window.clearInterval(timer);
      } else if (attempts >= 20) {
        setPendingAction(null);
        window.clearInterval(timer);
      }
    }, 50);

    return () => window.clearInterval(timer);
  }, [isOpen, pendingAction]);

  const selectedLaunch =
    launchedProjects.find((project) => project.id === selectedLaunchId) ||
    launchedProjects[0] ||
    null;
  const currentCurvePlan = selectedLaunch
    ? curvePlans[selectedLaunch.id] || createDefaultCurvePlan(selectedLaunch.id)
    : null;
  const curveAllocation = currentCurvePlan
    ? Number(currentCurvePlan.allocationPercent)
    : Number.NaN;
  const graduationTarget = currentCurvePlan
    ? Number(currentCurvePlan.graduationTarget)
    : Number.NaN;
  const virtualLiquidity = currentCurvePlan
    ? Number(currentCurvePlan.virtualLiquidity)
    : Number.NaN;
  const curvePlanValid =
    Boolean(selectedLaunch && currentCurvePlan) &&
    Number.isFinite(curveAllocation) &&
    curveAllocation > 0 &&
    curveAllocation <= 100 &&
    Number.isFinite(graduationTarget) &&
    graduationTarget > 0 &&
    Number.isFinite(virtualLiquidity) &&
    virtualLiquidity >= 0;

  function refreshLaunchedProjects(): TokenProject[] {
    const launched = filterLaunchedProjects(seedHoodlumsLaunch());
    setLaunchedProjects(launched);
    if (!launched.some((project) => project.id === selectedLaunchId)) {
      setSelectedLaunchId(launched[0]?.id || "");
    }
    return launched;
  }

  function selectTab(tab: StudioTab) {
    if (tab !== "create") {
      refreshLaunchedProjects();
    }
    if (tab === "curve") {
      setCurvePlans(readCurvePlans());
      setCurveNotice("Planning only — no bonding-curve contract or transaction is connected yet.");
    }
    setActiveTab(tab);
  }

  function openWorkspace(action: Exclude<PendingAction, null>) {
    seedHoodlumsLaunch();
    setActiveTab("create");
    setPendingAction(action);
    setIsOpen(true);
  }

  function openSavedLaunches() {
    seedHoodlumsLaunch();
    setActiveTab("create");
    if (!isOpen) {
      openWorkspace("saved");
      return;
    }

    findStudioButton("projects")?.click();
  }

  function saveAndClose() {
    const saveButton = findStudioButton("save project");
    saveButton?.click();
    window.setTimeout(() => {
      setPendingAction(null);
      setIsOpen(false);
    }, 100);
  }

  function openCurveFor(projectId: string) {
    refreshLaunchedProjects();
    setSelectedLaunchId(projectId);
    setCurvePlans(readCurvePlans());
    setCurveNotice("Planning only — no bonding-curve contract or transaction is connected yet.");
    setActiveTab("curve");
  }

  function updateCurvePlan<K extends keyof BondingCurvePlan>(
    key: K,
    value: BondingCurvePlan[K],
  ) {
    if (!selectedLaunch) return;
    setCurvePlans((current) => ({
      ...current,
      [selectedLaunch.id]: {
        ...(current[selectedLaunch.id] || createDefaultCurvePlan(selectedLaunch.id)),
        [key]: value,
      },
    }));
  }

  function saveCurvePlan() {
    if (!selectedLaunch || !currentCurvePlan || !curvePlanValid) {
      setCurveNotice("Enter a valid allocation, graduation target and virtual liquidity amount.");
      return;
    }

    try {
      const savedPlan: BondingCurvePlan = {
        ...currentCurvePlan,
        projectId: selectedLaunch.id,
        updatedAt: new Date().toISOString(),
      };
      const nextPlans = { ...curvePlans, [selectedLaunch.id]: savedPlan };
      localStorage.setItem(CURVE_PLAN_STORAGE_KEY, JSON.stringify(nextPlans));
      setCurvePlans(nextPlans);
      setCurveNotice(`${selectedLaunch.name} testnet bonding-curve plan saved in this browser.`);
    } catch {
      setCurveNotice("The curve plan could not be saved. Check that browser storage is enabled.");
    }
  }

  return (
    <div className={styles.studioShell}>
      <nav className={styles.studioTabs} role="tablist" aria-label="Token studio sections">
        {STUDIO_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            id={`studio-tab-${tab.id}`}
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`studio-panel-${tab.id}`}
            className={activeTab === tab.id ? styles.activeTab : undefined}
            onClick={() => selectTab(tab.id)}
          >
            <strong>{tab.label}</strong>
            <span>{tab.description}</span>
          </button>
        ))}
      </nav>

      <div
        id="studio-panel-create"
        role="tabpanel"
        aria-labelledby="studio-tab-create"
        hidden={activeTab !== "create"}
      >
        {!isOpen ? (
          <section className={styles.closedWorkspace} aria-labelledby="start-launch-title">
            <div className={styles.copy}>
              <p className={styles.eyebrow}>BUILD. TEST. LAUNCH.</p>
              <h2 id="start-launch-title">Launch a meme token without the clutter.</h2>
              <p>
                Token setup and the basic Prepare Launch checks live together here. Everything
                remains testnet-only.
              </p>
            </div>

            <div className={styles.actions}>
              <button className={styles.primaryAction} onClick={() => openWorkspace("new")}>
                Create new token
              </button>
              <button className={styles.secondaryAction} onClick={openSavedLaunches}>
                Open saved launches
              </button>
            </div>
          </section>
        ) : (
          <div className={styles.openWorkspace}>
            <div className={styles.workspaceBar}>
              <div>
                <span className={styles.liveDot} />
                <span>PRIVATE TESTNET WORKSPACE</span>
              </div>
              <div className={styles.workspaceActions}>
                <button onClick={openSavedLaunches}>Saved projects</button>
                <button className={styles.closeButton} onClick={saveAndClose}>
                  Save & close
                </button>
              </div>
            </div>
            <div className={pendingAction ? styles.preparing : undefined}>
              <TokenStudio />
            </div>
          </div>
        )}
      </div>

      <section
        id="studio-panel-launched"
        role="tabpanel"
        aria-labelledby="studio-tab-launched"
        className={styles.managementPanel}
        hidden={activeTab !== "launched"}
      >
        <header className={styles.panelIntro}>
          <div>
            <p className={styles.eyebrow}>TESTNET TOKEN VAULT</p>
            <h2>Launched tokens</h2>
            <p>
              Only projects marked as launched with a recorded contract or mint address appear
              here.
            </p>
          </div>
          <span className={styles.countBadge}>{launchedProjects.length}</span>
        </header>

        {launchedProjects.length === 0 ? (
          <div className={styles.emptyPanel}>
            <strong>No launched testnet tokens yet.</strong>
            <button type="button" onClick={() => selectTab("create")}>
              Create a token
            </button>
          </div>
        ) : (
          <div className={styles.launchGrid}>
            {launchedProjects.map((project) => (
              <article className={styles.launchCard} key={project.id}>
                <div className={styles.launchCardHeading}>
                  <span className={styles.tokenMark}>
                    {(project.ticker || project.name || "T").slice(0, 1).toUpperCase()}
                  </span>
                  <div>
                    <strong>{project.name || "Untitled token"}</strong>
                    <span>${project.ticker || "TOKEN"}</span>
                  </div>
                  <em>LAUNCHED</em>
                </div>

                <dl className={styles.launchFacts}>
                  <div>
                    <dt>Network</dt>
                    <dd>{CHAIN_CONFIG[project.chain].label}</dd>
                  </div>
                  <div>
                    <dt>Total supply</dt>
                    <dd>{formatSupply(project.supply)}</dd>
                  </div>
                </dl>

                <div className={styles.addressRow}>
                  <span>Contract / mint</span>
                  <code title={project.contractAddress}>{shortAddress(project.contractAddress)}</code>
                </div>

                <div className={styles.cardActions}>
                  <a href={explorerUrl(project)} target="_blank" rel="noreferrer">
                    Open explorer ↗
                  </a>
                  <button type="button" onClick={() => openCurveFor(project.id)}>
                    Use in Bonding Curve
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section
        id="studio-panel-curve"
        role="tabpanel"
        aria-labelledby="studio-tab-curve"
        className={styles.managementPanel}
        hidden={activeTab !== "curve"}
      >
        <header className={styles.panelIntro}>
          <div>
            <p className={styles.eyebrow}>TESTNET CURVE PLANNER</p>
            <h2>Bonding curve</h2>
            <p>
              Select a launched token and prepare the curve inputs. Saving a plan cannot deploy a
              contract or send a wallet transaction.
            </p>
          </div>
          <span className={styles.testnetBadge}>TESTNET ONLY</span>
        </header>

        {selectedLaunch && currentCurvePlan ? (
          <div className={styles.curveLayout}>
            <aside className={styles.tokenSelector} aria-label="Choose launched token">
              <span>Launched token</span>
              {launchedProjects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  className={selectedLaunch.id === project.id ? styles.selectedToken : undefined}
                  onClick={() => setSelectedLaunchId(project.id)}
                >
                  <strong>{project.name || "Untitled"}</strong>
                  <small>${project.ticker || "TOKEN"} · {CHAIN_CONFIG[project.chain].shortLabel}</small>
                </button>
              ))}
            </aside>

            <div className={styles.curveEditor}>
              <div className={styles.selectedLaunchSummary}>
                <div>
                  <span>Planning curve for</span>
                  <strong>{selectedLaunch.name} · ${selectedLaunch.ticker}</strong>
                </div>
                <code>{shortAddress(selectedLaunch.contractAddress)}</code>
              </div>

              <div className={styles.curveFields}>
                <label>
                  <span>Curve model</span>
                  <select
                    value={currentCurvePlan.model}
                    onChange={(event) => updateCurvePlan("model", event.target.value as CurveModel)}
                  >
                    <option value="unselected">Choose later</option>
                    <option value="linear">Linear</option>
                    <option value="virtual-reserves">Virtual reserves</option>
                  </select>
                </label>

                <label>
                  <span>Supply allocated to curve</span>
                  <div className={styles.suffixedInput}>
                    <input
                      type="number"
                      min="0.01"
                      max="100"
                      step="0.01"
                      inputMode="decimal"
                      value={currentCurvePlan.allocationPercent}
                      onChange={(event) => updateCurvePlan("allocationPercent", event.target.value)}
                    />
                    <b>%</b>
                  </div>
                </label>

                <label>
                  <span>Graduation target</span>
                  <div className={styles.suffixedInput}>
                    <input
                      type="number"
                      min="0.000001"
                      step="any"
                      inputMode="decimal"
                      value={currentCurvePlan.graduationTarget}
                      onChange={(event) => updateCurvePlan("graduationTarget", event.target.value)}
                    />
                    <b>{selectedLaunch.chain === "solana" ? "SOL" : "ETH"}</b>
                  </div>
                </label>

                <label>
                  <span>Starting virtual liquidity</span>
                  <div className={styles.suffixedInput}>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      inputMode="decimal"
                      value={currentCurvePlan.virtualLiquidity}
                      onChange={(event) => updateCurvePlan("virtualLiquidity", event.target.value)}
                    />
                    <b>{selectedLaunch.chain === "solana" ? "SOL" : "ETH"}</b>
                  </div>
                </label>
              </div>

              <div className={styles.curveSummary}>
                <article>
                  <span>Total token supply</span>
                  <strong>{formatSupply(selectedLaunch.supply)}</strong>
                </article>
                <article>
                  <span>Tokens assigned to curve</span>
                  <strong>
                    {calculateCurveSupply(
                      selectedLaunch.supply,
                      currentCurvePlan.allocationPercent,
                    )}
                  </strong>
                </article>
                <article>
                  <span>Contract state</span>
                  <strong className={styles.notConnected}>NOT CONNECTED</strong>
                </article>
              </div>

              <p className={styles.curveNotice} role="status">{curveNotice}</p>

              <button
                type="button"
                className={styles.saveCurveButton}
                disabled={!curvePlanValid}
                onClick={saveCurvePlan}
              >
                Save testnet curve plan
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.emptyPanel}>
            <strong>Launch a testnet token before preparing a bonding curve.</strong>
            <button type="button" onClick={() => selectTab("create")}>
              Open Create Token
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
