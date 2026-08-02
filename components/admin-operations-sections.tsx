"use client";

import { useState, type FormEvent } from "react";
import type {
  AdminOperationsSnapshot,
  AdminServiceKey,
} from "@/lib/admin-operations";
import styles from "./admin-operations-sections.module.css";

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function healthSummary(snapshot: AdminOperationsSnapshot): string {
  const red = snapshot.health.filter((check) => check.status === "red").length;
  const amber = snapshot.health.filter((check) => check.status === "amber").length;
  if (red > 0) return `${red} failing, ${amber} degraded`;
  if (amber > 0) return `${amber} degraded, none failing`;
  return snapshot.health.length > 0 ? "All checks healthy" : "No check data";
}

export function AdminOverview({
  snapshot,
}: {
  snapshot: AdminOperationsSnapshot;
}) {
  const isolated = snapshot.services.filter((service) => service.isolated).length;
  const redIssues = snapshot.issues.filter((issue) => issue.severity === "red").length;

  return (
    <section className={styles.panel}>
      <div className={styles.sectionHeader}>
        <div>
          <h2 className={styles.sectionTitle}>Overview</h2>
          <p className={styles.sectionIntro}>
            A live operational summary of the parts Hoodlums can currently measure.
          </p>
        </div>
        <p className={styles.timestamp}>Updated {formatTimestamp(snapshot.checkedAt)}</p>
      </div>

      <div className={styles.summaryGrid}>
        <article className={styles.summaryCard}>
          <p className={styles.cardLabel}>System status</p>
          <p className={`${styles.cardValue} ${redIssues ? styles.bad : snapshot.issues.length ? styles.warning : styles.good}`}>
            {redIssues ? "Attention" : snapshot.issues.length ? "Degraded" : "Healthy"}
          </p>
          <p className={styles.cardDetail}>{healthSummary(snapshot)}</p>
        </article>

        <article className={styles.summaryCard}>
          <p className={styles.cardLabel}>Published sites</p>
          <p className={styles.cardValue}>
            {snapshot.sites.status === "ready" ? snapshot.sites.total : "—"}
          </p>
          <p className={styles.cardDetail}>
            {snapshot.sites.status === "ready"
              ? `${snapshot.sites.live} live · ${snapshot.sites.draft} draft`
              : snapshot.sites.message}
          </p>
        </article>

        <article className={styles.summaryCard}>
          <p className={styles.cardLabel}>Isolated services</p>
          <p className={`${styles.cardValue} ${isolated ? styles.warning : styles.good}`}>
            {isolated}
          </p>
          <p className={styles.cardDetail}>
            {isolated ? "Only the selected services are paused." : "All circuit breakers are open for traffic."}
          </p>
        </article>

        <article className={styles.summaryCard}>
          <p className={styles.cardLabel}>Admin sessions</p>
          <p className={styles.cardValue}>
            {snapshot.activeAdminSessions ?? "—"}
          </p>
          <p className={styles.cardDetail}>Durable sessions that have not expired.</p>
        </article>
      </div>

      {snapshot.sectionErrors.length > 0 ? (
        <p className={styles.error} role="alert">
          Some dashboard data is unavailable: {snapshot.sectionErrors.join(" ")}
        </p>
      ) : null}
    </section>
  );
}

