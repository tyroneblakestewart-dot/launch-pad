"use client";

import { useEffect, useState } from "react";
import { STREET_TEAM_OPTION, STREET_TEAM_TARGET_ID } from "@/lib/plans-section";
import { useSubscriptionStatus } from "@/lib/use-subscription-status";
import styles from "./hoodlums-plans-section.module.css";

async function readError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  return payload.error || fallback;
}

/**
 * The Street Team add-on card (issue #343): styled to match the other plan
 * cards exactly, but with a "Tell us you want this" interest button instead
 * of a checkout flow. Registration is per-wallet and confirmed by the
 * server, so the confirmed state survives a reload of this page.
 */
export function StreetTeamCard() {
  const { walletAddress } = useSubscriptionStatus();
  // Tracked per-wallet (rather than a single boolean) so switching to a
  // different, unconfirmed wallet doesn't keep showing a stale confirmed
  // state left over from the previous one.
  const [confirmedWallet, setConfirmedWallet] = useState<string | null>(null);
  const [anonymousRegistered, setAnonymousRegistered] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const registered = walletAddress ? confirmedWallet === walletAddress : anonymousRegistered;

  useEffect(() => {
    if (!walletAddress) return;

    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(
          `/api/street-team/interest?wallet=${encodeURIComponent(walletAddress)}`,
          { cache: "no-store" },
        );
        if (!response.ok || cancelled) return;
        const payload = (await response.json()) as { registered?: boolean };
        if (!cancelled && payload.registered) setConfirmedWallet(walletAddress);
      } catch {
        // The confirmed badge simply stays unconfirmed; the button remains usable.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [walletAddress]);

  async function registerInterest(): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/street-team/interest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(walletAddress ? { walletAddress } : {}),
      });
      if (!response.ok) {
        throw new Error(await readError(response, "Interest could not be recorded."));
      }
      if (walletAddress) setConfirmedWallet(walletAddress);
      else setAnonymousRegistered(true);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Interest could not be recorded.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <article
      id={STREET_TEAM_TARGET_ID}
      className={`${styles.planCard} ${styles.streetTeamCard}`}
      data-launch-path="street-team"
    >
      <span className={styles.badge}>{STREET_TEAM_OPTION.badge}</span>
      <h3>{STREET_TEAM_OPTION.name}</h3>
      <span className={styles.planPrice}>{STREET_TEAM_OPTION.price}</span>
      <p className={styles.planTagline}>{STREET_TEAM_OPTION.description}</p>
      <ul className={styles.featureList}>
        {STREET_TEAM_OPTION.bullets.map((bullet) => (
          <li key={bullet}>{bullet}</li>
        ))}
      </ul>
      <p className={styles.planFoot}>{STREET_TEAM_OPTION.callout}</p>
      <p className={styles.streetTeamFootNote}>{STREET_TEAM_OPTION.footNote}</p>
      <p className={styles.streetTeamBundleNote}>{STREET_TEAM_OPTION.bundleNote}</p>
      {error ? (
        <p className={styles.streetTeamError} role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        className={styles.planCta}
        disabled={submitting || registered}
        onClick={() => void registerInterest()}
      >
        {registered ? "You're on the list" : submitting ? "Recording…" : "Tell us you want this"}
      </button>
    </article>
  );
}
