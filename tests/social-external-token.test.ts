import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildDraftRequestBody, MAX_PROJECT_NETWORK_LABEL_LENGTH, resolveChainLabel } from "@/lib/server/social-draft-pipeline";
import { isExternalProject, projectNetworkLabel } from "@/lib/token-project-storage";
import { bareTelegramHandle, bareXHandle } from "@/components/social-hub";

// Hoodlums Social for tokens launched anywhere (owner direction, 6 Sep 2026:
// "this sub should work with anyone that has a project they want Hoodlums to
// handle their socials for"). An "external" project is added from /social,
// saved into the confirmed wallet's own vault, shows only in Social Studio,
// and states its real network to the AI instead of a studio chain.

const ROOT = process.cwd();

async function source(...parts: string[]) {
  return readFile(path.join(ROOT, ...parts), "utf8");
}

const BASE_PROJECT = {
  name: "Test Coin",
  ticker: "TEST",
  description: "A community-driven meme token.",
  chain: "solana" as const,
  contractAddress: "",
};

describe("project helpers", () => {
  it("recognises an external project and never mistakes a studio project for one", () => {
    expect(isExternalProject({ origin: "external" })).toBe(true);
    expect(isExternalProject({})).toBe(false);
    expect(isExternalProject({ origin: null })).toBe(false);
    expect(isExternalProject({ origin: "studio" })).toBe(false);
  });

  it("labels the network from the token's own network name, else the studio chain", () => {
    expect(projectNetworkLabel({ chain: "robinhood" })).toBe("Robinhood Chain");
    expect(projectNetworkLabel({ chain: "solana" })).toBe("Solana");
    expect(projectNetworkLabel({ chain: "solana", network: " Ethereum " })).toBe("Ethereum");
    expect(projectNetworkLabel({ chain: "robinhood", network: "" })).toBe("Robinhood Chain");
  });
});

describe("draft pipeline states the token's real network", () => {
  it("resolveChainLabel prefers a supplied network name, normalised and bounded", () => {
    expect(resolveChainLabel("solana")).toBe("Solana");
    expect(resolveChainLabel("robinhood")).toBe("Robinhood Chain");
    expect(resolveChainLabel("solana", "PulseChain")).toBe("PulseChain");
    expect(resolveChainLabel("robinhood", "  Base   mainnet ")).toBe("Base mainnet");
    expect(resolveChainLabel("robinhood", "   ")).toBe("Robinhood Chain");
    expect(resolveChainLabel("solana", "x".repeat(200))).toHaveLength(MAX_PROJECT_NETWORK_LABEL_LENGTH);
  });

  it("puts the network name into the allowed-facts ledger in place of the studio chain", () => {
    const body = buildDraftRequestBody({ project: { ...BASE_PROJECT, network: "Ethereum" }, voiceProfile: null }, "gpt-5-mini");
    const developerText = body.input[0]?.content[0]?.text ?? "";
    expect(developerText).toContain("Chain: Ethereum");
    expect(developerText).not.toContain("Chain: Solana");

    const studio = buildDraftRequestBody({ project: BASE_PROJECT, voiceProfile: null }, "gpt-5-mini");
    expect(studio.input[0]?.content[0]?.text ?? "").toContain("Chain: Solana");
  });

  it("the draft route accepts, sanitises and screens the network field", async () => {
    const route = await source("app", "api", "social", "draft", "route.ts");
    expect(route).toContain("network?: unknown;");
    expect(route).toContain("MAX_PROJECT_NETWORK_LABEL_LENGTH");
    expect(route).toContain("...(network ? { network } : {}),");
    expect(route).toContain("network: project.network,");
    expect(route).toContain("resolveChainLabel(project.chain, project.network)");
  });
});

describe("TokenProject carries the external marker", () => {
  it("adds optional origin and network fields without touching existing ones", async () => {
    const types = await source("lib", "types.ts");
    expect(types).toContain('origin?: "external";');
    expect(types).toContain("network?: string;");
    expect(types).toContain('export type SupportedChain = "solana" | "robinhood";');
  });
});

