import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

// This repo's Vitest suite runs in a plain Node environment (no jsdom), so
// this interactive client component is covered by source-pattern
// assertions, matching tests/token-trades-hook-ui.test.ts's precedent.

const ROOT = process.cwd();

async function source(file: string): Promise<string> {
  return readFile(path.join(ROOT, file), "utf8");
}

describe("TokenLeftColumn trade error messages (issue #462)", () => {
  it("imports the shared trade-error helper instead of building its own status text", async () => {
    const component = await source("components/token-page/token-left-column.tsx");
    expect(component).toContain('import { describeTradeError, sanitiseTradeErrorForLogging } from "@/lib/trade-error-message";');
  });

  it("never builds the buy/sell submission-failure or on-chain-revert messages inline any more", async () => {
    const component = await source("components/token-page/token-left-column.tsx");
    expect(component).not.toContain("function describeTradeSubmissionFailure");
    expect(component).not.toContain("function describeRevertedTrade");
  });

  it("routes a thrown buy/sell submission failure through the helper, and logs the sanitised original for debugging", async () => {
    const component = await source("components/token-page/token-left-column.tsx");
    const submitStart = component.indexOf("async function submitTrade()");
    const submitEnd = component.indexOf("\n  }\n\n  const payTicker", submitStart);
    expect(submitStart).toBeGreaterThan(-1);
    const submitBody = component.slice(submitStart, submitEnd);
    expect(submitBody).toContain('console.error("Trade failed:", sanitiseTradeErrorForLogging(error));');
    expect(submitBody).toContain("setTradeError(describeTradeError(error));");
    expect(submitBody).not.toContain("setTradeError(error.message)");
    expect(submitBody).not.toContain("setTradeError(readError(error))");
  });

  it("routes a mined-but-reverted buy/sell receipt through the same helper instead of a bespoke hash-bearing message", async () => {
    const component = await source("components/token-page/token-left-column.tsx");
    expect(component).toContain('console.error("Trade reverted on-chain:", hash);');
    expect(component).toContain("setTradeError(describeTradeError(receipt));");
  });

  it("routes a thrown withdraw-fees failure through the helper, and logs the sanitised original for debugging", async () => {
    const component = await source("components/token-page/token-left-column.tsx");
    const withdrawStart = component.indexOf("async function withdrawCreatorFees()");
    const withdrawEnd = component.indexOf("\n  }\n\n  // Debounced live quote", withdrawStart);
    expect(withdrawStart).toBeGreaterThan(-1);
    const withdrawBody = component.slice(withdrawStart, withdrawEnd);
    expect(withdrawBody).toContain('console.error("Fee withdrawal failed:", sanitiseTradeErrorForLogging(error));');
    expect(withdrawBody).toContain("setFeeError(describeTradeError(error));");
    expect(withdrawBody).not.toContain("setFeeError(error.message)");
  });

  it("routes a mined-but-reverted withdraw-fees receipt through the same helper", async () => {
    const component = await source("components/token-page/token-left-column.tsx");
    expect(component).toContain('console.error("Fee withdrawal reverted on-chain:", hash);');
    expect(component).toContain("setFeeError(describeTradeError(receipt));");
  });

  it("never renders a raw error's own message/shortMessage/details into the trade or fee status text", async () => {
    const component = await source("components/token-page/token-left-column.tsx");
    expect(component).not.toMatch(/setTradeError\(\s*error\.(message|shortMessage|details)/);
    expect(component).not.toMatch(/setFeeError\(\s*error\.(message|shortMessage|details)/);
  });
});
