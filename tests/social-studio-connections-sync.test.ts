import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function source(...parts: string[]): Promise<string> {
  return readFile(path.join(ROOT, ...parts), "utf8");
}

describe("Queue connection state sync and resilience (issue #384)", () => {
  it("derives telegramConnection from `connections`, not separate state, so both readers can never diverge", async () => {
    const social = await source("components", "social-hub.tsx");

    // The old dedicated useState for telegramConnection is gone.
    expect(social).not.toContain(
      "const [telegramConnection, setTelegramConnection] = useState<TelegramConnectionState | null>(null);",
    );
    expect(social).not.toContain("setTelegramConnection(");

    expect(social).toContain("const telegramConnection = useMemo<TelegramConnectionState | null>(() => {");
    const derivedBlock = social.slice(
      social.indexOf("const telegramConnection = useMemo<TelegramConnectionState | null>"),
      social.indexOf("const telegramConnection = useMemo<TelegramConnectionState | null>") + 500,
    );
    expect(derivedBlock).toContain('connections.find((connection) => connection.platform === "telegram")');
    expect(derivedBlock).toContain("}, [connections]);");

    // The Queue's destination toggles already read myConnectedPlatforms, which is itself derived from `connections` —
    // confirming there is exactly one underlying list feeding both UI locations.
    expect(social).toContain("const myConnectedPlatforms = useMemo(() => connectedPlatforms(connections), [connections]);");
  });

  it("connect success updates `connections` directly from the returned payload, no extra fetch", async () => {
    const social = await source("components", "social-hub.tsx");

    const connectBlock = social.slice(
      social.indexOf("async function connectTelegramChannel"),
      social.indexOf("async function disconnectTelegramChannel"),
    );
    expect(connectBlock).toContain("setConnections((current) => [");
    expect(connectBlock).toContain('...current.filter((connection) => connection.platform !== "telegram"),');
    expect(connectBlock).toContain('{ platform: "telegram", ...payload.connection },');
    expect(connectBlock).toContain('setConnectionsStatus("loaded");');
  });

  it("disconnect success removes the telegram entry from `connections` directly, no extra fetch", async () => {
    const social = await source("components", "social-hub.tsx");

    const disconnectBlock = social.slice(
      social.indexOf("async function disconnectTelegramChannel"),
      social.indexOf("async function postTelegram"),
    );
    expect(disconnectBlock).toContain(
      'setConnections((current) => current.filter((connection) => connection.platform !== "telegram"));',
    );
  });

  it("loadConnections keeps the previous list and flips to an error status on failure instead of clearing to empty", async () => {
    const social = await source("components", "social-hub.tsx");

    expect(social).toContain('const [connectionsStatus, setConnectionsStatus] = useState<"loading" | "loaded" | "error">("loading");');
    expect(social).toContain("async function loadConnections() {");
    const loadBlock = social.slice(social.indexOf("async function loadConnections() {"), social.indexOf("async function loadConnections() {") + 900);
    expect(loadBlock).toContain('setConnections(Array.isArray(payload.connections) ? payload.connections : []);');
    expect(loadBlock).toContain('setConnectionsStatus("loaded");');
    expect(loadBlock).toContain("} catch {");
    expect(loadBlock).toContain('setConnectionsStatus("error");');
    // On failure, `connections` itself is left untouched — no setConnections([]) inside the catch block.
    const catchBlock = loadBlock.slice(loadBlock.indexOf("} catch {"));
    expect(catchBlock).not.toContain("setConnections(");
  });

  it("re-fetches connections on window/tab focus regardless of active tab, and again on Queue-tab activation", async () => {
    const social = await source("components", "social-hub.tsx");

    // A standalone focus/visibility healer for connections, independent of which tab is open.
    const healerIndex = social.indexOf("Heals a transient connections-fetch failure");
    expect(healerIndex).toBeGreaterThan(-1);
    const healerBlock = social.slice(healerIndex, healerIndex + 700);
    expect(healerBlock).toContain('window.addEventListener("focus", handleFocusOrVisible);');
    expect(healerBlock).toContain('document.addEventListener("visibilitychange", handleFocusOrVisible);');
    expect(healerBlock).toContain("void loadConnections();");

    // The existing Queue-tab-activation effect (mirrors auto-replenish's own pattern) now also refetches connections.
    const queueEffectIndex = social.indexOf('if (activeTab !== "queue") return;');
    expect(queueEffectIndex).toBeGreaterThan(-1);
    const queueEffectBlock = social.slice(queueEffectIndex, queueEffectIndex + 900);
    expect(queueEffectBlock).toContain("void loadConnections();");
    expect(queueEffectBlock).toContain("void loadScheduledPosts();");
  });

  it("the Queue's fallback message only renders after a successful empty fetch, and shows a retry state on failure instead", async () => {
    const social = await source("components", "social-hub.tsx");

    const fallbackIndex = social.indexOf("myConnectedPlatforms.length > 0 ? (");
    expect(fallbackIndex).toBeGreaterThan(-1);
    const block = social.slice(fallbackIndex, fallbackIndex + 3000);
    expect(block).toContain('connectionsStatus === "error" ? (');
    expect(block).toContain("Could not load your connections.");
    expect(block).toContain("onClick={() => void loadConnections()}");
    expect(block).toContain('connectionsStatus === "loading" ? (');
    expect(block).toContain("Checking your connections…");
    expect(block).toContain("Connect X or Telegram in Setup before approving a post.");

    // The plain "connect X or Telegram" fallback must be the last (default) branch, gated behind the error/loading checks above it.
    const errorIdx = block.indexOf('connectionsStatus === "error"');
    const loadingIdx = block.indexOf('connectionsStatus === "loading"');
    const fallbackTextIdx = block.indexOf("Connect X or Telegram in Setup before approving a post.");
    expect(errorIdx).toBeLessThan(fallbackTextIdx);
    expect(loadingIdx).toBeLessThan(fallbackTextIdx);
  });
});
