"use client";

import { useEffect, useState } from "react";
import { HOODLUMS_WORDMARK_IMAGE } from "@/lib/hoodlums-wordmark-image";
import { LAUNCH_PATH_OPTIONS, launchPathLabel } from "@/lib/launch-paths";
import type { LaunchPath } from "@/lib/types";
import styles from "./token-path-chooser.module.css";

interface TokenPathChooserProps {
  open: boolean;
  selected: LaunchPath | null;
  onConfirm: (path: LaunchPath) => void;
}

export function TokenPathChooser({ open, selected, onConfirm }: TokenPathChooserProps) {
  const [pending, setPending] = useState<LaunchPath | null>(selected);
  const [wasOpen, setWasOpen] = useState(open);

  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setPending(selected);
  }

  useEffect(() => {
    if (!open) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-labelledby="token-path-chooser-title">
      <section className={styles.panel}>
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
            const columnClassName = [
              styles.column,
              option.recommended ? styles.columnRecommended : "",
              isSelected ? styles.columnSelected : "",
              pending && !isSelected ? styles.columnDimmed : "",
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <button
                key={option.id}
                type="button"
                className={columnClassName}
                aria-pressed={isSelected}
                onClick={() => setPending(option.id)}
              >
                {option.recommended && <span className={styles.badge}>Recommended</span>}
                <span className={styles.columnName}>{option.name}</span>
                <span className={styles.columnPrice}>{option.price}</span>
                <p className={styles.columnTagline}>{option.tagline}</p>
                <span className={styles.columnBullets}>
                  {option.bullets.map((bullet) => (
                    <span className={styles.bullet} key={bullet}>
                      {bullet}
                    </span>
                  ))}
                </span>
              </button>
            );
          })}
        </div>

        {pending && (
          <>
            <button type="button" className={styles.continueButton} onClick={() => onConfirm(pending)}>
              Continue with {launchPathLabel(pending)}
            </button>
            <p className={styles.terms}>
              By clicking this button, you agree to the <span>Terms and Conditions</span>,{" "}
              <span>Privacy Policy</span>, and certify that you are over 18 years old.
            </p>
          </>
        )}
      </section>
    </div>
  );
}
