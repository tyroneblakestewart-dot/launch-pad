"use client";

import Link from "next/link";
import { useState } from "react";
import { useSubscriptionStatus } from "@/lib/use-subscription-status";
import { subscriptionPlanLabel } from "@/lib/subscription-lifecycle";
import { ManagerPlans, ManagerPlansGrid } from "./manager-plans";
import styles from "./manager-gateway.module.css";

type ManagerGatewayProps = {
  headerEyebrow: string;
  headerTitle: string;
  headerIntro: string;
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

export function ManagerGateway({ headerEyebrow, headerTitle, headerIntro }: ManagerGatewayProps) {
  const { state, access } = useSubscriptionStatus();
  const [plansOpen, setPlansOpen] = useState(false);

  if (state === "checking") {
    return (
      <main className={styles.shell}>
        <section className={styles.loading} aria-live="polite">
          <span className={styles.spinner} aria-hidden="true" />
          <p>Checking your subscription…</p>
        </section>
      </main>
    );
  }

  const hasAccess = state === "ready" && access !== null && access.active;

  if (!hasAccess) {
    return <ManagerPlans headerEyebrow={headerEyebrow} headerTitle={headerTitle} headerIntro={headerIntro} />;
  }

  const isTestAccess = access.accessSource === "test-allowlist";

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <p>{headerEyebrow}</p>
        <h1>{headerTitle}</h1>
        <span>{headerIntro}</span>
      </header>

      <div className={styles.inner}>
        <section className={styles.panel}>
          <span className={styles.panelEyebrow}>
            {isTestAccess ? "TEST ACCESS · ADMIN ALLOWLIST" : "PRO · AI SOCIAL STUDIO"}
          </span>
          <h2>
            {isTestAccess
              ? "Test access"
              : access.plan
                ? subscriptionPlanLabel(access.plan)
                : "Pro"}
          </h2>
          {isTestAccess ? (
            <p>Allowlisted for testing · no payment or revenue recorded</p>
          ) : (
            <p>Active until {formatDate(access.paidUntil)}</p>
          )}
          <Link href="/social" className={styles.cta}>
            Open AI Social Studio
          </Link>
        </section>

        <button
          type="button"
          className={styles.toggle}
          onClick={() => setPlansOpen((value) => !value)}
          aria-expanded={plansOpen}
        >
          {plansOpen ? "Hide plans" : "View plans"}
        </button>

        {plansOpen ? <ManagerPlansGrid /> : null}
      </div>
    </main>
  );
}
