import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

describe("new project identity is never pre-filled with the Hoodlums brand", () => {
  it("gives a new project an empty name, ticker and website slug", async () => {
    const studio = await readFile(path.join(ROOT, "components", "token-studio.tsx"), "utf8");

    const defaultProjectBlock = studio.slice(
      studio.indexOf("const DEFAULT_PROJECT"),
      studio.indexOf("function getErrorMessage"),
    );

    expect(defaultProjectBlock).toContain('name: "",');
    expect(defaultProjectBlock).toContain('ticker: "",');
    expect(defaultProjectBlock).toContain('websiteSlug: "",');
    expect(defaultProjectBlock).toContain('description: "",');
    expect(defaultProjectBlock).not.toMatch(/name: "Hoodlums"/i);
    expect(defaultProjectBlock).not.toMatch(/ticker: "HOODLUMS"/i);
    expect(defaultProjectBlock).not.toMatch(/websiteSlug: "hoodlums"/i);

    expect(studio).toContain("function makeProject(): TokenProject {");
    const makeProjectBlock = studio.slice(
      studio.indexOf("function makeProject"),
      studio.indexOf("function shortAddress"),
    );
    expect(makeProjectBlock).not.toMatch(/hoodlums/i);
  });

  it("uses generic, non-token placeholders instead of real-sounding default values", async () => {
    const studio = await readFile(path.join(ROOT, "components", "token-studio.tsx"), "utf8");

    expect(studio).toContain('placeholder="Token name"');
    expect(studio).toContain('placeholder="TICKER"');
    expect(studio).not.toContain('placeholder="Hoodlums"');
    expect(studio).not.toContain('placeholder="HOOD"');
    expect(studio).not.toContain('placeholder="hoodlums"');
  });

  it("gives the token name input a stable id instead of relying on placeholder text", async () => {
    const studio = await readFile(path.join(ROOT, "components", "token-studio.tsx"), "utf8");
    const workspace = await readFile(
      path.join(ROOT, "components", "token-studio-workspace.tsx"),
      "utf8",
    );

    expect(studio).toContain('id="token-name-input"');
    expect(workspace).toContain('"#token-name-input"');
    expect(workspace).not.toMatch(/input\[placeholder=/);
  });

  it("never gates identity on a ticker === HOODLUMS comparison", async () => {
    const workspace = await readFile(
      path.join(ROOT, "components", "token-studio-workspace.tsx"),
      "utf8",
    );

    expect(workspace).not.toMatch(/ticker\.toUpperCase\(\)\s*===\s*"HOODLUMS"/);
    expect(workspace).not.toMatch(/ticker\s*===\s*"HOODLUMS"/);

    const isHoodlumsRecordBlock = workspace.slice(
      workspace.indexOf("function isHoodlumsRecord"),
      workspace.indexOf("function seedHoodlumsLaunch"),
    );
    expect(isHoodlumsRecordBlock).toContain("project.id === HOODLUMS_LAUNCH.id");
    expect(isHoodlumsRecordBlock).toContain(
      "project.contractAddress.toLowerCase() === HOODLUMS_CONTRACT",
    );
    expect(isHoodlumsRecordBlock).not.toContain("project.name.toLowerCase()");
  });

  it("still requires name, ticker, description and artwork before unlocking site generation", async () => {
    const gate = await readFile(path.join(ROOT, "components", "build-site-gate.tsx"), "utf8");

    expect(gate).toContain("detail.name.length >= 2");
    expect(gate).toContain("/^[A-Za-z0-9]{2,12}$/.test(detail.ticker)");
    expect(gate).toContain("detail.description.length >= REQUIRED_DESCRIPTION_LENGTH");
    expect(gate).toContain('Boolean(detail.imageDataUrl?.startsWith("data:image/"))');
    expect(gate).toContain("const ready = checks.every((item) => item.complete)");
  });
});
