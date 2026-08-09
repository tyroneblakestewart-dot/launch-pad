import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function source(...parts: string[]): Promise<string> {
  return readFile(path.join(ROOT, ...parts), "utf8");
}

describe("subscription success routing", () => {
  it("opens AI Social Studio after a verified Pro or Pro Bundle subscription", async () => {
    const checkout = await source("components", "plan-checkout.tsx");
    const socialPage = await source("app", "(app)", "social", "page.tsx");

    const successStart = checkout.indexOf('if (phase === "success" && verification)');
    const successEnd = checkout.indexOf("return (\n    <div className={styles.shell}>", successStart);
    const success = checkout.slice(successStart, successEnd);

    expect(successStart).toBeGreaterThan(-1);
    expect(success).toContain('window.location.assign("/social")');
    expect(success).toContain("Open AI Social Studio");
    expect(success).toContain("AI Social Studio unlocked");
    expect(success).not.toContain("onClick={onClose}");
    expect(socialPage).toContain("<SocialHub />");
  });

  it("keeps the pre-payment Back to plans action separate from successful navigation", async () => {
    const checkout = await source("components", "plan-checkout.tsx");

    expect(checkout).toContain("Back to plans");
    expect(checkout).toContain("onClick={onClose}");
  });
});
