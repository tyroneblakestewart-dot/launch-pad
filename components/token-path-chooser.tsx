"use client";

import { useEffect, useState } from "react";
import { HOODLUMS_WORDMARK_IMAGE } from "@/lib/hoodlums-wordmark-image";
import { LAUNCH_PATH_OPTIONS, launchPathLabel } from "@/lib/launch-paths";
import type { LaunchPath } from "@/lib/types";
import styles from "./token-path-chooser.module.css";

interface TokenPathChooserProps {
  open: boolean;
  selected: LaunchPath | null;
  preset?: LaunchPath | null;
  onConfirm: (path: LaunchPath) => void;
  onDismiss: () => void;
}

export function TokenPathChooser({
  open,
  selected,
  preset = null,
  onConfirm,
  onDismiss,
}: TokenPathChooserProps) {
  const seedSelection = preset ?? selected;
  const [pending, setPending] = useState<LaunchPath | null>(seedSelection);
  const [wasOpen, setWasOpen] = useState(open);
  const [lastSeedSelection, setLastSeedSelection] = useState(seedSelection);

  if (open !== wasOpen || (open && seedSelection !== lastSeedSelection)) {
    setWasOpen(open);
    setLastSeedSelection(seedSelection);
    if (open) setPending(seedSelection);
  }

  useEffect(() => {
    if (!open) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [open]);

  function viewPlanDetails(targetId = "plans"): void {
    onDismiss();
    window.requestAnimationFrame(() => {
      document.getElementById(targetId)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }

  if (!open) return null;

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-labelledby="token-path-chooser-title">
      <section className={styles.panel}>
        <button
          type="button"
          className={styles.closeButton}
          aria-label="Close plan chooser"
          onClick={onDismiss}
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
