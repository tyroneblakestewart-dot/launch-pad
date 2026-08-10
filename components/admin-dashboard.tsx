"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminAccountsSection } from "@/components/admin-accounts-section";
import {
  AdminActivity,
  AdminIssues,
  AdminOverview,
} from "@/components/admin-operations-sections";
import { AdminMoneySection } from "@/components/admin-money-section";
import { AdminPagesSection } from "@/components/admin-pages-section";
import { AdminSubscribersSection } from "@/components/admin-subscribers-section";
import { AdminSystemHealth } from "@/components/admin-system-health";
import type {
  AdminOperationsSnapshot,
  AdminServiceKey,
} from "@/lib/admin-operations";
import styles from "./admin-dashboard.module.css";

type SectionId =
  | "overview"
  | "activity"
  | "money"
  | "issues"
  | "pages"
  | "subscribers"
  | "accounts"
  | "system-health";

const SECTIONS: ReadonlyArray<{ id: SectionId; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "activity", label: "Activity" },
  { id: "money", label: "Money" },
  { id: "issues", label: "Issues" },
  { id: "pages", label: "Pages" },
  { id: "subscribers", label: "Subscribers" },
  { id: "accounts", label: "Accounts" },
  { id: "system-health", label: "System Health" },
];

const REFRESH_INTERVAL_MS = 30_000;

async function readError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
  };
  return payload.error || fallback;
}

async function signOutOfAdmin(): Promise<void> {
  const response = await fetch("/api/admin/logout", {
    method: "POST",
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Admin sign-out failed."));
  }
}

async function fetchOperations(): Promise<AdminOperationsSnapshot> {
  const response = await fetch("/api/admin/operations", {
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw new Error(
      await readError(response, "Admin operations could not be loaded."),
    );
  }
  return (await response.json()) as AdminOperationsSnapshot;
}

export function AdminDashboard() {
  const [activeSection, setActiveSection] = useState<SectionId>("overview");
  const [snapshot, setSnapshot] = useState<AdminOperationsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyService, setBusyService] = useState<AdminServiceKey | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const loadOperations = useCallback(async () => {
    setLoading(true);
    try {
      const next = await fetchOperations();
      setSnapshot(next);
      setLoadError(null);
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : "Admin operations could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void loadOperations());
    const interval = setInterval(() => void loadOperations(), REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadOperations]);

  const handleSignOut = useCallback(async () => {
    setSigningOut(true);
    try {
      await signOutOfAdmin();
      window.location.replace("/admin");
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "Admin sign-out failed.",
      );
    } finally {
      setSigningOut(false);
    }
  }, []);

  const handleSetIsolation = useCallback(
    async (
      key: AdminServiceKey,
      isolated: boolean,
      reason: string,
    ): Promise<void> => {
      setBusyService(key);
      setActionError(null);
      try {
        const response = await fetch("/api/admin/operations", {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ serviceKey: key, isolated, reason }),
        });
        if (!response.ok) {
          throw new Error(
            await readError(
              response,
              "The service isolation state could not be changed.",
            ),
          );
        }
        await loadOperations();
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "The service isolation state could not be changed.";
        setActionError(message);
        throw error;
      } finally {
        setBusyService(null);
      }
    },
    [loadOperations],
  );

  const independentSection =
    activeSection === "system-health" ||
    activeSection === "pages" ||
    activeSection === "subscribers" ||
    activeSection === "accounts";

  return (
    <main className={styles.dashboard}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>HOODLUMS Admin</h1>
          <p className={styles.subtitle}>Operations and recovery control panel</p>
        </div>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.refreshButton}
            onClick={() => void loadOperations()}
            disabled={loading}
          >
            {loading ? "Refreshing…" : "Refresh data"}
          </button>
          <button
            type="button"
            className={styles.signOutButton}
            onClick={() => void handleSignOut()}
            disabled={signingOut}
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </header>

      <nav className={styles.nav} aria-label="Dashboard sections">
        {SECTIONS.map((section) => (
          <button
            key={section.id}
            type="button"
            aria-current={section.id === activeSection ? "page" : undefined}
            className={
              section.id === activeSection
                ? styles.navItemActive
                : styles.navItem
            }
            onClick={() => setActiveSection(section.id)}
          >
            {section.label}
          </button>
        ))}
      </nav>

      <section className={styles.content}>
        {loadError ? (
          <p className={styles.error} role="alert">
            {loadError}
          </p>
        ) : null}

        {!independentSection && !snapshot ? (
          <div className={styles.loadingPanel}>
            {loading ? "Loading admin operations…" : "No operations data is available."}
          </div>
        ) : null}

        {snapshot && activeSection === "overview" ? (
          <AdminOverview snapshot={snapshot} />
        ) : null}
        {snapshot && activeSection === "activity" ? (
          <AdminActivity snapshot={snapshot} />
        ) : null}
        {snapshot && activeSection === "money" ? (
          <AdminMoneySection snapshot={snapshot} />
        ) : null}
        {snapshot && activeSection === "issues" ? (
          <AdminIssues
            snapshot={snapshot}
            busyService={busyService}
            actionError={actionError}
            onSetIsolation={handleSetIsolation}
          />
        ) : null}
        {activeSection === "pages" ? <AdminPagesSection /> : null}
        {activeSection === "subscribers" ? <AdminSubscribersSection /> : null}
        {activeSection === "accounts" ? <AdminAccountsSection /> : null}
        {activeSection === "system-health" ? <AdminSystemHealth /> : null}
      </section>
    </main>
  );
}
