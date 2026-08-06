"use client";

import type { AdminOperationsSnapshot } from "@/lib/admin-operations";
import { launchPathLabel } from "@/lib/launch-paths";
import styles from "./admin-operations-sections.module.css";

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function shortValue(value: string): string {
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
}

function billingLabel(value: "one_off" | "monthly" | "upfront"): string {
  if (value === "upfront") return "3 months upfront";
  if (value === "monthly") return "32-day renewal";
  return "one-off";
}

export function AdminMoneySection({
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
            Read-only factory values plus every server-verified ETH and USDT revenue event. This screen cannot move funds or change fees.
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
        <article className={styles.moneyCard}>
          <p className={styles.cardLabel}>Verified plan revenue</p>
          <p className={styles.cardValue}>
            {money.planRevenueStatus === "ready"
              ? formatUsd(money.planRevenueUsdCents)
              : "—"}
          </p>
        </article>
        <article className={styles.moneyCard}>
          <p className={styles.cardLabel}>Verified plan payments</p>
          <p className={styles.cardValue}>
            {money.planRevenueStatus === "ready" ? money.planPaymentCount : "—"}
          </p>
        </article>
      </div>

      <p className={styles.note}>{money.message}</p>
      {money.planRevenueStatus === "unavailable" ? (
        <p className={styles.error} role="alert">{money.planRevenueMessage}</p>
      ) : (
        <p className={styles.note}>{money.planRevenueMessage}</p>
      )}

      <h3 className={styles.subheading}>Recent verified plan payments</h3>
      {money.recentPlanPayments.length === 0 ? (
        <p className={styles.empty}>No verified plan payments yet.</p>
      ) : (
        <ol className={styles.activityList}>
          {money.recentPlanPayments.map((payment) => (
            <li key={payment.transactionHash} className={styles.activityItem}>
              <div className={styles.activityTop}>
                <p className={styles.activityMessage}>
                  <b>{launchPathLabel(payment.planId)}</b>{" "}
                  {formatUsd(payment.amountUsdCents)} · {payment.amountDisplay} {payment.asset} ·{" "}
                  <span className={styles.address}>{shortValue(payment.walletAddress)}</span>
                </p>
                <p className={styles.activityTime}>{formatTimestamp(payment.confirmedAt)}</p>
              </div>
              <p className={styles.cardDetail}>
                {billingLabel(payment.billingPeriod)} · Tx {shortValue(payment.transactionHash)}
                {payment.paidFrom ? ` · paid from ${formatTimestamp(payment.paidFrom)}` : ""}
                {payment.paidUntil ? ` · paid until ${formatTimestamp(payment.paidUntil)}` : ""}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
