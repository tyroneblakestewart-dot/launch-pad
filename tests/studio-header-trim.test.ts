import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Owner direction (4 Sep 2026): the studio's header band — the H mark,
// "PRIVATE BUILD / Meme Token Studio", the Safe mode badge, the visible
// Projects and + New token buttons — and the workspace bar's "PRIVATE
// WORKSPACE OPEN" label are removed, along with the stale "Safe mode"
// notice wording (the studio launches to testnet for real now). The two
// header actions must survive as hidden buttons because the workspace shell
// drives them by button label.

const ROOT = process.cwd();

async function source(file: string): Promise<string> {
  return readFile(path.join(ROOT, file), "utf8");
}

describe("studio header trim", () => {
  it("renders no header band, brand mark, title or safe-mode badge", async () => {
    const studio = await source("components/token-studio.tsx");
    expect(studio).not.toContain('<header className="topbar"');
    expect(studio).not.toContain('className="brand-mark"');
    expect(studio).not.toContain("<h1>Meme Token Studio</h1>");
    expect(studio).not.toContain('<p className="eyebrow">PRIVATE BUILD</p>');
    expect(studio).not.toContain('className="safe-badge"');
  });

  it("keeps Projects and + New token as hidden buttons so the workspace shell can still click them by label", async () => {
    const studio = await source("components/token-studio.tsx");
    expect(studio).toContain('<button type="button" hidden onClick={() => setShowProjects(true)}>\n        Projects\n      </button>');
    expect(studio).toContain('<button type="button" hidden onClick={startNewProject}>\n        + New token\n      </button>');
    // The driver contract those labels satisfy (tests/create-token-flow.test.ts pins the same line).
    const workspace = await source("components/token-studio-workspace.tsx");
    expect(workspace).toContain('findStudioButton(action === "new" ? "new token" : "projects")');
  });

  it("starts with no notice and only renders the notice bar when there is a message", async () => {
    const studio = await source("components/token-studio.tsx");
    expect(studio).toContain('const [notice, setNotice] = useState("");');
    expect(studio).toContain("{notice && (\n        <section className=\"notice-bar\">");
    expect(studio).not.toContain("Safe mode is on");
  });

  it("drops the stale 'Safe mode still prevents…' wording from the wallet-connected notices", async () => {
    const studio = await source("components/token-studio.tsx");
    expect(studio).toContain('setNotice("Robinhood Chain wallet connected.");');
    expect(studio).toContain('setNotice("Solana wallet connected.");');
    expect(studio).not.toContain("Safe mode still prevents");
    // The launch summary's mainnet row is a true statement (testnet-first) and is deliberately kept.
    expect(studio).toContain("BLOCKED IN SAFE MODE");
  });

  it("removes the PRIVATE WORKSPACE OPEN label and live dot from the workspace bar, keeping both actions", async () => {
    const workspace = await source("components/token-studio-workspace.tsx");
    const css = await source("components/token-studio-workspace.module.css");
    expect(workspace).not.toContain("PRIVATE WORKSPACE OPEN");
    expect(workspace).not.toContain("styles.liveDot");
    expect(workspace).toContain("<button onClick={openSavedLaunches}>Saved launches</button>");
    expect(workspace).toContain("Save & close");
    expect(css).not.toContain(".liveDot {");
    expect(css).toContain(".workspaceBar > .workspaceActions {\n  margin-left: auto;\n}");
  });
});