describe("Social Studio: add an existing token", () => {
  it("offers the form from the empty state and from the project picker, keeping the studio link", async () => {
    const hub = await source("components", "social-hub.tsx");
    expect(hub).toContain("<h1>Pick the token Hoodlums Social should run.</h1>");
    expect(hub).toContain('<Link href="/">Return to launch studio</Link>');
    expect(hub).toContain('{addTokenOpen ? "Close" : "Add an existing token"}');
    expect(hub).toContain("{addTokenOpen ? renderAddTokenForm() : null}");
    expect(hub).toContain("{addTokenOpen ? <div className={styles.addTokenPanel}>{renderAddTokenForm()}</div> : null}");
    expect(hub).toContain("<b>Add an existing token</b>");
    // The premium-theme test pins `.noProject a`; the studio link stays an anchor.
    const css = await source("components", "social-hub.module.css");
    expect(css).toContain(".noProject a {");
    expect(css).toContain(".addTokenGrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));");
    expect(css).toMatch(/@media \(max-width: 860px\) \{\s*\.addTokenGrid \{ grid-template-columns: 1fr; \}/);
  });

  it("saves into the confirmed wallet's own vault, marked external, and refuses without a wallet", async () => {
    const hub = await source("components", "social-hub.tsx");
    const block = hub.slice(hub.indexOf("async function addExternalProject()"), hub.indexOf("function renderAddTokenForm()"));
    expect(block).toContain("if (!projectOwner) {");
    expect(block).toContain('origin: "external",');
    expect(block).toContain("await saveProjectToStorage(project, readProjectIndex(projectOwner), projectOwner)");
    expect(block).toContain("setProjects(safeProjects(readProjectIndex(projectOwner)));");
    expect(block).toContain("setSelectedProjectId(project.id);");
    // Validation: name, ticker shape, other-network name, Robinhood address, description.
    expect(block).toContain('message: "Give the token a name."');
    expect(block).toContain("/^[A-Z0-9]{1,12}$/.test(ticker)");
    expect(block).toContain('externalForm.networkChoice === "other" && !networkOther');
    expect(block).toContain('externalForm.networkChoice === "robinhood" && contractAddress && !isAddress(contractAddress)');
    expect(block).toContain('message: "Add a sentence about the token — the AI drafts from it."');
    // Nothing is sent anywhere: this is a browser-vault write only.
    expect(block).not.toContain("fetch(");
    expect(hub).toContain("disabled={externalSaving || !projectOwner}");
  });

  it("takes handles without prefixes and strips any the user pastes (owner direction: remove prefix handles)", async () => {
    expect(bareXHandle("@hoodlums")).toBe("hoodlums");
    expect(bareXHandle("hoodlums")).toBe("hoodlums");
    expect(bareXHandle("https://x.com/hoodlums")).toBe("hoodlums");
    expect(bareXHandle("https://twitter.com/Hoodlums?s=21")).toBe("Hoodlums");
    expect(bareXHandle("  ")).toBe("");
    expect(bareTelegramHandle("@hoodlums")).toBe("hoodlums");
    expect(bareTelegramHandle("t.me/hoodlums")).toBe("hoodlums");
    expect(bareTelegramHandle("https://t.me/hoodlums")).toBe("hoodlums");
    expect(bareTelegramHandle("hoodlums")).toBe("hoodlums");

    const hub = await source("components", "social-hub.tsx");
    expect(hub).toContain('<span>X handle <em>optional · no @</em></span>');
    expect(hub).toContain('<span>Telegram <em>optional · username only</em></span>');
    expect(hub).not.toContain('placeholder="@hoodlums"');
    expect(hub).not.toContain('placeholder="t.me/hoodlums"');
    const block = hub.slice(hub.indexOf("async function addExternalProject()"), hub.indexOf("function renderAddTokenForm()"));
    expect(block).toContain("const xHandle = bareXHandle(externalForm.xHandle);");
    expect(block).toContain("const telegram = bareTelegramHandle(externalForm.telegram);");
    // The stored bare values are what the existing post builders expect: cleanHandle adds "@", cleanTelegram adds "https://t.me/".
    expect(hub).toContain('return trimmed.startsWith("@") ? trimmed : `@${trimmed.replace(/^https?:\\/\\/x\\.com\\//i, "")}`;');
    expect(hub).toContain("return `https://t.me/${trimmed.replace(/^@/, \"\")}`;");
  });

  it("states the token's own network everywhere it names a chain, and sends it with AI drafts", async () => {
    const hub = await source("components", "social-hub.tsx");
    expect(hub).toContain("const chain = projectNetworkLabel(project);");
    expect(hub).toContain("<small>${project.ticker || \"TOKEN\"} · {projectNetworkLabel(project)}{isExternalProject(project) ? \" · added\" : \"\"}</small>");
    expect(hub).toContain("${projectTicker} · {selectedProject ? projectNetworkLabel(selectedProject) : \"\"}");
    expect(hub).toContain("network: selectedProject.network,");
    expect(hub).not.toContain('project.chain === "robinhood" ? "Robinhood Chain" : "Solana"');
  });

  it("keeps the Buy Bot and on-chain stats to Hoodlums launches only", async () => {
    const hub = await source("components", "social-hub.tsx");
    expect(hub).toContain("const isExternalSelected = Boolean(selectedProject && isExternalProject(selectedProject));");
    expect(hub).toContain('if (!contract || selectedProject?.chain !== "robinhood" || isExternalSelected) return null;');
    expect(hub).toContain('const buyBotTokenAddress = selectedProject?.chain === "robinhood" && !isExternalSelected ? selectedProject.contractAddress?.trim() || "" : "";');
    expect(hub).toContain('"This token was not launched on Hoodlums — the Buy Bot only watches Hoodlums curves."');
    expect(hub).toContain('if (selectedProject?.chain === "robinhood" && !isExternalSelected && selectedProject.contractAddress?.trim()) params.set("tokenAddress"');
  });

  it("loads the selected project's artwork from IndexedDB instead of the heroImage the index no longer carries (issue #307)", async () => {
    const hub = await source("components", "social-hub.tsx");
    expect(hub).toContain('import { getProjectBlob } from "@/lib/token-project-db";');
    expect(hub).toContain("getProjectBlob(selectedProject.id)");
    expect(hub).toContain('const projectArtwork = selectedProject ? selectedProjectArtwork : "";');
    expect(hub).toContain("artwork: includeArtwork ? attachedArtwork || projectArtwork : \"\",");
    expect(hub).toContain("disabled={!projectArtwork}");
    // The only remaining direct read is the legacy inline fallback inside the loader effect itself.
    expect(hub.match(/selectedProject\??\.heroImage/g)?.length).toBe(1);
    expect(hub).toContain('const inline = selectedProject.heroImage || "";');
  });
});

describe("external tokens never reach the launch tooling", () => {
  it("the studio vault lists launch projects only while keeping the full index as its write base", async () => {
    const studio = await source("components", "token-studio.tsx");
    expect(studio).toContain("const launchProjects = projects.filter((entry) => !isExternalProject(entry));");
    expect(studio).toContain("{launchProjects.length === 0 ? (");
    expect(studio).toContain("{launchProjects.map((saved) => (");
    expect(studio).toContain("saveProjectToStorage(saved, projects, owner)");
    expect(studio).toContain("deleteProjectFromStorage(id, projects, owner)");
  });

  it("the workspace, provider desks, allocation desk and launch modal all skip external projects", async () => {
    const workspace = await source("components", "token-studio-workspace.tsx");
    expect(workspace).toContain("const launchProjects = savedLaunches.filter((entry) => !isExternalProject(entry));");
    expect(workspace).toContain("if (launchProjects.length === 0 && !attachPending) {");

    const launcher = await source("components", "provider-launcher.tsx");
    expect(launcher.match(/item\.chain === "robinhood" && !isExternalProject\(item\)/g)?.length).toBe(2);

    const desk = await source("components", "token-allocation-desk.tsx");
    expect(desk).toContain('project.chain === "robinhood" && !isExternalProject(project) && isAddress(project.contractAddress)');

    const controller = await source("components", "robinhood-testnet-deployment-controller.tsx");
    expect(controller).toContain('projects.find((item) => item.chain === "robinhood" && !isExternalProject(item))');

    const transfer = await source("components", "studio-provider-transfer.tsx");
    expect(transfer).toContain("!isExternalProject(item) &&");
  });
});
