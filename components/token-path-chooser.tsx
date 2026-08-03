"use client";

import { useEffect, useState } from "react";
import { HOODLUMS_WORDMARK_IMAGE } from "@/lib/hoodlums-wordmark-image";
import {
  LAUNCH_PATH_OPTIONS,
  consumeLaunchPathPreset,
  launchPathLabel,
} from "@/lib/launch-paths";
import type { LaunchPath } from "@/lib/types";
import {
  OPEN_WORKSPACE_REQUEST_EVENT,
  type OpenWorkspaceRequestDetail,
} from "@/lib/workspace-open-request";
import styles from "./token-path-chooser.module.css";

interface TokenPathChooserProps {
  open: boolean;
  selected: LaunchPath | null;
  onConfirm: (path: LaunchPath) => void;
}

export function TokenPathChooser({ open, selected, onConfirm }: TokenPathChooserProps) {
  const [pending, setPending] = useState<LaunchPath | null>(selected);
  const [wasOpen, setWasOpen] = useState(open);
  const [dismissed, setDismissed] = useState(false);

  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setPending(consumeLaunchPathPreset() ?? selected);
      setDismissed(false);
    }
  }

  useEffect(() => {
    function onWorkspaceRequest(event: Event) {
      if (!open) return;
      const { action, launchPath } = (event as CustomEvent<OpenWorkspaceRequestDetail>).detail;
      if (action !== "new" || !launchPath) return;
      consumeLaunchPathPreset();
      setPending(launchPath);
      setDismissed(false);
    }

    window.addEventListener(OPEN_WORKSPACE_REQUEST_EVENT, onWorkspaceRequest);
    return () => window.removeEventListener(OPEN_WORKSPACE_REQUEST_EVENT, onWorkspaceRequest);
  }, [open]);

  useEffect(() => {
    if (!open || dismissed) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [dismissed, open]);

  function viewPlanDetails(targetId = "plans"): void {
    setDismissed(true);
    window.requestAnimationFrame(() => {
      document.getElementById(targetId)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }

  if (!open) return null;

  if (dismissed) {
    return (
      <button
        type="button"
        className={styles.continueButton}
        style={{
          position: "fixed",
          left: "50%",
          bottom: "calc(92px + env(safe-area-inset-bottom))",
          zIndex: 1501,
          width: "min(320px, calc(100% - 32px))",
          margin: 0,
          transform: "translateX(-50%)",
        }}
        onClick={() => setDismissed(false)}
      >
        Choose a plan to continue
      </button>
    );
  }

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-labelledby="token-path-chooser-title">
      <section className={styles.panel}>
        <button
          type="button"
          className={styles.closeButton}
          aria-label="Close plan chooser"
          onClick={() => setDismissed(true)}
        >
          ×
        </button>

        <div className={styles.heading}>
          <span
            className={styles.wordmark}
            role="img"
            aria-label="Hoodlums"
            style={{
              WebkitMaskImage: `url(${HOODLUMS_WORDMARK_IMAGE})`,
              maskImage: `url(${HOODLUMS_WORDMARK_IMAGE})`,
            }}
          />
          <p className={styles.eyebrow}>CHOOSE YOUR PATH</p>
          <h2 id="token-path-chooser-title">How do you want to launch?</h2>
          <p className={styles.subheading}>
            Pick a path for this token. You can change it any time before launch.
          </p>
        </div>

        <div className={styles.columns}>
          {LAUNCH_PATH_OPTIONS.map((option) => {
            const isSelected = pending === option.id;
            const detailsLink = option.detailsLink;
            const columnClassName = [
              styles.column,
              option.featured ? styles.columnFeatured : "",
              isSelected ? styles.columnSelected : "",
              pending && !isSelected ? styles.columnDimmed : "",
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <article key={option.id} className={columnClassName}>
                {option.badge ? <span className={styles.badge}>{option.badge}</span> : null}
                <button
                  type="button"
                  className={styles.columnSelect}
                  aria-pressed={isSelected}
                  onClick={() => setPending(option.id)}
                >
                  <span className={styles.columnName}>{option.name}</span>
                  <span className={styles.columnPrice}>{option.price}</span>
                  <span className={styles.columnTagline}>{option.tagline}</span>
                  <span className={styles.columnBullets}>
                    {option.bullets.map((bullet) => (
                      <span className={styles.bullet} key={bullet}>
                        {bullet}
                      </span>
                    ))}
                  </span>
                  {option.foot ? <span className={styles.columnFoot}>{option.foot}</span> : null}
                </button>
                {detailsLink ? (
                  <button
                    type="button"
                    className={styles.columnDetailLink}
                    onClick={() => viewPlanDetails(detailsLink.targetId)}
                  >
                    {detailsLink.label}
                  </button>
                ) : null}
              </article>
            );
          })}
        </div>

        {pending ? (
          <>
            <button type="button" className={styles.continueButton} onClick={() => onConfirm(pending)}>
              Continue with {launchPathLabel(pending)}
            </button>
            <p className={styles.terms}>
              By clicking this button, you agree to the <span>Terms and Conditions</span>,{" "}
              <span>Privacy Policy</span>, and certify that you are over 18 years old.
            </p>
          </>
        ) : null}

        <button type="button" className={styles.fullDetailsLink} onClick={() => viewPlanDetails()}>
          See full plan details ↓
        </button>
      </section>
    </div>
  );
}
