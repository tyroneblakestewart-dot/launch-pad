"use client";

import { useCallback, useEffect, useState } from "react";
import { buildErrorGroupDetailsText } from "@/lib/client-error-details-text";
import { copyToClipboard } from "@/lib/clipboard";
import styles from "./admin-client-errors-section.module.css";

type ClientErrorGroup = {
  message: string;
  routePath: string;
  occurrenceCount: number;
  firstSeen: string;
  lastSeen: string;
  distinctWallets: number;
  representativeStack: string | null;
  buildId: string | null;
};

type ClientErrorsSnapshot = {
  status: "ready" | "unavailable";
  message: string;
  groups: ClientErrorGroup[];
};

async function readError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  return payload.error || fallback;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function groupKey(group: ClientErrorGroup): string {
  return `${group.routePath}::${group.message}`;
}

export function AdminClientErrorsSection() {
  const [snapshot, setSnapshot] = useState<ClientErrorsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [copyErrorKey, setCopyErrorKey] = useState<string | null>(null);

  const loadGroups = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/client-errors", { cache: "no-store", credentials: "same-origin" });
      if (response.status === 401) {
        window.location.replace("/admin");
        return;
      }
      if (!response.ok) {
        throw new Error(await readError(response, "Client error data could not be loaded."));
      }
      const payload = (await response.json()) as ClientErrorsSnapshot;
      setSnapshot(payload);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Client error data could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void loadGroups());
  }, [loadGroups]);

  async function resolveGroup(group: ClientErrorGroup): Promise<void> {
    const key = groupKey(group);
    setBusyKey(key);
    setActionError(null);
    try {
      const response = await fetch("/api/admin/client-errors/actions", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: group.message, routePath: group.routePath }),
      });
      if (!response.ok) {
        throw new Error(await readError(response, "The group could not be resolved."));
      }
      await loadGroups();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The group could not be resolved.");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleCopyDetails(group: ClientErrorGroup): Promise<void> {
    const key = groupKey(group);
    setCopyErrorKey(null);
    const copied = await copyToClipboard(buildErrorGroupDetailsText(group));
    if (copied) {
      setCopiedKey(key);
    } else {
      setCopyErrorKey(key);
    }
  }

  const groups = snapshot?.groups || [];

  return (
    <section className={styles.panel}>
      <div className={styles.sectionHeader}>
        <div>
          <h2 className={styles.sectionTitle}>Errors</h2>
          <p className={styles.sectionIntro}>
            Client-side crash reports grouped by message and route — most frequent, then most recent, first. Resolving
            a group hides it here; it reappears automatically if a fresh occurrence lands afterward.
          </p>
        </div>
        <button type="button" className={styles.refreshButton} onClick={() => void loadGroups()} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {loadError ? <p className={styles.error} role="alert">{loadError}</p> : null}
      {actionError ? <p className={styles.error} role="alert">{actionError}</p> : null}
      {snapshot?.status === "unavailable" ? <p className={styles.notice} role="status">{snapshot.message}</p> : null}

      {!loading && snapshot?.status === "ready" && groups.length === 0 ? (
        <p className={styles.empty}>No unresolved client errors.</p>
      ) : null}

      <ul className={styles.groupList}>
        {groups.map((group) => {
          const key = groupKey(group);
          const busy = busyKey === key;
          const expanded = expandedKey === key;
          return (
            <li key={key} className={styles.group}>
              <div className={styles.groupTop}>
                <div className={styles.groupMeta}>
                  <p className={styles.groupMessage}>{group.message}</p>
                  <p className={styles.groupSub}>
                    {group.routePath} · {group.occurrenceCount} occurrence{group.occurrenceCount === 1 ? "" : "s"} ·{" "}
                    {group.distinctWallets} wallet{group.distinctWallets === 1 ? "" : "s"}
                    {group.buildId ? ` · build ${group.buildId.slice(0, 7)}` : ""}
                  </p>
                  <p className={styles.groupTimestamps}>
                    First seen {formatDate(group.firstSeen)} · last seen {formatDate(group.lastSeen)}
                  </p>
                </div>
                <span className={styles.occurrenceBadge}>{group.occurrenceCount}</span>
              </div>

              <div className={styles.groupActions}>
                <button
                  type="button"
                  className={styles.expandButton}
                  onClick={() => setExpandedKey(expanded ? null : key)}
                  disabled={!group.representativeStack}
                >
                  {expanded ? "Hide stack" : "Show stack"}
                </button>
                <button type="button" className={styles.resolveButton} disabled={busy} onClick={() => void resolveGroup(group)}>
                  {busy ? "Resolving…" : "Resolve"}
                </button>
                <button type="button" className={styles.copyDetailsButton} onClick={() => void handleCopyDetails(group)}>
                  {copiedKey === key ? "Copied" : copyErrorKey === key ? "Copy failed" : "Copy details"}
                </button>
              </div>

              {expanded && group.representativeStack ? <pre className={styles.stack}>{group.representativeStack}</pre> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
