export const SITE_GENERATION_TIMEOUT_MS = 65_000;

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
