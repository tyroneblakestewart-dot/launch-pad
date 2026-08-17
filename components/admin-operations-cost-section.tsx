"use client";

import { useState, type FormEvent } from "react";
import type {
  AdminCostPeriodSnapshot,
  AdminFixedOperatingCost,
  AdminOperationsSnapshot,
} from "@/lib/admin-operations";
import styles from "./admin-operations-cost-section.module.css";

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(
    value,
  );
}

function formatUsdCents(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function formatPercent(value: number | null): string {
  if (value === null) return "—";
  return `${value >= 0 ? "" : ""}${value.toFixed(1)}%`;
}

function shortWallet(value: string): string {
  return value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

function relativeTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.round(diffMs / 60_000);
  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes} min ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d ago`;
}

async function responseError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => ({}))) as { error?: unknown };
  return typeof payload.error === "string" ? payload.error : fallback;
}

function PeriodCard({ title, period }: { title: string; period: AdminCostPeriodSnapshot }) {
  return (
    <article className={styles.periodCard}>
      <p className={styles.periodTitle}>{title}</p>
      <p className={styles.periodTotal}>{formatUsd(period.totalCostUsd)}</p>
      <dl className={styles.periodDetails}>
        <div>
          <dt>Variable (AI + X)</dt>
          <dd>
            {formatUsd(period.variableCostUsd)}{" "}
            <span className={styles.periodSub}>
              (AI {formatUsd(period.aiCostUsd)} · X {formatUsd(period.xCostUsd)})
            </span>
          </dd>
        </div>
        <div>
          <dt>Fixed (prorated)</dt>
          <dd>{formatUsd(period.fixedCostUsd)}</dd>
        </div>
        <div>
          <dt>Verified revenue</dt>
          <dd>{formatUsdCents(period.revenueUsdCents)}</dd>
        </div>
        <div>
          <dt>Estimated margin</dt>
          <dd className={period.marginUsd >= 0 ? styles.good : styles.bad}>
            {formatUsd(period.marginUsd)} ({formatPercent(period.marginPercent)})
          </dd>
        </div>
      </dl>
    </article>
  );
}

type FixedCostFormState = { name: string; amountUsd: string; cadence: "monthly" | "annual"; note: string };

const EMPTY_FORM: FixedCostFormState = { name: "", amountUsd: "", cadence: "monthly", note: "" };

export function AdminOperationsCostSection({
  snapshot,
  onFixedCostsChanged,
}: {
  snapshot: AdminOperationsSnapshot;
  onFixedCostsChanged: () => Promise<void>;
}) {
  const costs = snapshot.costs;
  const [form, setForm] = useState<FixedCostFormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FixedCostFormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!costs) {
    return (
      <section className={styles.panel}>
        <h2 className={styles.sectionTitle}>Operations</h2>
        <p className={styles.error} role="alert">
          Operations cost data is not available yet.
        </p>
      </section>
    );
  }

  function startEdit(cost: AdminFixedOperatingCost) {
    setEditingId(cost.id);
    setEditForm({ name: cost.name, amountUsd: String(cost.amountUsd), cadence: cost.cadence, note: cost.note || "" });
  }

  async function submitFixedCost(event: FormEvent<HTMLFormElement>, mode: "create" | "update") {
    event.preventDefault();
    setError(null);
    const active = mode === "create" ? form : editForm;
    const amountUsd = Number.parseFloat(active.amountUsd);
    if (!active.name.trim() || !Number.isFinite(amountUsd) || amountUsd <= 0) {
      setError("Enter a name and a positive dollar amount.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/admin/operations/fixed-costs", {
        method: mode === "create" ? "POST" : "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(mode === "update" ? { id: editingId } : {}),
          name: active.name.trim(),
          amountUsd,
          cadence: active.cadence,
          note: active.note.trim() || null,
        }),
      });
      if (response.status === 401) {
        window.location.replace("/admin");
        return;
      }
      if (!response.ok) {
        throw new Error(await responseError(response, "The fixed cost could not be saved."));
      }
      if (mode === "create") setForm(EMPTY_FORM);
      else setEditingId(null);
      await onFixedCostsChanged();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "The fixed cost could not be saved.");
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteFixedCost(cost: AdminFixedOperatingCost) {
    const confirmed = window.confirm(`Delete the fixed cost "${cost.name}"? This cannot be undone.`);
    if (!confirmed) return;
    setDeletingId(cost.id);
    setError(null);
    try {
      const response = await fetch("/api/admin/operations/fixed-costs", {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: cost.id }),
      });
      if (response.status === 401) {
        window.location.replace("/admin");
        return;
      }
      if (!response.ok) {
        throw new Error(await responseError(response, "The fixed cost could not be deleted."));
      }
      await onFixedCostsChanged();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "The fixed cost could not be deleted.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className={styles.panel}>
      <div className={styles.sectionHeader}>
        <div>
          <h2 className={styles.sectionTitle}>Operations</h2>
          <p className={styles.sectionIntro}>Am I making money? Estimated operating costs, verified revenue and margin, all in one place.</p>
        </div>
      </div>

      <p className={styles.disclaimer}>
        <b>Estimated operating costs.</b> Every figure below is an estimate — returned usage × configured prices — not the
        provider invoice. Actual OpenAI/X bills can differ because of rounding, pricing changes, credits, discounts, minimum
        charges, failed calls without usage, and tax. Reconcile weekly during launch/active testing and at least monthly
        once stable.
      </p>

      {costs.status === "unavailable" ? (
        <p className={styles.error} role="alert">
          {costs.message}
        </p>
      ) : (
        <>
          <div className={styles.periodGrid}>
            <PeriodCard title="Today so far" period={costs.today} />
            <PeriodCard title="This month" period={costs.thisMonth} />
            <PeriodCard title="Last month" period={costs.lastMonth} />
          </div>

          <h3 className={styles.subheading}>This month&apos;s feature breakdown</h3>
          {costs.featureBreakdown.length === 0 ? (
            <p className={styles.empty}>No AI or X spend recorded yet this month.</p>
          ) : (
            <ul className={styles.breakdownList}>
              {costs.featureBreakdown.map((row) => (
                <li key={row.featureLabel} className={styles.breakdownItem}>
                  <span className={styles.breakdownLabel}>{row.featureLabel}</span>
                  <span className={styles.breakdownCost}>{formatUsd(row.costUsd)}</span>
                  <span className={styles.breakdownCount}>{row.operationCount} ops</span>
                </li>
              ))}
            </ul>
          )}

          <h3 className={styles.subheading}>Attributed vs unattributed spend</h3>
          <p className={styles.note}>
            Free-site and site-style generation requests have no wallet in their request contract, so their cost is genuinely
            unattributed — it is not hidden inside any wallet&apos;s total below.
          </p>
          <div className={styles.reconciliationGrid}>
            <article className={styles.moneyCard}>
              <p className={styles.cardLabel}>Attributed this month</p>
              <p className={styles.cardValue}>{formatUsd(costs.reconciliation.attributedCostUsd)}</p>
            </article>
            <article className={styles.moneyCard}>
              <p className={styles.cardLabel}>Unattributed this month</p>
              <p className={styles.cardValue}>{formatUsd(costs.reconciliation.unattributedCostUsd)}</p>
            </article>
          </div>

          <h4 className={styles.subheading}>Top {costs.reconciliation.topWalletsLimit} wallets by variable cost this month</h4>
          <p className={styles.note}>
            This table is limited to the top {costs.reconciliation.topWalletsLimit} wallets — it does not cover all attributed
            spend. See the attributed total above for the full figure.
          </p>
          {costs.reconciliation.topWallets.length === 0 ? (
            <p className={styles.empty}>No wallet-attributed spend yet this month.</p>
          ) : (
            <ul className={styles.walletList}>
              {costs.reconciliation.topWallets.map((wallet) => (
                <li key={wallet.walletAddress} className={styles.walletItem}>
                  <div className={styles.walletTop}>
                    <span className={styles.address}>{shortWallet(wallet.walletAddress)}</span>
                    {wallet.accessSource === "test-allowlist" ? <span className={styles.badgeAmber}>Test access</span> : null}
                    {wallet.plan ? <span className={styles.badgeActive}>{wallet.plan}</span> : null}
                  </div>
                  <p className={styles.cardDetail}>
                    {formatUsd(wallet.variableCostUsd)} across {wallet.operationCount} operation(s) · verified revenue{" "}
                    {formatUsdCents(wallet.revenueUsdCents)}
                    {wallet.accessSource === "test-allowlist" ? " (test access — no payment expected)" : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}

          <h3 className={styles.subheading}>Live activity ledger</h3>
          {costs.ledger.length === 0 ? (
            <p className={styles.empty}>No operations recorded yet.</p>
          ) : (
            <ol className={styles.ledgerList}>
              {costs.ledger.map((item) => (
                <li key={item.id} className={styles.ledgerItem}>
                  {relativeTime(item.occurredAt)} · {item.featureLabel} · {formatUsd(item.costUsd)} ·{" "}
                  {item.walletAddress ? <span className={styles.address}>{shortWallet(item.walletAddress)}</span> : "Unattributed"}
                </li>
              ))}
            </ol>
          )}

          <h3 className={styles.subheading}>Fixed operating costs</h3>
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
          <form className={styles.form} onSubmit={(event) => void submitFixedCost(event, "create")}>
            <label>
              <span>Name</span>
              <input
                type="text"
                maxLength={120}
                placeholder="Vercel hosting"
                value={form.name}
                disabled={submitting}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              />
            </label>
            <label>
              <span>Amount (USD)</span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                placeholder="20.00"
                value={form.amountUsd}
                disabled={submitting}
                onChange={(event) => setForm((prev) => ({ ...prev, amountUsd: event.target.value }))}
              />
            </label>
            <label>
              <span>Cadence</span>
              <select
                value={form.cadence}
                disabled={submitting}
                onChange={(event) => setForm((prev) => ({ ...prev, cadence: event.target.value as "monthly" | "annual" }))}
              >
                <option value="monthly">Monthly</option>
                <option value="annual">Annual</option>
              </select>
            </label>
            <label>
              <span>Note (optional)</span>
              <input
                type="text"
                maxLength={500}
                placeholder="Pro plan"
                value={form.note}
                disabled={submitting}
                onChange={(event) => setForm((prev) => ({ ...prev, note: event.target.value }))}
              />
            </label>
            <button type="submit" className={styles.addButton} disabled={submitting}>
              {submitting ? "Adding…" : "Add fixed cost"}
            </button>
          </form>

          {costs.fixedCosts.length === 0 ? (
            <p className={styles.empty}>No fixed costs entered yet.</p>
          ) : (
            <ul className={styles.fixedCostList}>
              {costs.fixedCosts.map((cost) =>
                editingId === cost.id ? (
                  <li key={cost.id} className={styles.fixedCostItem}>
                    <form className={styles.form} onSubmit={(event) => void submitFixedCost(event, "update")}>
                      <label>
                        <span>Name</span>
                        <input
                          type="text"
                          maxLength={120}
                          value={editForm.name}
                          disabled={submitting}
                          onChange={(event) => setEditForm((prev) => ({ ...prev, name: event.target.value }))}
                        />
                      </label>
                      <label>
                        <span>Amount (USD)</span>
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={editForm.amountUsd}
                          disabled={submitting}
                          onChange={(event) => setEditForm((prev) => ({ ...prev, amountUsd: event.target.value }))}
                        />
                      </label>
                      <label>
                        <span>Cadence</span>
                        <select
                          value={editForm.cadence}
                          disabled={submitting}
                          onChange={(event) => setEditForm((prev) => ({ ...prev, cadence: event.target.value as "monthly" | "annual" }))}
                        >
                          <option value="monthly">Monthly</option>
                          <option value="annual">Annual</option>
                        </select>
                      </label>
                      <label>
                        <span>Note (optional)</span>
                        <input
                          type="text"
                          maxLength={500}
                          value={editForm.note}
                          disabled={submitting}
                          onChange={(event) => setEditForm((prev) => ({ ...prev, note: event.target.value }))}
                        />
                      </label>
                      <div className={styles.formActions}>
                        <button type="submit" className={styles.confirmButton} disabled={submitting}>
                          {submitting ? "Saving…" : "Save"}
                        </button>
                        <button type="button" className={styles.cancelButton} onClick={() => setEditingId(null)} disabled={submitting}>
                          Cancel
                        </button>
                      </div>
                    </form>
                  </li>
                ) : (
                  <li key={cost.id} className={styles.fixedCostItem}>
                    <div className={styles.walletTop}>
                      <span className={styles.activityMessage}>{cost.name}</span>
                      <span className={styles.cardValue}>{formatUsd(cost.amountUsd)}</span>
                    </div>
                    <p className={styles.cardDetail}>
                      {cost.cadence === "annual" ? `Annual — ${formatUsd(cost.monthlyEquivalentUsd)}/month equivalent` : "Monthly"}
                      {cost.note ? ` · ${cost.note}` : ""}
                    </p>
                    <div className={styles.formActions}>
                      <button type="button" className={styles.isolateButton} onClick={() => startEdit(cost)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className={styles.cancelButton}
                        disabled={deletingId === cost.id}
                        onClick={() => void deleteFixedCost(cost)}
                      >
                        {deletingId === cost.id ? "Deleting…" : "Delete"}
                      </button>
                    </div>
                  </li>
                ),
              )}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
