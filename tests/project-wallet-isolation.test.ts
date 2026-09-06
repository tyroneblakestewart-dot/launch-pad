import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_WALLET_STORAGE_KEY } from "@/lib/account-wallet-state";
import { deleteProjectFromStorage, saveProjectToStorage } from "@/lib/token-project-persistence";
import {
  TOKEN_STUDIO_PROJECTS_STORAGE_KEY,
  currentProjectOwner,
  moveUnassignedProjects,
  parseSavedTokenProjects,
  projectIndexStorageKey,
  projectOwnerFromStoredWallet,
  readProjectIndex,
  readUnassignedProjectIndex,
  writeProjectIndex,
  type SavedProjectIndexEntry,
} from "@/lib/token-project-storage";
import type { TokenProject } from "@/lib/types";
import { createFakeIndexedDB, type FakeIndexedDBFactory } from "./fake-indexeddb-test-helper";
import { createFakeLocalStorage, type FakeLocalStorage } from "./fake-local-storage-test-helper";

// Per-wallet project scoping (owner direction, 6 Sep 2026: "every new wallet
// has to have its own clean slate"). Saved projects live in one localStorage
// partition per confirmed wallet; a wallet only ever reads its own; drafts
// saved with no wallet stay in an unassigned bucket until an explicit move.

const ROOT = process.cwd();
const WALLET_A = "0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa";
const WALLET_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

async function source(...parts: string[]) {
  return readFile(path.join(ROOT, ...parts), "utf8");
}

function entry(id: string, name = id): SavedProjectIndexEntry {
  return {
    id,
    createdAt: "2026-09-06T10:00:00.000Z",
    updatedAt: "2026-09-06T10:00:00.000Z",
    status: "draft",
    chain: "robinhood",
    name,
    ticker: id.toUpperCase().slice(0, 5),
    description: "",
    supply: "1000000000",
    decimals: 18,
    websiteSlug: id,
    contractAddress: "",
    xHandle: "",
    telegram: "",
    theme: "hoodlums",
  };
}

function confirmWallet(storage: FakeLocalStorage, account: string | null) {
  if (account) storage.setItem(ACCOUNT_WALLET_STORAGE_KEY, JSON.stringify({ walletName: "MetaMask", account }));
  else storage.removeItem(ACCOUNT_WALLET_STORAGE_KEY);
}

let storage: FakeLocalStorage;
let fakeIndexedDB: FakeIndexedDBFactory;

