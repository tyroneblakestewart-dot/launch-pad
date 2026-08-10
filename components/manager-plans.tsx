"use client";

import Link from "next/link";
import { useState } from "react";
import {
  LAUNCH_PATH_OPTIONS,
  PRO_BUNDLE_OPTION,
  storeLaunchPathPreset,
} from "@/lib/launch-paths";
import {
  PLANS_BILLING_OPTIONS,
  planPriceForBilling,
  proBundlePlanPriceForBilling,
  type PlansBilling,
} from "@/lib/plans-section";
import planStyles from "./hoodlums-plans-section.module.css";
import styles from "./manager-plans.module.css";

export function ManagerPlansGrid() {
  const [billing, setBilling] = useState<PlansBilling>("monthly");
  const proOption = LAUNCH_PATH_OPTIONS.find((option) => option.id === "pro")!;

  return (
    <div className={styles.inner}>
      <div className={styles.toolbar}>
        <span>Billing period</span>
        <div className={planStyles.billingToggle} aria-label="Plan billing period">
          {PLANS_BILLING_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={billing === option.id ? planStyles.billingActive : planStyles.billingButton}
              aria-pressed={billing === option.id}
              onClick={() => setBilling(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.grid}>
        <article className={planStyles.planCard} data-launch-path="pro">
          <h3>{proOption.name}</h3>
          <span className={planStyles.planPrice}>{planPriceForBilling(proOption, billing)}</span>
          <p className={planStyles.planTagline}>{proOption.tagline}</p>
          <ul className={planStyles.featureList}>
            {proOption.bullets.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
          {proOption.foot ? <p className={planStyles.planFoot}>{proOption.foot}</p> : null}
          <Link
            href="/"
            className={planStyles.planCta}
            onClick={() => storeLaunchPathPreset("pro")}
          >
            Get started with Pro
          </Link>
        </article>

        <article className={planStyles.planCard} data-launch-path="pro-bundle">
          <h3>{PRO_BUNDLE_OPTION.name}</h3>
          <span className={planStyles.planPrice}>{proBundlePlanPriceForBilling(billing)}</span>
          <p className={planStyles.planTagline}>{PRO_BUNDLE_OPTION.tagline}</p>
          <ul className={planStyles.featureList}>
            {PRO_BUNDLE_OPTION.bullets.map((feature) => (
              <li key={feature}>{feature}</li>
            ))}
          </ul>
          <p className={planStyles.planFoot}>{PRO_BUNDLE_OPTION.foot}</p>
          <Link
            href="/"
            className={planStyles.planCta}
            onClick={() => storeLaunchPathPreset("pro-bundle")}
          >
            Get Pro Bundle
          </Link>
        </article>
      </div>
    </div>
  );
}

type ManagerPlansProps = {
  headerEyebrow: string;
  headerTitle: string;
  headerIntro: string;
};

export function ManagerPlans({ headerEyebrow, headerTitle, headerIntro }: ManagerPlansProps) {
  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <p>{headerEyebrow}</p>
        <h1>{headerTitle}</h1>
        <span>{headerIntro}</span>
      </header>

      <ManagerPlansGrid />
    </main>
  );
}
