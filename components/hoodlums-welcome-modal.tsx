"use client";

import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useState } from "react";
import { HOODLUMS_WELCOME_COMPLETE_IMAGE } from "@/lib/hoodlums-welcome-sharp-complete-image";
import { HOODLUMS_WORDMARK_IMAGE } from "@/lib/hoodlums-wordmark-image";
import styles from "./hoodlums-welcome-modal.module.css";

const STORAGE_KEY = "hoodlums.welcome.accepted.v5";

const CREW = [
  { id: "mari", name: "Mari", role: "The Strategist", left: "4.5%", width: "12.5%", labelX: "10.5%" },
  { id: "uncle-tuck", name: "Uncle Tuck", role: "The Distribution", left: "16.5%", width: "13%", labelX: "23%" },
  { id: "big-jon", name: "Big Jon", role: "The Muscle", left: "29%", width: "12.5%", labelX: "35%" },
  { id: "robbin", name: "Robbin’", role: "The Leader", left: "40.5%", width: "14%", labelX: "47.5%" },
  { id: "pj", name: "P.J.", role: "The Business", left: "53%", width: "11.5%", labelX: "58.8%" },
  { id: "lord-greene", name: "Lord Greene", role: "The Financier", left: "64%", width: "11.5%", labelX: "69.8%" },
  { id: "the-sheriff", name: "The Sheriff", role: "The Enforcer", left: "75%", width: "11.5%", labelX: "80.7%" },
  { id: "the-aristocrat", name: "The Aristocrat", role: "The Moneymaster", left: "85.5%", width: "13%", labelX: "92%" },
] as const;

type CrewId = (typeof CREW)[number]["id"];

type CrewStyle = CSSProperties & {
  "--hotspot-left": string;
  "--hotspot-width": string;
  "--label-x": string;
};

export function HoodlumsWelcomeModal() {
  const [open, setOpen] = useState(false);
  const [activeCrew, setActiveCrew] = useState<CrewId | null>(null);

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

  function handlePointerEnter(event: ReactPointerEvent<HTMLButtonElement>, id: CrewId) {
    if (event.pointerType === "mouse") setActiveCrew(id);
  }

  function handlePointerLeave(event: ReactPointerEvent<HTMLButtonElement>, id: CrewId) {
    if (event.pointerType === "mouse") {
      setActiveCrew((current) => (current === id ? null : current));
    }
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>, id: CrewId) {
    event.stopPropagation();
    if (event.pointerType === "mouse") return;
    setActiveCrew((current) => (current === id ? null : id));
  }

  if (!open) return null;

  return (
    <div className={styles.backdrop} role="presentation">
      <section
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="hoodlums-welcome-title"
        onPointerDownCapture={(event) => {
          const target = event.target as Element;
          if (!target.closest("[data-crew-hotspot]")) setActiveCrew(null);
        }}
      >
        <div className={styles.hero}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className={styles.crewArtwork}
            src={HOODLUMS_WELCOME_COMPLETE_IMAGE}
            alt="The Hoodlums collection"
            width={800}
            height={600}
            decoding="sync"
            fetchPriority="high"
          />

          <p className={styles.srOnly} id="crew-interaction-help">
            Hover, focus, or tap a character to reveal their name and role.
          </p>
          <p className={styles.tapHint} aria-hidden="true">Tap a character to reveal their name</p>

          {CREW.map((character) => {
            const active = activeCrew === character.id;
            const positioning = {
              "--hotspot-left": character.left,
              "--hotspot-width": character.width,
              "--label-x": character.labelX,
            } as CrewStyle;

            return (
              <div className={styles.crewInteraction} style={positioning} key={character.id}>
                <button
                  type="button"
                  className={`${styles.crewHotspot} ${active ? styles.crewHotspotActive : ""}`}
                  data-crew-hotspot={character.id}
                  aria-label={`${character.name} — ${character.role}`}
                  aria-describedby="crew-interaction-help"
                  aria-expanded={active}
                  aria-controls={`crew-label-${character.id}`}
                  onPointerEnter={(event) => handlePointerEnter(event, character.id)}
                  onPointerLeave={(event) => handlePointerLeave(event, character.id)}
                  onPointerDown={(event) => handlePointerDown(event, character.id)}
                  onFocus={() => setActiveCrew(character.id)}
                  onBlur={() => setActiveCrew((current) => (current === character.id ? null : current))}
                />

                <div
                  id={`crew-label-${character.id}`}
                  className={`${styles.crewLabel} ${active ? styles.crewLabelVisible : ""}`}
                  aria-hidden={!active}
                >
                  <span className={styles.crewName}>{character.name}</span>
                  <span className={styles.crewRole}>{character.role}</span>
                </div>
              </div>
            );
          })}
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
