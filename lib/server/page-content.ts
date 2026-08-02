import { cookies } from "next/headers";
import {
  findPageDefinition,
  pageContentDefaults,
  type PageContentPageDefinition,
} from "@/lib/page-content-registry";
import { recordAdminActivityBestEffort } from "@/lib/server/admin-operations-store";
import { ADMIN_SESSION_COOKIE } from "@/lib/server/admin-auth";
import { isAdminSessionTokenValid } from "@/lib/server/admin-session-store";
import {
  getPageContentStore,
  type PageContentEntry,
  type PublishResult,
} from "@/lib/server/page-content-store";

export const CMS_PREVIEW_QUERY_PARAM = "cms_preview";

function mergeDefaults(
  page: PageContentPageDefinition,
  entries: PageContentEntry[],
  pick: (entry: PageContentEntry) => { has: boolean; value: string },
): Record<string, string> {
  const byElement = new Map(entries.map((entry) => [entry.elementId, entry]));
  const result: Record<string, string> = {};
  for (const element of page.elements) {
    const entry = byElement.get(element.id);
    if (!entry) {
      result[element.id] = element.defaultValue;
      continue;
    }
    const { has, value } = pick(entry);
    result[element.id] = has ? value : element.defaultValue;
  }
  return result;
}

/**
 * Live public read path. Falls back to the page's hardcoded defaults
 * whenever the registry entry is missing, unpublished, or the store itself
 * is unreachable — content editing must never be able to take a page down.
 */
export async function getPublishedPageContent(pageId: string): Promise<Record<string, string>> {
  const page = findPageDefinition(pageId);
  if (!page) return {};
  try {
    const entries = await getPageContentStore().listPage(pageId);
    return mergeDefaults(page, entries, (entry) => ({ has: entry.hasPublished, value: entry.publishedValue }));
  } catch {
    return pageContentDefaults(pageId);
  }
}

/**
 * Preview read path: staged drafts override published values, which
 * override defaults. Only ever called after `isAdminPreviewRequest` has
 * confirmed a durable admin session, and still falls back to defaults if the
 * store is unreachable so a broken preview never 500s.
 */
export async function getPreviewPageContent(pageId: string): Promise<Record<string, string>> {
  const page = findPageDefinition(pageId);
  if (!page) return {};
  try {
    const entries = await getPageContentStore().listPage(pageId);
    return mergeDefaults(page, entries, (entry) =>
      entry.hasDraft
        ? { has: true, value: entry.draftValue }
        : { has: entry.hasPublished, value: entry.publishedValue },
    );
  } catch {
    return pageContentDefaults(pageId);
  }
}

/**
 * Resolves which content a page render should use: draft-merged preview
 * content when `?cms_preview=1` is present and the request carries a valid,
 * durable admin session cookie — published content (with default fallback)
 * otherwise. Never previewable by the public: without a live admin session
 * the preview flag is ignored.
 */
export async function resolvePageContent(
  pageId: string,
  previewFlag: string | string[] | undefined,
): Promise<{ content: Record<string, string>; isPreview: boolean }> {
  const wantsPreview = previewFlag === "1" || (Array.isArray(previewFlag) && previewFlag.includes("1"));
  if (wantsPreview) {
    const token = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;
    if (await isAdminSessionTokenValid(token)) {
      return { content: await getPreviewPageContent(pageId), isPreview: true };
    }
  }
  return { content: await getPublishedPageContent(pageId), isPreview: false };
}

function describeChange(before: string, after: string): string {
  const truncate = (value: string) => (value.length > 60 ? `${value.slice(0, 57)}...` : value);
  return `"${truncate(before)}" → "${truncate(after)}"`;
}

async function logPublish(pageId: string, elementLabel: string, actor: string, result: PublishResult): Promise<void> {
  const page = findPageDefinition(pageId);
  const defaultValue = page?.elements.find((element) => element.id === result.entry.elementId)?.defaultValue ?? "";
  const before = result.hadPublishedBefore ? result.previousPublishedValue : defaultValue;
  await recordAdminActivityBestEffort({
    kind: "page-content-published",
    message: `${page?.label ?? pageId} · ${elementLabel} published by ${actor}: ${describeChange(before, result.entry.publishedValue)}`,
  });
}

/** Publishes one element's pending draft and records the change in the activity log. */
export async function publishPageElement(input: {
  pageId: string;
  elementId: string;
  elementLabel: string;
  actor: string;
}): Promise<PublishResult> {
  const result = await getPageContentStore().publish({
    pageId: input.pageId,
    elementId: input.elementId,
    actor: input.actor,
  });
  await logPublish(input.pageId, input.elementLabel, input.actor, result);
  return result;
}

/** Publishes every pending draft on a page and records each change in the activity log. */
export async function publishAllPageDrafts(input: {
  pageId: string;
  actor: string;
}): Promise<PublishResult[]> {
  const page = findPageDefinition(input.pageId);
  const results = await getPageContentStore().publishAllDrafts({ pageId: input.pageId, actor: input.actor });
  for (const result of results) {
    const label = page?.elements.find((element) => element.id === result.entry.elementId)?.label ?? result.entry.elementId;
    await logPublish(input.pageId, label, input.actor, result);
  }
  return results;
}
