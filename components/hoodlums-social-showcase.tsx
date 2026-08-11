/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useRef, useState, type TouchEvent } from "react";
import {
  SOCIAL_SHOWCASE_AUTO_ADVANCE_MS,
  SOCIAL_SHOWCASE_CTA_LABEL,
  SOCIAL_SHOWCASE_MASCOT_SCENES,
  SOCIAL_SHOWCASE_SLIDES,
  clampShowcaseIndex,
  nextShowcaseIndex,
  swipeDeltaToStep,
} from "@/lib/social-showcase";
import { requestWorkspaceOpen } from "@/lib/workspace-open-request";
import styles from "./hoodlums-social-showcase.module.css";

function MascotSlot({ label, src }: { label: string; src: string }) {
  const [failed, setFailed] = useState(false);

  return (
    <div className={styles.mascotSlot}>
      {failed ? (
        <div className={styles.mascotPlaceholder} aria-hidden="true">
          <svg viewBox="0 0 24 24" width="26" height="26">
            <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5Zm2.2 12.3 4-5 3 3.2 2.6-3.6 4 5.4M9 9.6a1.6 1.6 0 1 1-3.2 0 1.6 1.6 0 0 1 3.2 0Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          </svg>
        </div>
      ) : (
        <img
          src={src}
          alt={`${label} mascot scene`}
          className={styles.mascotImage}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      )}
      <span className={styles.mascotLabel}>{label}</span>
    </div>
  );
}

const APP_WINDOW_TABS = [
  { id: "setup", label: "Setup" },
  { id: "calendar", label: "Calendar" },
  { id: "queue", label: "Queue" },
  { id: "rules", label: "Rules" },
] as const;

type AppWindowTabId = (typeof APP_WINDOW_TABS)[number]["id"];

/**
 * Decorative, non-interactive recreation of the AI Social Studio app shell
 * (window chrome, tab row, sidebar hint) used by the Setup and Rules slide
 * visuals. It is aria-hidden and built from non-focusable elements only —
 * it must never register as real product UI.
 */
function AppWindowFrame({
  activeTab,
  children,
}: {
  activeTab: AppWindowTabId;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.appWindow} aria-hidden="true">
      <div className={styles.appWindowTitlebar}>
        <span className={styles.appWindowDots}>
          <i />
          <i />
          <i />
        </span>
        <span className={styles.appWindowLabel}>AI Social Studio</span>
      </div>
      <div className={styles.appWindowTabs}>
        {APP_WINDOW_TABS.map((tab) => (
          <span
            key={tab.id}
            className={tab.id === activeTab ? styles.appWindowTabActive : styles.appWindowTab}
          >
            {tab.label}
          </span>
        ))}
      </div>
      <div className={styles.appWindowBody}>
        <div className={styles.appWindowSidebar}>
          <span className={styles.appWindowSidebarDot} />
          <span className={styles.appWindowSidebarLine} />
          <span className={styles.appWindowSidebarLine} />
          <span className={styles.appWindowSidebarLine} />
        </div>
        <div className={styles.appWindowContent}>{children}</div>
      </div>
    </div>
  );
}

function VoiceSlideVisual() {
  return (
    <AppWindowFrame activeTab="setup">
      <div className={styles.dropZone}>
        <span className={styles.dropZoneLabel}>Example posts</span>
        <p className={styles.dropZonePost}>gm gm — another day, another chart to stare at. $ALLEY</p>
        <p className={styles.dropZonePost}>340 of you didn&apos;t sell. respect. that&apos;s the whole post.</p>
      </div>
      <div className={styles.learningState}>
        <div className={styles.learningLabel}>
          <span>AI learning your voice</span>
          <b>14 / 20 posts analysed</b>
        </div>
        <div className={styles.learningTrack}>
          <span className={styles.learningFill} />
        </div>
      </div>
      <div className={styles.traitChips}>
        <span className={styles.traitChip}>Tone · chaotic-friendly</span>
        <span className={styles.traitChip}>Slang · gm, ser, wagmi</span>
        <span className={styles.traitChip}>Emoji · 🚀 💀 🫡</span>
      </div>
    </AppWindowFrame>
  );
}

function MascotSlideVisual() {
  return (
    <div className={styles.mascotGrid}>
      {SOCIAL_SHOWCASE_MASCOT_SCENES.map((scene) => (
        <MascotSlot key={scene.label} label={scene.label} src={scene.src} />
      ))}
    </div>
  );
}

const SCHEDULE_DAYS = [
  { label: "M", active: true },
  { label: "T", active: false },
  { label: "W", active: true },
  { label: "T", active: false },
  { label: "F", active: true },
  { label: "S", active: false },
  { label: "S", active: false },
] as const;