export function AdminActivity({
  snapshot,
}: {
  snapshot: AdminOperationsSnapshot;
}) {
  return (
    <section className={styles.panel}>
      <div className={styles.sectionHeader}>
        <div>
          <h2 className={styles.sectionTitle}>Activity</h2>
          <p className={styles.sectionIntro}>
            Successful admin sign-ins, sign-outs, isolations and restorations. Passwords, signatures and raw session tokens are never recorded.
          </p>
        </div>
        <p className={styles.timestamp}>Latest {snapshot.activity.length}</p>
      </div>

      {snapshot.activity.length === 0 ? (
        <p className={styles.empty}>No operational activity has been recorded yet.</p>
      ) : (
        <ol className={styles.activityList}>
          {snapshot.activity.map((item) => (
            <li key={item.id} className={styles.activityItem}>
              <div className={styles.activityTop}>
                <p className={styles.activityMessage}>{item.message}</p>
                <p className={styles.activityTime}>{formatTimestamp(item.createdAt)}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function AdminMoney({
  snapshot,
}: {
  snapshot: AdminOperationsSnapshot;
}) {
  const money = snapshot.money;
  return (
    <section className={styles.panel}>
      <div className={styles.sectionHeader}>
        <div>
          <h2 className={styles.sectionTitle}>Money</h2>
          <p className={styles.sectionIntro}>
            Live read-only values from the deployed Hoodlums token factory. This screen cannot move funds or change fees.
          </p>
        </div>
        <p className={styles.timestamp}>{money.chainLabel}</p>
      </div>

      {money.status === "unavailable" ? (
        <p className={styles.error} role="alert">{money.message}</p>
      ) : null}

      <div className={styles.moneyGrid}>
        <article className={styles.moneyCard}>
          <p className={styles.cardLabel}>Current launch fee</p>
          <p className={styles.cardValue}>{money.launchFee}</p>
        </article>
        <article className={styles.moneyCard}>
          <p className={styles.cardLabel}>Factory launches</p>
          <p className={styles.cardValue}>{money.launchCount}</p>
        </article>
        <article className={styles.moneyCard}>
          <p className={styles.cardLabel}>Fee recipient</p>
          <p className={`${styles.cardValue} ${styles.address}`}>{money.feeRecipient}</p>
        </article>
        <article className={styles.moneyCard}>
          <p className={styles.cardLabel}>Recipient wallet balance</p>
          <p className={styles.cardValue}>{money.feeRecipientBalance}</p>
        </article>
      </div>

      <p className={styles.note}>{money.message}</p>
    </section>
  );
}

type AdminIssuesProps = {
  snapshot: AdminOperationsSnapshot;
  busyService: AdminServiceKey | null;
  actionError: string | null;
  onSetIsolation: (
    key: AdminServiceKey,
    isolated: boolean,
    reason: string,
  ) => Promise<void>;
};

export function AdminIssues({
  snapshot,
  busyService,
  actionError,
  onSetIsolation,
}: AdminIssuesProps) {
  const [editingService, setEditingService] = useState<AdminServiceKey | null>(null);
  const [reason, setReason] = useState("");

  async function submitIsolation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingService) return;
    try {
      await onSetIsolation(editingService, true, reason);
      setEditingService(null);
      setReason("");
    } catch {
      // The parent renders the returned API error without discarding the reason.
    }
  }

  async function restoreService(key: AdminServiceKey, label: string) {
    const confirmed = window.confirm(
      `Restore ${label}? Requests will be allowed through this service again.`,
    );
    if (!confirmed) return;
    try {
      await onSetIsolation(
        key,
        false,
        "Restored after administrator review.",
      );
    } catch {
      // The parent renders the API error.
    }
  }

  return (
    <section className={styles.panel}>
      <div className={styles.sectionHeader}>
        <div>
          <h2 className={styles.sectionTitle}>Issues</h2>
          <p className={styles.sectionIntro}>
            Current health warnings plus manual circuit breakers for server-backed features.
          </p>
        </div>
        <p className={styles.timestamp}>{snapshot.issues.length} open</p>
      </div>

      <p className={styles.callout}>
        <strong>Isolation is a circuit breaker.</strong> It returns a controlled maintenance response only for the selected feature. Admin login, System Health and every other service stay online. Database, deployment and admin authentication are monitoring-only here and cannot be disabled, preventing an accidental lockout.
      </p>

      {actionError ? (
        <p className={styles.error} role="alert">{actionError}</p>
      ) : null}

      <h3 className={styles.subheading}>Open issues</h3>
      {snapshot.issues.length === 0 ? (
        <p className={styles.empty}>No current health warnings or isolated services.</p>
      ) : (
        <ul className={styles.issueList}>
          {snapshot.issues.map((issue) => (
            <li key={issue.id} className={styles.issueItem}>
              <div className={styles.issueTop}>
                <p className={styles.issueTitle}>{issue.title}</p>
                <span className={issue.severity === "red" ? styles.badgeRed : styles.badgeAmber}>
                  {issue.severity === "red" ? "Failing" : "Attention"}
                </span>
              </div>
              <p className={styles.issueMessage}>{issue.message}</p>
            </li>
          ))}
        </ul>
      )}

      <h3 className={styles.subheading}>Service isolation</h3>
      {snapshot.services.length === 0 ? (
        <p className={styles.error} role="alert">
          Service controls are unavailable. Apply the latest database migration before using isolation.
        </p>
      ) : (
        <ul className={styles.serviceList}>
          {snapshot.services.map((service) => {
            const busy = busyService === service.key;
            const editing = editingService === service.key;
            return (
              <li key={service.key} className={styles.serviceItem}>
                <div className={styles.serviceTop}>
                  <div>
                    <p className={styles.serviceLabel}>{service.label}</p>
                    <p className={styles.serviceDescription}>{service.description}</p>
                    <p className={styles.serviceRoutes}>Affects: {service.affectedRoutes}</p>
                    {service.isolated ? (
                      <p className={styles.serviceReason}>
                        Reason: {service.reason || "No reason recorded."} · changed {formatTimestamp(service.updatedAt)}
                      </p>
                    ) : null}
                  </div>
                  <span className={service.isolated ? styles.badgeIsolated : styles.badgeActive}>
                    {service.isolated ? "Isolated" : "Active"}
                  </span>
                </div>

                {editing ? (
                  <form className={styles.isolationForm} onSubmit={(event) => void submitIsolation(event)}>
                    <label htmlFor={`reason-${service.key}`} className={styles.serviceDescription}>
                      Why are you isolating this service? This note is kept in the activity log.
                    </label>
                    <textarea
                      id={`reason-${service.key}`}
                      className={styles.reasonInput}
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      minLength={5}
                      maxLength={300}
                      required
                      disabled={busy}
                      placeholder="Example: upstream provider returning repeated 500 errors while we investigate."
                    />
                    <div className={styles.formActions}>
                      <button
                        type="button"
                        className={styles.cancelButton}
                        disabled={busy}
                        onClick={() => {
                          setEditingService(null);
                          setReason("");
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className={styles.confirmButton}
                        disabled={busy || reason.trim().length < 5}
                      >
                        {busy ? "Isolating…" : "Confirm isolation"}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className={styles.serviceActions}>
                    {service.isolated ? (
                      <button
                        type="button"
                        className={styles.restoreButton}
                        disabled={busy}
                        onClick={() => void restoreService(service.key, service.label)}
                      >
                        {busy ? "Restoring…" : "Restore service"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={styles.isolateButton}
                        disabled={busy}
                        onClick={() => {
                          setEditingService(service.key);
                          setReason("");
                        }}
                      >
                        Isolate service
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
