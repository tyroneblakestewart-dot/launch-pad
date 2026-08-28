import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function source(file: string) {
  return readFile(path.join(ROOT, file), "utf8");
}

// Recovery path for a launch whose recordTokenLaunch step failed after a
// successful on-chain deploy (issue #425) — a "Record listing" retry button
// (fresh challenge every attempt) plus a "Record an existing launch"
// affordance for when the panel was closed before a retry happened.

describe("/testnet launch-record recovery (issue #425)", () => {
  it("imports the pipeline launch lookup helper", async () => {
    const launcher = await source("components/testnet-launcher.tsx");
    expect(launcher).toContain(
      'import {\n  LaunchLookupError,\n  resolvePipelineLaunchByTokenAddress,\n} from "@/lib/curve-launch-pipeline-lookup";',
    );
  });

  it("keeps enough client state from the deploy flow to retry without redoing any on-chain step", async () => {
    const launcher = await source("components/testnet-launcher.tsx");
    expect(launcher).toContain("const [pendingRecord, setPendingRecord] = useState<PendingRecord | null>(null);");
    expect(launcher).toContain("setPendingRecord(pending);");
    const pendingDeclareIndex = launcher.indexOf("const pending: PendingRecord = {");
    const writeContractLastIndex = launcher.lastIndexOf('functionName: "fundCurve"');
    expect(pendingDeclareIndex).toBeGreaterThan(writeContractLastIndex);
  });

  it("retries recordTokenLaunch on a fresh challenge, never reusing the expired one", async () => {
    const launcher = await source("components/testnet-launcher.tsx");
    const retryFnIndex = launcher.indexOf("async function retryRecordListing()");
    expect(retryFnIndex).toBeGreaterThan(-1);
    const retryBody = launcher.slice(retryFnIndex, launcher.indexOf("\n  }", retryFnIndex));
    expect(retryBody).toContain("await recordTokenLaunch(walletClient, account, pendingRecord);");
    // recordTokenLaunch itself always calls the challenge endpoint first —
    // retrying it is what guarantees a brand-new challenge each attempt.
    const recordFnIndex = launcher.indexOf("async function recordTokenLaunch(");
    const challengeCallIndex = launcher.indexOf('fetch("/api/token-launches/challenge"', recordFnIndex);
    expect(challengeCallIndex).toBeGreaterThan(recordFnIndex);
  });

  it("retryable multiple times: the retry button is only disabled while a retry is in flight, not once used", async () => {
    const launcher = await source("components/testnet-launcher.tsx");
    expect(launcher).toContain('<button onClick={retryRecordListing} disabled={recordRetryBusy}>');
  });

  it("states plainly what happened and what to do, without promising an automatic recovery ('yet')", async () => {
    const launcher = await source("components/testnet-launcher.tsx");
    expect(launcher).toContain(
      "Launched on-chain, but the homepage listing could not be recorded: {result.recordWarning}",
    );
    expect(launcher).toContain("Sign the listing request within 5 minutes. You can retry now.");
    expect(launcher).not.toContain("could not be recorded yet");
  });

  it("offers a 'Record an existing launch' affordance that looks up the launch from just a token address", async () => {
    const launcher = await source("components/testnet-launcher.tsx");
    expect(launcher).toContain("async function recordExistingLaunch()");
    expect(launcher).toContain(
      "const resolved = await resolvePipelineLaunchByTokenAddress(\n        publicClient,\n        pipelineAddress,\n        existingLaunchAddress,\n      );",
    );
    expect(launcher).toContain("await recordTokenLaunch(walletClient, account, resolved);");
    expect(launcher).toContain("Record an existing launch");
  });

  it("routes the existing-launch affordance through the same wallet-signed recordTokenLaunch flow, not a shortcut", async () => {
    const launcher = await source("components/testnet-launcher.tsx");
    const fnIndex = launcher.indexOf("async function recordExistingLaunch()");
    const fnEnd = launcher.indexOf("\n  }\n", fnIndex);
    const fnBody = launcher.slice(fnIndex, fnEnd);
    expect(fnBody).toContain("resolvePipelineLaunchByTokenAddress(");
    expect(fnBody).toContain("recordTokenLaunch(walletClient, account, resolved)");
    expect(fnBody).not.toContain("fetch(");
  });

  it("mirrors the 390px mobile breakpoint for the new retry and existing-launch controls (rule 7)", async () => {
    const css = await source("components/testnet-launcher.module.css");
    expect(css).toContain(".recordWarningBox {");
    expect(css).toContain(".existingLaunchRow {");
    const breakpointIndex = css.indexOf("@media (max-width: 500px)");
    expect(breakpointIndex).toBeGreaterThan(-1);
    const breakpointBlock = css.slice(breakpointIndex);
    expect(breakpointBlock).toContain(".existingLaunchRow { grid-template-columns: 1fr; }");
  });
});
