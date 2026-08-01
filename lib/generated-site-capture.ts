import { isCompleteGeneratedPageHtml } from "@/lib/generated-site-page";
import type { TokenProject } from "@/lib/types";

export type SiteGeneratedEventDetail = {
  fullPage?: boolean;
  html?: unknown;
};

/**
 * Applies a `launchpad:site-generated` event onto a TokenProject, capturing
 * the produced HTML as `generatedSiteHtml` so it survives save/reload
 * without ever needing a fresh (non-deterministic) AI call just to see it
 * again. Returns `project` unchanged when the event isn't a complete
 * full-page generation, so a partial or unrelated event can never blow away
 * an already-captured site.
 */
export function applyGeneratedSiteCapture(
  project: TokenProject,
  detail: SiteGeneratedEventDetail | null | undefined,
): TokenProject {
  if (!detail?.fullPage || typeof detail.html !== "string") return project;
  if (!isCompleteGeneratedPageHtml(detail.html)) return project;
  return {
    ...project,
    generatedSiteHtml: detail.html,
    generatedSiteVersion: (project.generatedSiteVersion || 0) + 1,
    updatedAt: new Date().toISOString(),
  };
}
