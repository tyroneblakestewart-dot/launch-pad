import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

describe("Token studio X/Telegram field logos", () => {
  it("renders the official X and Telegram icons inline, left of their inputs", async () => {
    const studio = await readFile(path.join(ROOT, "components", "token-studio.tsx"), "utf8");

    expect(studio).toContain(
      'import { TelegramIcon, XIcon } from "@/components/icons/social-icons"',
    );

    const xFieldIndex = studio.indexOf('<span className="field-label">X handle</span>');
    const telegramFieldIndex = studio.indexOf('<span className="field-label">Telegram</span>');
    expect(xFieldIndex).toBeGreaterThan(-1);
    expect(telegramFieldIndex).toBeGreaterThan(-1);

    const xFieldBlock = studio.slice(xFieldIndex, telegramFieldIndex);
    expect(xFieldBlock).toContain('<div className="social-input">');
    expect(xFieldBlock).toContain("<XIcon");
    expect(xFieldBlock.indexOf("<XIcon")).toBeLessThan(xFieldBlock.indexOf("<input"));

    const telegramFieldBlock = studio.slice(telegramFieldIndex, telegramFieldIndex + 400);
    expect(telegramFieldBlock).toContain('<div className="social-input">');
    expect(telegramFieldBlock).toContain("<TelegramIcon");
    expect(telegramFieldBlock.indexOf("<TelegramIcon")).toBeLessThan(telegramFieldBlock.indexOf("<input"));
  });
});
