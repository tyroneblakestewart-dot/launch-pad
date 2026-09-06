import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function source(...parts: string[]): Promise<string> {
  return readFile(path.join(ROOT, ...parts), "utf8");
}

function block(text: string, start: string, length: number): string {
  const index = text.indexOf(start);
  expect(index, `expected to find ${start}`).toBeGreaterThan(-1);
  return text.slice(index, index + length);
}

// Owner report, 6 Sep 2026: "this keeps regenerating posts" — the Queue tab
// showed 13 drafts waiting against a target of 5 and was still generating
// "draft 3 of 4". Every generation is a paid AI call, so this pins the fix.
describe("Ready-to-review replenish never runs from a stale or unloaded queue", () => {
  it("publishes the live queue, target, project and Queue-tab functions into refs on every render", async () => {
    const hub = await source("components", "social-hub.tsx");
    expect(hub).toContain("const queueRef = useRef<QueueItem[]>([]);");
    expect(hub).toContain("const queueTargetRef = useRef(DEFAULT_QUEUE_TARGET);");
    expect(hub).toContain("const selectedProjectIdRef = useRef<string | null>(null);");
    expect(hub).toContain("const queueTabActionsRef = useRef({");
    const publish = block(hub, "  useEffect(() => {\n    queueRef.current = queue;", 320);
    expect(publish).toContain("queueTargetRef.current = queueTarget;");
    expect(publish).toContain("selectedProjectIdRef.current = selectedProjectId;");
    expect(publish).toContain("queueTabActionsRef.current = { loadScheduledPosts, loadConnections, replenishQueue };");
    // No dependency array: it must run after every render, or the refs go stale again.
    expect(publish).toMatch(/replenishQueue };\n  }\);/);
  });

  it("the window-focus listener calls the latest functions through the ref, never the render it was created in", async () => {
    const hub = await source("components", "social-hub.tsx");
    const effect = block(hub, 'if (activeTab !== "queue") return;', 1600);
    const handler = block(effect, "function handleFocusOrVisible() {", 520);
    expect(handler).toContain("void queueTabActionsRef.current.loadScheduledPosts();");
    expect(handler).toContain("void queueTabActionsRef.current.loadConnections();");
    expect(handler).toContain("void queueTabActionsRef.current.replenishQueue();");
    expect(handler).not.toContain("void replenishQueue();");
    // Activation still calls the fresh closures directly (issue #384's pins), and the effect re-runs once the saved queue has loaded.
    expect(effect).toContain("void loadConnections();");
    expect(effect).toContain("void loadScheduledPosts();");
    expect(effect).toContain("}, [activeTab, selectedProjectId, walletAddress, loadedRecordProjectId]);");
  });

  it("nothing replenishes until the selected project's saved queue is actually in state", async () => {
    const hub = await source("components", "social-hub.tsx");
    expect(hub).toContain("const [loadedRecordProjectId, setLoadedRecordProjectId] = useState<string | null>(null);");
    const load = block(hub, "async function loadRecord() {", 2600);
    // Cleared the moment a (re)load starts, set only after setQueue(record.queue) in the same batch.
    expect(load).toMatch(/async function loadRecord\(\) \{\n      setLoadedRecordProjectId\(null\);/);
    expect(load.indexOf("setQueue(record.queue);")).toBeGreaterThan(-1);
    expect(load.indexOf("setLoadedRecordProjectId(selectedProjectId);")).toBeGreaterThan(load.indexOf("setQueue(record.queue);"));
    const replenish = block(hub, "async function replenishQueue() {", 1400);
    expect(replenish).toContain("if (loadedRecordProjectId !== selectedProjectId) return;");
  });

  it("the loop sizes itself from the live queue and re-checks before every paid request", async () => {
    const hub = await source("components", "social-hub.tsx");
    const replenish = block(hub, "async function replenishQueue() {", 1800);
    expect(replenish).toContain("const liveQueue = queueRef.current;");
    expect(replenish).toContain("const shortfall = replenishShortfall(liveQueue.length, queueTargetRef.current);");
    expect(replenish).not.toContain("replenishShortfall(queue.length, queueTarget)");
    expect(replenish).toContain("if (selectedProjectIdRef.current !== projectIdAtStart) break;");
    expect(replenish).toContain("if (queueRef.current.length >= queueTargetRef.current) break;");
    // The re-checks sit before the paid generateDraft call inside the loop.
    expect(replenish.indexOf("if (queueRef.current.length >= queueTargetRef.current) break;")).toBeLessThan(
      replenish.indexOf("const draft = await generateDraft({"),
    );
  });
});