function ControlSlideVisual() {
  return (
    <AppWindowFrame activeTab="rules">
      <div className={styles.modeToggleMini}>
        <span>Autopilot</span>
        <span className={styles.modeToggleMiniActive}>Approve first</span>
      </div>
      <div className={styles.queuedPost}>
        <div className={styles.queuedPostMeta}>
          <span>Today · 18:00</span>
          <span className={styles.queuedPostDivider} />
          <span>X + Telegram</span>
        </div>
        <p>340 wallets and not one of you has sold. genuinely moved. $ALLEY</p>
        <div className={styles.queuedPostActions}>
          <span className={styles.queuedApprove}>Approve</span>
          <span className={styles.queuedEdit}>Edit</span>
        </div>
      </div>
      <div className={styles.bannedChips}>
        <span className={styles.bannedChip}>
          guaranteed<i>×</i>
        </span>
        <span className={styles.bannedChip}>
          to the moon<i>×</i>
        </span>
        <span className={styles.bannedChip}>
          financial advice<i>×</i>
        </span>
      </div>
      <div className={styles.scheduleStrip}>
        {SCHEDULE_DAYS.map((day, index) => (
          <span
            key={`${day.label}-${index}`}
            className={day.active ? styles.scheduleDayActive : styles.scheduleDay}
          >
            {day.label}
          </span>
        ))}
      </div>
    </AppWindowFrame>
  );
}

const SLIDE_VISUALS: Record<(typeof SOCIAL_SHOWCASE_SLIDES)[number]["id"], () => React.JSX.Element> = {
  voice: VoiceSlideVisual,
  mascot: MascotSlideVisual,
  control: ControlSlideVisual,
};

export function HoodlumsSocialShowcase() {
  const [activeIndex, setActiveIndex] = useState(0);
  const touchStartX = useRef<number | null>(null);
  const total = SOCIAL_SHOWCASE_SLIDES.length;

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const timer = window.setInterval(() => {
      setActiveIndex((current) => nextShowcaseIndex(current, total));
    }, SOCIAL_SHOWCASE_AUTO_ADVANCE_MS);

    return () => window.clearInterval(timer);
  }, [total, activeIndex]);

  function goToSlide(index: number) {
    setActiveIndex(clampShowcaseIndex(index, total));
  }

  function handleTouchStart(event: TouchEvent<HTMLDivElement>) {
    touchStartX.current = event.touches[0]?.clientX ?? null;
  }

  function handleTouchEnd(event: TouchEvent<HTMLDivElement>) {
    const startX = touchStartX.current;
    touchStartX.current = null;
    if (startX === null) return;

    const endX = event.changedTouches[0]?.clientX ?? startX;
    const step = swipeDeltaToStep(endX - startX);
    if (step !== 0) goToSlide(activeIndex + step);
  }

  function handleCtaClick() {
    requestWorkspaceOpen("new", "pro");
  }

  const slide = SOCIAL_SHOWCASE_SLIDES[activeIndex];
  const SlideVisual = SLIDE_VISUALS[slide.id];

  return (
    <section
      id="social-studio-showcase"
      className={styles.section}
      aria-labelledby="social-showcase-title"
    >
      <div className={styles.glow} aria-hidden="true" />
      <div className={styles.inner}>
        <header className={styles.heading}>
          <span className={styles.eyebrow}>Hoodlums Pro · AI Social Studio</span>
          <h2 id="social-showcase-title">Your token&apos;s marketing, running while you sleep.</h2>
        </header>

        <div
          className={styles.carousel}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <article key={slide.id} className={styles.slide}>
            <span className={styles.step}>{slide.step}</span>
            <h3 className={styles.title}>{slide.title}</h3>
            <div className={styles.visual}>
              <SlideVisual />
            </div>
            <p className={styles.body}>{slide.body}</p>
            <div className={styles.actions}>
              <button type="button" className={styles.cta} onClick={handleCtaClick}>
                {SOCIAL_SHOWCASE_CTA_LABEL}
              </button>
              <div className={styles.dots} role="tablist" aria-label="Showcase slides">
                {SOCIAL_SHOWCASE_SLIDES.map((dotSlide, dotIndex) => (
                  <button
                    key={dotSlide.id}
                    type="button"
                    role="tab"
                    aria-selected={dotIndex === activeIndex}
                    aria-label={`Show slide ${dotIndex + 1}: ${dotSlide.title}`}
                    className={dotIndex === activeIndex ? styles.dotActive : styles.dot}
                    onClick={() => goToSlide(dotIndex)}
                  />
                ))}
              </div>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