beforeEach(() => {
  storage = createFakeLocalStorage();
  fakeIndexedDB = createFakeIndexedDB();
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("indexedDB", fakeIndexedDB);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("owner and partition key", () => {
  it("derives the owner from the confirmed wallet, lower-cased, or null when none is confirmed", () => {
    expect(projectOwnerFromStoredWallet(null)).toBeNull();
    expect(projectOwnerFromStoredWallet("not json")).toBeNull();
    expect(projectOwnerFromStoredWallet(JSON.stringify({ walletName: "MetaMask", account: WALLET_A }))).toBe(WALLET_A.toLowerCase());
    expect(projectOwnerFromStoredWallet(JSON.stringify({ walletName: "MetaMask", account: "  " }))).toBeNull();
    expect(currentProjectOwner()).toBeNull();
    confirmWallet(storage, WALLET_A);
    expect(currentProjectOwner()).toBe(WALLET_A.toLowerCase());
  });

  it("keeps the pre-scoping key as the no-wallet bucket and gives every wallet its own key, case-insensitively", () => {
    expect(projectIndexStorageKey(null)).toBe(TOKEN_STUDIO_PROJECTS_STORAGE_KEY);
    expect(projectIndexStorageKey("")).toBe(TOKEN_STUDIO_PROJECTS_STORAGE_KEY);
    expect(projectIndexStorageKey(WALLET_A)).toBe(`${TOKEN_STUDIO_PROJECTS_STORAGE_KEY}:${WALLET_A.toLowerCase()}`);
    expect(projectIndexStorageKey(WALLET_A)).toBe(projectIndexStorageKey(WALLET_A.toLowerCase()));
    expect(projectIndexStorageKey(WALLET_A)).not.toBe(projectIndexStorageKey(WALLET_B));
  });

  it("never throws when localStorage is unavailable", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(currentProjectOwner()).toBeNull();
    expect(readProjectIndex()).toEqual([]);
  });
});

describe("readProjectIndex / writeProjectIndex", () => {
  it("reads and writes one owner's partition only — a wallet never sees another wallet's or the unassigned drafts", () => {
    writeProjectIndex([entry("legacy")], null);
    writeProjectIndex([entry("a1"), entry("a2")], WALLET_A);
    writeProjectIndex([entry("b1")], WALLET_B);

    expect(readProjectIndex(null).map((item) => item.id)).toEqual(["legacy"]);
    expect(readProjectIndex(WALLET_A).map((item) => item.id)).toEqual(["a1", "a2"]);
    expect(readProjectIndex(WALLET_A.toLowerCase()).map((item) => item.id)).toEqual(["a1", "a2"]);
    expect(readProjectIndex(WALLET_B).map((item) => item.id)).toEqual(["b1"]);
    expect(readUnassignedProjectIndex().map((item) => item.id)).toEqual(["legacy"]);
  });

  it("follows the confirmed wallet when no owner is passed", () => {
    writeProjectIndex([entry("legacy")], null);
    writeProjectIndex([entry("a1")], WALLET_A);

    expect(readProjectIndex().map((item) => item.id)).toEqual(["legacy"]);
    confirmWallet(storage, WALLET_A);
    expect(readProjectIndex().map((item) => item.id)).toEqual(["a1"]);
    writeProjectIndex([entry("a1"), entry("a3")]);
    expect(readProjectIndex(WALLET_A).map((item) => item.id)).toEqual(["a1", "a3"]);
    expect(readProjectIndex(null).map((item) => item.id)).toEqual(["legacy"]);

    confirmWallet(storage, WALLET_B);
    expect(readProjectIndex()).toEqual([]);
  });

  it("stores the wallet partition under its own key and leaves the legacy key untouched", () => {
    storage.setItem(TOKEN_STUDIO_PROJECTS_STORAGE_KEY, JSON.stringify([entry("legacy")]));
    confirmWallet(storage, WALLET_A);
    writeProjectIndex([entry("a1")]);
    expect(parseSavedTokenProjects(storage.getItem(TOKEN_STUDIO_PROJECTS_STORAGE_KEY)).map((item) => item.id)).toEqual(["legacy"]);
    expect(parseSavedTokenProjects(storage.getItem(`${TOKEN_STUDIO_PROJECTS_STORAGE_KEY}:${WALLET_A.toLowerCase()}`)).map((item) => item.id)).toEqual(["a1"]);
  });
});

describe("moveUnassignedProjects", () => {
  it("moves every unassigned draft into the wallet's partition, moved first, and empties the bucket", () => {
    writeProjectIndex([entry("u1"), entry("u2")], null);
    writeProjectIndex([entry("a1")], WALLET_A);

    const result = moveUnassignedProjects(WALLET_A);
    expect(result.moved).toBe(2);
    expect(result.index.map((item) => item.id)).toEqual(["u1", "u2", "a1"]);
    expect(readProjectIndex(WALLET_A).map((item) => item.id)).toEqual(["u1", "u2", "a1"]);
    expect(readUnassignedProjectIndex()).toEqual([]);
    expect(readProjectIndex(WALLET_B)).toEqual([]);
  });

  it("moves only the requested ids, ignores unknown ids, and replaces a same-id entry already in the wallet", () => {
    writeProjectIndex([entry("u1", "Unassigned one"), entry("u2")], null);
    writeProjectIndex([entry("u1", "Stale copy"), entry("a1")], WALLET_A);

    const result = moveUnassignedProjects(WALLET_A, ["u1", "nope"]);
    expect(result.moved).toBe(1);
    expect(readProjectIndex(WALLET_A).map((item) => [item.id, item.name])).toEqual([["u1", "Unassigned one"], ["a1", "a1"]]);
    expect(readUnassignedProjectIndex().map((item) => item.id)).toEqual(["u2"]);
  });

  it("is a no-op with nothing to move, refuses an empty owner, and never touches another wallet's partition", () => {
    writeProjectIndex([entry("b1")], WALLET_B);
    expect(moveUnassignedProjects(WALLET_A)).toEqual({ moved: 0, index: [] });
    expect(() => moveUnassignedProjects("  ")).toThrow();
    expect(readProjectIndex(WALLET_B).map((item) => item.id)).toEqual(["b1"]);
  });

  it("keeps the draft in the unassigned bucket when the wallet partition write fails", () => {
    writeProjectIndex([entry("u1")], null);
    storage.failNextSetItemWith = new Error("QuotaExceededError");
    expect(() => moveUnassignedProjects(WALLET_A)).toThrow("QuotaExceededError");
    expect(readUnassignedProjectIndex().map((item) => item.id)).toEqual(["u1"]);
    expect(readProjectIndex(WALLET_A)).toEqual([]);
  });
});

describe("persistence writes land in the owner's partition", () => {
  function project(id: string): TokenProject {
    return { ...entry(id), heroImage: "", generatedSiteHtml: null };
  }

  it("saves and deletes inside the explicitly passed owner, not whichever wallet is confirmed at write time", async () => {
    confirmWallet(storage, WALLET_B);
    const saved = await saveProjectToStorage(project("a1"), [], WALLET_A);
    expect(saved.success).toBe(true);
    expect(readProjectIndex(WALLET_A).map((item) => item.id)).toEqual(["a1"]);
    expect(readProjectIndex(WALLET_B)).toEqual([]);
    expect(readUnassignedProjectIndex()).toEqual([]);

    const deleted = await deleteProjectFromStorage("a1", readProjectIndex(WALLET_A), WALLET_A);
    expect(deleted.success).toBe(true);
    expect(readProjectIndex(WALLET_A)).toEqual([]);
  });

  it("falls back to the confirmed wallet when no owner is passed, and to the unassigned bucket with none confirmed", async () => {
    await saveProjectToStorage(project("u1"), []);
    expect(readUnassignedProjectIndex().map((item) => item.id)).toEqual(["u1"]);
    confirmWallet(storage, WALLET_A);
    await saveProjectToStorage(project("a1"), []);
    expect(readProjectIndex(WALLET_A).map((item) => item.id)).toEqual(["a1"]);
    expect(readUnassignedProjectIndex().map((item) => item.id)).toEqual(["u1"]);
  });
});

describe("every project reader goes through the partition-aware accessor", () => {
  const READERS = [
    ["components", "token-studio.tsx"],
    ["components", "token-studio-workspace.tsx"],
    ["components", "studio-provider-transfer.tsx"],
    ["components", "robinhood-testnet-deployment-controller.tsx"],
    ["components", "provider-launcher.tsx"],
    ["components", "social-hub.tsx"],
    ["components", "token-allocation-desk.tsx"],
  ];

  it("no component or route names the raw storage key or reads it from localStorage directly", async () => {
    const { readdir } = await import("node:fs/promises");
    async function walk(dir: string): Promise<string[]> {
      const items = await readdir(dir, { withFileTypes: true });
      const files: string[] = [];
      for (const item of items) {
        const full = path.join(dir, item.name);
        if (item.isDirectory()) files.push(...(await walk(full)));
        else if (/\.(ts|tsx)$/.test(item.name)) files.push(full);
      }
      return files;
    }
    const files = [...(await walk(path.join(ROOT, "components"))), ...(await walk(path.join(ROOT, "app")))];
    for (const file of files) {
      const text = await readFile(file, "utf8");
      expect(text, `${path.relative(ROOT, file)} names the raw project storage key`).not.toContain("private-meme-token-studio-projects-v1");
      expect(text, `${path.relative(ROOT, file)} reads the project index directly`).not.toContain("localStorage.getItem(TOKEN_STUDIO_PROJECTS_STORAGE_KEY)");
      expect(text, `${path.relative(ROOT, file)} writes the project index directly`).not.toContain("localStorage.setItem(TOKEN_STUDIO_PROJECTS_STORAGE_KEY");
    }
  });

  it("each reader imports readProjectIndex from the storage module", async () => {
    for (const parts of READERS) {
      const text = await source(...parts);
      expect(text, parts.join("/")).toContain("readProjectIndex");
      expect(text, parts.join("/")).toContain('from "@/lib/token-project-storage"');
    }
  });

  it("the pages that list projects reload the list when the confirmed wallet changes", async () => {
    for (const file of ["provider-launcher.tsx", "social-hub.tsx", "token-allocation-desk.tsx"]) {
      const text = await source("components", file);
      expect(text, file).toContain('import { useProjectOwner } from "@/lib/use-project-owner"');
      expect(text, file).toContain("readProjectIndex(projectOwner)");
      expect(text, file).toContain("}, [projectOwner]);");
    }
  });
});

describe("useProjectOwner", () => {
  it("is a useSyncExternalStore over the wallet-change and cross-tab storage events, with a null server snapshot", async () => {
    const hook = await source("lib", "use-project-owner.ts");
    expect(hook).toContain("useSyncExternalStore(subscribe, currentProjectOwner, getServerSnapshot)");
    expect(hook).toContain("window.addEventListener(ACCOUNT_WALLET_CHANGE_EVENT, onChange)");
    expect(hook).toContain('window.addEventListener("storage", onChange)');
    expect(hook).toContain("window.removeEventListener(ACCOUNT_WALLET_CHANGE_EVENT, onChange)");
    expect(hook).toContain("return null;");
  });
});

describe("the studio's wallet-switch contract", () => {
  it("keeps `projects` bound to `owner`, and saves/deletes into that owner explicitly", async () => {
    const studio = await source("components", "token-studio.tsx");
    expect(studio).toContain("const owner = useProjectOwner();");
    expect(studio).toContain("await loadOwnerProjectIndex(owner)");
    expect(studio).toContain("saveProjectToStorage(saved, projects, owner)");
    expect(studio).toContain("deleteProjectFromStorage(id, projects, owner)");
    expect(studio).toContain("}, [owner]);");
  });

  it("closes an open project that belongs to another wallet, and moves only an open no-wallet draft to the newly confirmed wallet", async () => {
    const studio = await source("components", "token-studio.tsx");
    const block = studio.slice(studio.indexOf("function applyWalletSwitch()"), studio.indexOf("async function loadIndex()"));
    expect(block).toContain("if (previous === undefined || previous === owner) return;");
    expect(block).toContain("readProjectIndex(previous).some((entry) => entry.id === open.id)");
    expect(block).toContain("if (previous === null && owner) {");
    expect(block).toContain("moveUnassignedProjects(owner, [open.id]);");
    expect(block).toContain("setProject(makeProject());");
    expect(block).toContain("stays with ${truncateAccountAddress(previous ?? \"\")} and was closed.");
  });

  it("offers a one-tap, explicit move for unassigned drafts and labels whose vault is open", async () => {
    const studio = await source("components", "token-studio.tsx");
    expect(studio).toContain("owner && unassignedCount > 0 ? (");
    expect(studio).toContain('<button type="button" onClick={moveUnassignedIntoWallet}>Move to this wallet</button>');
    expect(studio).toContain("const { moved } = moveUnassignedProjects(owner);");
    expect(studio).toContain("Wallet ${truncateAccountAddress(owner)} · only this wallet sees these");
    expect(studio).toContain('"No saved projects for this wallet yet."');
    // No silent adoption anywhere: the only unconditional (all-drafts) move is the tap handler.
    expect(studio.match(/moveUnassignedProjects\(owner\)/g)?.length).toBe(1);
    const css = await source("app", "globals.css");
    expect(css).toContain(".vault-unassigned");
    expect(css).toMatch(/@media \(max-width: 640px\) \{\s*\.vault-unassigned \{ flex-direction: column;[\s\S]*?\.vault-unassigned button \{ min-height: 44px; \}/);
  });

  it("the workspace's Saved launches button and the launch controller read the confirmed wallet's partition", async () => {
    const workspace = await source("components", "token-studio-workspace.tsx");
    const block = workspace.slice(workspace.indexOf("function openSavedLaunches"), workspace.indexOf("function saveAndClose"));
    expect(block).toContain("const savedLaunches = readProjectIndex();");
    // A wallet with no projects of its own must still reach the vault when unassigned drafts exist — that is where "Move to this wallet" lives.
    expect(block).toContain("const hasUnassignedToOffer = currentProjectOwner() !== null && readUnassignedProjectIndex().length > 0;");
    expect(block).toContain("if (savedLaunches.length === 0 && !hasUnassignedToOffer) {");
    const controller = await source("components", "robinhood-testnet-deployment-controller.tsx");
    expect(controller).toContain("const projects = readProjectIndex() as TokenProject[];");
    expect(controller).toContain("writeProjectIndex([");
    expect(controller).not.toContain("const STORAGE_KEY");
  });
});
