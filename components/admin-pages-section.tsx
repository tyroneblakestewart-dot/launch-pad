"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./admin-pages-section.module.css";

type ElementListing = {
  id: string;
  type: "heading" | "text" | "button_label" | "button_link" | "visibility";
  label: string;
  defaultValue: string;
  publishedValue: string;
  hasPublished: boolean;
  publishedAt: string | null;
  hasDraft: boolean;
  draftValue: string | null;
  draftUpdatedAt: string | null;
  displayValue: string;
};

type PageListing = {
  id: string;
  label: string;
  route: string;
  elements: ElementListing[];
};

type PagesResponse = { pages: PageListing[] };

async function readError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  return payload.error || fallback;
}

function formatTimestamp(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function elementKey(pageId: string, elementId: string): string {
  return `${pageId}::${elementId}`;
}

export function AdminPagesSection() {
  const [pages, setPages] = useState<PageListing[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedPageId, setExpandedPageId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadPages = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/pages", { cache: "no-store", credentials: "same-origin" });
      if (response.status === 401) {
        window.location.replace("/admin");
        return;
      }
      if (!response.ok) {
        throw new Error(await readError(response, "Page content could not be loaded."));
      }
      const payload = (await response.json()) as PagesResponse;
      setPages(payload.pages);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Page content could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void loadPages());
  }, [loadPages]);

  const pendingDraftCount = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const page of pages || []) {
      counts[page.id] = page.elements.filter((element) => element.hasDraft).length;
    }
    return counts;
  }, [pages]);

  function draftValueFor(element: ElementListing, pageId: string): string {
    const key = elementKey(pageId, element.id);
    return key in drafts ? drafts[key] : element.displayValue;
  }

  async function saveDraft(pageId: string, element: ElementListing): Promise<void> {
    const key = elementKey(pageId, element.id);
    setBusyKey(key);
    setActionError(null);
    try {
      const response = await fetch("/api/admin/pages", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId, elementId: element.id, value: draftValueFor(element, pageId) }),
      });
      if (!response.ok) throw new Error(await readError(response, "The draft could not be saved."));
      await loadPages();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The draft could not be saved.");
    } finally {
      setBusyKey(null);
    }
  }

  async function runAction(
    pageId: string,
    elementId: string | undefined,
    action: "publish" | "publish-all" | "discard" | "reset",
  ): Promise<void> {
    const key = elementId ? elementKey(pageId, elementId) : `${pageId}::__all__`;
    setBusyKey(key);
    setActionError(null);
    try {
      const response = await fetch("/api/admin/pages/actions", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId, elementId, action }),
      });
      if (!response.ok) throw new Error(await readError(response, "The action could not be completed."));
      if (elementId) {
        setDrafts((prev) => {
          const next = { ...prev };
          delete next[elementKey(pageId, elementId)];
          return next;
        });
      }
      await loadPages();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The action could not be completed.");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <section className={styles.panel}>
      <div className={styles.sectionHeader}>
        <div>
          <h2 className={styles.sectionTitle}>Pages</h2>
          <p className={styles.sectionIntro}>
            Edit copy, labels, links and section visibility for the registered public pages. Edits save as a draft
            first — nothing goes live until you publish it, and you can preview the real page with your draft
            applied before publishing.
          </p>
        </div>
        <button type="button" className={styles.refreshButton} onClick={() => void loadPages()} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {loadError ? (
        <p className={styles.error} role="alert">
          {loadError}
        </p>
      ) : null}
      {actionError ? (
        <p className={styles.error} role="alert">
          {actionError}
        </p>
      ) : null}

      {!pages && loading ? <p className={styles.empty}>Loading registered pages…</p> : null}
      {pages && pages.length === 0 ? <p className={styles.empty}>No pages are registered yet.</p> : null}

      <ul className={styles.pageList}>
        {(pages || []).map((page) => {
          const expanded = expandedPageId === page.id;
          const draftCount = pendingDraftCount[page.id] || 0;
          return (
            <li key={page.id} className={styles.pageItem}>
              <button
                type="button"
                className={styles.pageHeader}
                aria-expanded={expanded}
                onClick={() => setExpandedPageId(expanded ? null : page.id)}
              >
                <div>
                  <p className={styles.pageLabel}>{page.label}</p>
                  <p className={styles.pageRoute}>{page.route}</p>
                </div>
                <div className={styles.pageHeaderRight}>
                  {draftCount > 0 ? <span className={styles.badgeDraft}>{draftCount} draft{draftCount === 1 ? "" : "s"}</span> : null}
                  <span className={styles.disclosure}>{expanded ? "−" : "+"}</span>
                </div>
              </button>

              {expanded ? (
                <div className={styles.pageBody}>
                  <div className={styles.pageActions}>
                    <a
                      className={styles.previewLink}
                      href={`${page.route}?cms_preview=1`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Preview page ↗
                    </a>
                    <button
                      type="button"
                      className={styles.publishAllButton}
                      disabled={draftCount === 0 || busyKey === `${page.id}::__all__`}
                      onClick={() => void runAction(page.id, undefined, "publish-all")}
                    >
                      {busyKey === `${page.id}::__all__` ? "Publishing…" : `Publish all drafts (${draftCount})`}
                    </button>
                  </div>

                  <ul className={styles.elementList}>
                    {page.elements.map((element) => {
                      const key = elementKey(page.id, element.id);
                      const busy = busyKey === key;
                      const value = draftValueFor(element, page.id);
                      const atDefault = !element.hasDraft && element.displayValue === element.defaultValue;
                      return (
                        <li key={element.id} className={styles.elementItem}>
                          <div className={styles.elementTop}>
                            <p className={styles.elementLabel}>{element.label}</p>
                            {element.hasDraft ? (
                              <span className={styles.badgeDraft}>
                                Draft, unpublished{element.draftUpdatedAt ? ` · ${formatTimestamp(element.draftUpdatedAt)}` : ""}
                              </span>
                            ) : (
                              <span className={styles.badgeLive}>
                                {element.hasPublished ? "Live" : "Default"}
                              </span>
                            )}
                          </div>

                          {element.type === "visibility" ? (
                            <label className={styles.visibilityRow}>
                              <input
                                type="checkbox"
                                checked={value === "true"}
                                disabled={busy}
                                onChange={(event) =>
                                  setDrafts((prev) => ({ ...prev, [key]: event.target.checked ? "true" : "false" }))
                                }
                              />
                              <span>Visible on the public page</span>
                            </label>
                          ) : element.type === "text" ? (
                            <textarea
                              className={styles.textInput}
                              value={value}
                              disabled={busy}
                              maxLength={500}
                              onChange={(event) => setDrafts((prev) => ({ ...prev, [key]: event.target.value }))}
                            />
                          ) : (
                            <input
                              className={styles.textInput}
                              type="text"
                              value={value}
                              disabled={busy}
                              maxLength={element.type === "button_link" ? 300 : 120}
                              onChange={(event) => setDrafts((prev) => ({ ...prev, [key]: event.target.value }))}
                            />
                          )}

                          <p className={styles.elementDefault}>Default: {element.defaultValue}</p>

                          <div className={styles.elementActions}>
                            <button
                              type="button"
                              className={styles.saveButton}
                              disabled={busy}
                              onClick={() => void saveDraft(page.id, element)}
                            >
                              {busy ? "Saving…" : "Save draft"}
                            </button>
                            <button
                              type="button"
                              className={styles.publishButton}
                              disabled={busy || !element.hasDraft}
                              onClick={() => void runAction(page.id, element.id, "publish")}
                            >
                              Publish
                            </button>
                            <button
                              type="button"
                              className={styles.discardButton}
                              disabled={busy || !element.hasDraft}
                              onClick={() => void runAction(page.id, element.id, "discard")}
                            >
                              Discard draft
                            </button>
                            <button
                              type="button"
                              className={styles.resetButton}
                              disabled={busy || atDefault}
                              onClick={() => void runAction(page.id, element.id, "reset")}
                            >
                              Reset to default
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
