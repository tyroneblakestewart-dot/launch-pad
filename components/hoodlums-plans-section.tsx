"use client";

import { useEffect, useRef, useState } from "react";
import { LAUNCH_PATH_OPTIONS } from "@/lib/launch-paths";
import {
  PLAN_CALLOUTS,
  PLAN_FAQS,
  PLANS_BILLING_OPTIONS,
  PRO_BUNDLE_FEATURES,
  planPriceForBilling,
  proBundlePriceForBilling,
  togglePlanFaq,
  type PlansBilling,
} from "@/lib/plans-section";
import type { LaunchPath } from "@/lib/types";
import { requestWorkspaceOpen } from "@/lib/workspace-open-request";
import styles from "./hoodlums-plans-section.module.css";

function scrollToPlanDetail(targetId: string): void {
  document.getElementById(targetId)?.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
}

export function HoodlumsPlansSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const [billing, setBilling] = useState<PlansBilling>("monthly");
  const [openFaq, setOpenFaq] = useState(0);
  const [mobileCtaVisible, setMobileCtaVisible] = useState(false);
  const bundlePrice = proBundlePriceForBilling(billing);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      ([entry]) => setMobileCtaVisible(entry.isIntersecting),
      { threshold: 0.08 },
    );
    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  function openWorkspaceWithPlan(path: LaunchPath): void {
    requestWorkspaceOpen("new", path);
  }

  return (
    <section
      ref={sectionRef}
      id="plans"
      className={styles.section}
      aria-labelledby="hoodlums-plans-title"
    >
      <div className={styles.inner}>
        <header className={styles.heading}>
          <p className={styles.eyebrow}>PLANS · CHOOSE YOUR PATH</p>
          <h2 id="hoodlums-plans-title">
            Pick your plan. Launch your token. Build your community.
          </h2>
          <p>The first AI marketing team purpose-built for token communities.</p>
        </header>

        <div className={styles.plansBlock}>
          <div className={styles.plansToolbar}>
            <span>Four ways in</span>
            <div className={styles.billingToggle} aria-label="Plan billing period">
              {PLANS_BILLING_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={billing === option.id ? styles.billingActive : styles.billingButton}
                  aria-pressed={billing === option.id}
                  onClick={() => setBilling(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.planGrid}>
            {LAUNCH_PATH_OPTIONS.map((option) => (
              <article
                key={option.id}
                className={`${styles.planCard} ${option.featured ? styles.planCardFeatured : ""}`}
                data-launch-path={option.id}
              >
                {option.badge ? <span className={styles.badge}>{option.badge}</span> : null}
                <h3>{option.name}</h3>
                <span className={styles.planPrice}>{planPriceForBilling(option, billing)}</span>
                <p className={styles.planTagline}>{option.tagline}</p>
                <ul className={styles.featureList}>
                  {option.bullets.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
                {option.foot ? <p className={styles.planFoot}>{option.foot}</p> : null}
                {option.detailsLink ? (
                  <button
                    type="button"
                    className={styles.bundleTextLink}
                    onClick={() => scrollToPlanDetail(option.detailsLink!.targetId)}
                  >
                    {option.detailsLink.label}
                  </button>
                ) : null}
                <button
                  type="button"
                  className={styles.planCta}
                  onClick={() => openWorkspaceWithPlan(option.id)}
                >
                  Get started with {option.name}
                </button>
              </article>
            ))}
          </div>

          <p className={styles.planNote}>
            Bond and Bond + Site are free forever. Paid plans are billed in USD — see the{" "}
            <span>terms</span> before you upgrade.
          </p>
        </div>

        <article id="pro-bundle" className={styles.bundleCard}>
          <div className={styles.bundleGlow} aria-hidden="true" />
          <div className={styles.bundleCopy}>
            <span className={styles.bundleBadge}>Pro Bundle</span>
            <h2>Run your whole portfolio. One dashboard. One payment.</h2>
            <p>
              Three tokens, all active, all growing — without tripling your workload. Built for
              the builders who don&apos;t stop at one.
            </p>
            <div className={styles.bundlePriceRow}>
              <strong>{bundlePrice.price}</strong>
              <span>{bundlePrice.period}</span>
            </div>
            <small>{bundlePrice.note}</small>
            <button
              type="button"
              className={styles.bundleCta}
              onClick={() => openWorkspaceWithPlan("pro")}
            >
              Get Pro Bundle
            </button>
          </div>
          <div className={styles.bundleFeaturesWrap}>
            <ul className={styles.bundleFeatures}>
              {PRO_BUNDLE_FEATURES.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
            <p>
              Serious builders run more than one token. Now they don&apos;t need three times the
              effort.
            </p>
          </div>
        </article>

        <div className={styles.calloutGrid}>
          {PLAN_CALLOUTS.map((callout) => (
            <article key={callout.kicker} className={styles.calloutCard}>
              <span>{callout.kicker}</span>
              <h3>{callout.heading}</h3>
              <p>{callout.body}</p>
            </article>
          ))}
        </div>

        <div className={styles.faqBlock}>
          <h2>Questions, answered</h2>
          <div className={styles.faqList}>
            {PLAN_FAQS.map((faq, index) => {
              const isOpen = openFaq === index;
              const answerId = `plan-faq-answer-${index}`;
              return (
                <article
                  key={faq.question}
                  className={`${styles.faqItem} ${isOpen ? styles.faqItemOpen : ""}`}
                >
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={answerId}
                    onClick={() => setOpenFaq((current) => togglePlanFaq(current, index))}
                  >
                    <span>{faq.question}</span>
                    <i aria-hidden="true">+</i>
                  </button>
                  {isOpen ? (
                    <p id={answerId} role="region">
                      {faq.answer}
                    </p>
                  ) : null}
                </article>
              );
            })}
          </div>
        </div>

        <div className={styles.bottomCta}>
          <h2>Start with Bond — it&apos;s free. Upgrade any time.</h2>
          <button type="button" onClick={() => openWorkspaceWithPlan("bond")}>
            Launch your token →
          </button>
        </div>
      </div>

      <div
        className={`${styles.mobileStickyCta} ${mobileCtaVisible ? styles.mobileStickyCtaVisible : ""}`}
        aria-hidden={!mobileCtaVisible}
      >
        <span>
          <b>Bond is free</b>
          <small>Upgrade any time</small>
        </span>
        <button
          type="button"
          tabIndex={mobileCtaVisible ? 0 : -1}
          onClick={() => openWorkspaceWithPlan("bond")}
        >
          Launch your token →
        </button>
      </div>
    </section>
  );
}
