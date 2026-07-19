"use client";

import { useEffect, useState } from "react";
import { HOODLUMS_WORDMARK_IMAGE } from "@/lib/hoodlums-wordmark-image";
import styles from "./hoodlums-welcome-modal.module.css";

const STORAGE_KEY = "hoodlums.welcome.accepted.v1";

export function HoodlumsWelcomeModal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (localStorage.getItem(STORAGE_KEY) !== "true") setOpen(true);
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!open) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [open]);

  function continueToApp() {
    localStorage.setItem(STORAGE_KEY, "true");
    setOpen(false);
  }

  if (!open) return null;

  return (
    <div className={styles.backdrop} role="presentation">
      <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="hoodlums-welcome-title">
        <div className={styles.hero} aria-label="HOODLUMS">
          <span
            className={styles.wordmark}
            style={{
              WebkitMaskImage: `url(${HOODLUMS_WORDMARK_IMAGE})`,
              maskImage: `url(${HOODLUMS_WORDMARK_IMAGE})`,
            }}
          />
        </div>

        <div className={styles.copy}>
          <h1 id="hoodlums-welcome-title">Welcome to Hoodlums!</h1>
          <p>
            Hoodlums lets anyone create token websites and prepare their launch from one clean workspace,
            giving creators a simple way to build and grow their project from the start. Launch and trade carefully.
          </p>
        </div>

        <button type="button" className={styles.continueButton} onClick={continueToApp}>
          Continue
        </button>

        <p className={styles.terms}>
          By clicking this button, you agree to the <span>Terms and Conditions</span>, <span>Privacy Policy</span>,
          and certify that you are over 18 years old.
        </p>
      </section>
    </div>
  );
}
