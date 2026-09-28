export const SITE_GENERATION_TIMEOUT_MS = 65_000;
/**
 * The bespoke (gpt-5) page can legitimately take several minutes; the route
 * allows 800s. Before this, the gate declared "taking too long" at 65s while
 * the paid generation was still running (owner report, 11 Sep 2026).
 */
export const BESPOKE_SITE_GENERATION_TIMEOUT_MS = 800_000;

export function siteGenerationTimeoutMs(mode: "free" | "bespoke"): number {
  return mode === "bespoke" ? BESPOKE_SITE_GENERATION_TIMEOUT_MS : SITE_GENERATION_TIMEOUT_MS;
}

/**
 * Issue #422: the studio preview's failed-state panel offers "Try again".
 * Rather than re-running the request itself, it asks the Build 02 gate to
 * start a fresh generation of the same mode through this event, so the
 * gate's own state (its busy flag, timeout, hint and button locks) stays
 * the single source of truth for "a generation is running".
 */
export const SITE_GENERATION_RETRY_EVENT = "launchpad:site-generation-retry";

export type SiteGenerationRetryDetail = { mode: "free" | "bespoke" };

export type SitePreviewState = {
  unlocked: boolean;
  generating: boolean;
};

export function startSitePreviewGeneration(): SitePreviewState {
  return { unlocked: true, generating: true };
}

export function finishSitePreviewGeneration(): SitePreviewState {
  return { unlocked: true, generating: false };
}

export function failSitePreviewGeneration(previewWasUnlocked: boolean): SitePreviewState {
  return { unlocked: previewWasUnlocked, generating: false };
}

export function previewFailureMessage(message: string | undefined, previewIsVisible: boolean): string {
  const reason = message || "The AI enhancement could not be completed.";
  return previewIsVisible
    ? `Your website preview is shown below. ${reason}`
    : reason;
}

export function previewTimeoutMessage(hasInspiration: boolean): string {
  return hasInspiration
    ? "Your website preview is shown below. Inspiration analysis is taking too long; try Generate again or remove the URL."
    : "Your website preview is shown below. AI enhancement is taking too long, so the artwork-based version remains active.";
}
