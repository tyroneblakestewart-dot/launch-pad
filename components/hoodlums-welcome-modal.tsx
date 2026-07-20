"use client";

import { useEffect, useState } from "react";
import { createHoodlumsWelcomeSharpImageUrl } from "@/lib/hoodlums-welcome-sharp-image";
import { HOODLUMS_WORDMARK_IMAGE } from "@/lib/hoodlums-wordmark-image";
import styles from "./hoodlums-welcome-modal.module.css";

const STORAGE_KEY = "hoodlums.welcome.accepted.v3";

export function HoodlumsWelcomeModal() {
  const [open, setOpen] = useState(false);
  const [crewImageUrl, setCrewImageUrl] = useState("");

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (localStorage.getItem(STORAGE_KEY) !== "true") setOpen(true);
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!open) return;

    const imageUrl = createHoodlumsWelcomeSharpImageUrl();
    setCrewImageUrl(imageUrl);
    return () => {
      URL.revokeObjectURL(imageUrl);
      setCrewImageUrl("");
    };
  }, [open]);

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
        <div className={styles.hero} aria-busy={!crewImageUrl}>
          {crewImageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={crewImageUrl}
              alt="The Hoodlums collection"
              width={1024}
              height={768}
              decoding="sync"
              fetchPriority="high"
            />
          )}
        </div>

        <div className={styles.copy}>
          <div className={styles.titleRow}>
            <h1 id="hoodlums-welcome-title">Welcome</h1>
            <span
              className={styles.titleWordmark}
              role="img"
              aria-label="Hoodlums"
              style={{
                WebkitMaskImage: `url(${HOODLUMS_WORDMARK_IMAGE})`,
                maskImage: `url(${HOODLUMS_WORDMARK_IMAGE})`,
              }}
            />
          </div>

          <p>
            Hoodlums lets anyone create tokens and generate a website tailored to each project from one clean
            workspace, giving creators a simple way to build and grow from the start.
          </p>
          <strong className={styles.revolution}>Be a part of the revolution.</strong>
          <p className={styles.caution}>Launch and trade carefully.</p>
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
