"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./admin-system-health.module.css";

type HealthStatus = "green" | "amber" | "red";

type HealthCheck = {
  id: string;
  label: string;
  status: HealthStatus;
  message: string;
};

type HealthResponse = {
  checks: HealthCheck[];
  checkedAt: string;
};

const STATUS_LABEL: Record<HealthStatus, string> = {
  green: "Healthy",
  amber: "Degraded",
  red: "Failing",
};

const REFRESH_INTERVAL_MS = 30_000;

/**
 * Polls /api/admin/health, which runs each check independently server-side.
 * A malformed or partial response still renders whatever checks came back —
 * one failing check must never blank the whole section.
 */
export function AdminSystemHealth() {
  const [checks, setChecks] = useState<HealthCheck[]>([]);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadHealth = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/health", { cache: "no-store" });
      if (!response.ok) throw new Error("The system health check could not be loaded.");
      const payload = (await response.json()) as HealthResponse;
      setChecks(Array.isArray(payload.checks) ? payload.checks : []);
      setCheckedAt(payload.checkedAt || null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The system health check could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHealth();
    const interval = setInterval(() => void loadHealth(), REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadHealth]);

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>System Health</h2>
        <button type="button" className={styles.refreshButton} onClick={() => void loadHealth()} disabled={loading}>
          Refresh
        </button>
      </div>

      {checkedAt ? (
        <p className={styles.timestamp}>Checked {new Date(checkedAt).toLocaleTimeString()}</p>
      ) : null}

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {loading && checks.length === 0 && !error ? (
        <p className={styles.loading}>Checking system health…</p>
      ) : null}

      <ul className={styles.grid}>
        {checks.map((check) => (
          <li key={check.id} className={styles.card} data-status={check.status}>
            <span className={styles.dot} aria-hidden="true" />
            <div className={styles.cardBody}>
              <p className={styles.cardLabel}>{check.label}</p>
              <p className={styles.cardStatus}>{STATUS_LABEL[check.status]}</p>
              <p className={styles.cardMessage}>{check.message}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
