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
 * (window chrome, address pill, sidebar logo, tab row) used by the Setup,
 * Calendar and Rules slide mockups. It is aria-hidden and built only from
 * span/div/p/h3/h4/i/img — no buttons, inputs, links or textareas — so it
 * never registers as real, interactive product UI.
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
        <span className={styles.appWindowAddr}>
          hoodlums.dev<b>/social</b>
        </span>
      </div>
      <div className={styles.appWindowBody}>
        <div className={styles.appWindowSidebar}>
          <img src="/hoodlums-wordmark.svg" alt="" className={styles.appWindowSideLogo} />
          <span className={styles.appWindowSidebarLine} />
          <span className={styles.appWindowSidebarLine} />
          <span className={styles.appWindowSidebarLine} />
        </div>
        <div className={styles.appWindowChrome}>
          <div className={styles.appWindowBrandRow}>
            <img
              src="/hoodlums-social-wordmark.png"
              alt=""
              className={styles.appWindowWordmark}
            />
            <span className={styles.appWindowProBadge}>Pro · AI Social Studio</span>
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
          <div className={styles.appWindowContent}>{children}</div>
        </div>
      </div>
    </div>
  );
}

function VoiceSlideVisual() {
  return (
    <AppWindowFrame activeTab="setup">
      <div className={styles.cols}>
        <div className={styles.panel}>
          <h3 className={styles.panelTitle}>Teach the AI your voice</h3>
          <p className={styles.panelSub}>Drop in posts you like the sound of — 20 is ideal.</p>
          <div className={styles.examples}>
            <span className={styles.examplesLabel}>Example posts</span>
            <p className={styles.examplePost}>gm gm — another day, another chart to stare at. $ALLEY</p>
            <p className={styles.examplePost}>340 of you didn&apos;t sell. respect. that&apos;s the whole post.</p>
          </div>
          <div className={styles.meterRow}>
            <span className={styles.meterLabel}>Examples added</span>
            <span className={styles.meterCount}>14 / 20</span>
          </div>
          <div className={styles.meterTrack}>
            <span className={styles.meterFill} />
          </div>
          <div className={styles.learnRow}>
            <span className={styles.learnPulse} />
            <span>AI learning your voice — 14 / 20 posts analysed</span>
          </div>
          <div className={styles.traitChips}>
            <span className={styles.traitChip}>Tone · chaotic-friendly</span>
            <span className={styles.traitChip}>Slang · gm, ser, wagmi</span>
            <span className={styles.traitChip}>Emoji · 🚀 💀 🫡</span>
          </div>
        </div>
        <div className={styles.panel}>
          <h3 className={styles.panelTitle}>Voice preview</h3>
          <p className={styles.panelSub}>How it sounds writing about your project.</p>
          <div className={styles.previewCard}>
            <div className={styles.previewHead}>
              <span className={styles.previewAvatar}>H</span>
              <span className={styles.previewHandle}>
                Hoodlums
                <small>@hoodlums · draft</small>
              </span>
            </div>
            <p className={styles.previewText}>
              gm hoodlums. bags packed, curve climbing. we don&apos;t chase pumps — we print them. 🖨️
            </p>
            <div className={styles.previewArtwork}>
              <img src="/showcase/mascot-trading.png" alt="" />
            </div>
            <div className={styles.previewDests}>
              <span className={styles.previewDestActive}>X ✓</span>
              <span className={styles.previewDestActive}>Telegram ✓</span>
              <span className={styles.previewDest}>5×/day</span>
            </div>
          </div>
          <p className={styles.caption}>Every post arrives with original artwork of your mascot.</p>
        </div>
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

type CalendarDayState = "default" | "sel" | "mark";

const CALENDAR_WEEK: readonly { label: string; state: CalendarDayState }[] = [
  { label: "8", state: "default" },
  { label: "9", state: "default" },
  { label: "10", state: "default" },
  { label: "11", state: "sel" },
  { label: "12", state: "default" },
  { label: "13", state: "default" },
  { label: "14", state: "mark" },
];

const CALENDAR_DOW = ["M", "T", "W", "T", "F", "S", "S"] as const;

function calendarDayClassName(state: CalendarDayState) {
  if (state === "sel") return styles.calDaySel;
  if (state === "mark") return styles.calDayMark;
  return styles.calDay;
}

function CalendarSlideVisual() {
  return (
    <AppWindowFrame activeTab="calendar">
      <div className={styles.cols}>
        <div className={styles.panel}>
          <div className={styles.calHead}>
            <h3 className={styles.panelTitle}>August 2026</h3>
            <span className={styles.calTz}>London (GMT+1)</span>
          </div>
          <p className={styles.panelSub}>
            Tap a day to add something. Lime days hold launches or announcements.
          </p>
          <div className={styles.calDow}>
            {CALENDAR_DOW.map((day, index) => (
              <span key={`${day}-${index}`}>{day}</span>
            ))}
          </div>
          <div className={styles.calGrid}>
            {CALENDAR_WEEK.map((day) => (
              <span key={day.label} className={calendarDayClassName(day.state)}>
                {day.label}
              </span>
            ))}
          </div>
          <div className={styles.calLegend}>
            <span>
              <i className={styles.calLegendDotLaunch} />
              Announcement or launch
            </span>
            <span>
              <i className={styles.calLegendDotPost} />
              Scheduled post
            </span>
          </div>
        </div>
        <div className={styles.panel}>
          <span className={styles.addToLabel}>Add to</span>
          <p className={styles.addToDate}>11 August 2026</p>
          <div className={styles.addToOptionActive}>
            <h4>AI makes it</h4>
            <p>Describe your idea and we&apos;ll create the post and artwork.</p>
          </div>
          <div className={styles.addToOption}>
            <h4>I&apos;ll post my own</h4>
            <p>Upload or write it yourself — we&apos;ll publish it on time.</p>
          </div>
          <span className={styles.whereLabel}>Where it posts</span>
          <div className={styles.previewDests}>
            <span className={styles.previewDestActive}>X ✓</span>
            <span className={styles.previewDestActive}>Telegram ✓</span>
          </div>
          <div className={styles.quietRow}>
            <span>Quiet hours</span>
            <b>23:00 – 07:00</b>
          </div>
          <span className={styles.scheduleCta}>Schedule it</span>
        </div>
      </div>
    </AppWindowFrame>
  );
}

const RULE_ROWS = [
  { label: "Humour", options: ["Dry", "Playful", "Full degen"], activeIndex: 1 },
  { label: "Emoji", options: ["None", "A little", "Plenty"], activeIndex: 1 },
  { label: "Hashtags", options: ["Never", "One or two", "Lots"], activeIndex: 1 },
] as const;

const BANNED_WORDS = ["guaranteed", "to the moon", "financial advice"] as const;

function ControlSlideVisual() {
  return (
    <AppWindowFrame activeTab="rules">
      <div className={styles.cols}>
        <div className={styles.panel}>
          <h3 className={styles.panelTitle}>Your rules</h3>
          <p className={styles.panelSub}>The AI never crosses your lines.</p>
          <div className={styles.bannedChips}>
            {BANNED_WORDS.map((word) => (
              <span key={word} className={styles.bannedChip}>
                {word}
                <i>×</i>
              </span>
            ))}
          </div>
          {RULE_ROWS.map((rule) => (
            <div key={rule.label} className={styles.ruleRow}>
              <span className={styles.ruleLabel}>{rule.label}</span>
              <span className={styles.ruleSeg}>
                {rule.options.map((option, index) => (
                  <span
                    key={option}
                    className={
                      index === rule.activeIndex ? styles.ruleSegOptionActive : styles.ruleSegOption
                    }
                  >
                    {option}
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>
        <div className={styles.panel}>
          <h3 className={styles.panelTitle}>What&apos;s going out</h3>
          <p className={styles.panelSub}>Nothing posts until you say so — or flip to autopilot.</p>
          <div className={styles.modeToggleMini}>
            <span className={styles.modeToggleMiniActive}>Approve first</span>
            <span>Autopilot</span>
          </div>
          <div className={styles.queueCard}>
            <div className={styles.queueHead}>
              <span className={styles.queueWhen}>Today · 18:00 · X + Telegram</span>
              <span className={styles.queueBadge}>Ready</span>
            </div>
            <div className={styles.queueBody}>
              <div className={styles.queueArt}>
                <img src="/showcase/mascot-celebrating.png" alt="" />
              </div>
              <p className={styles.queueText}>
                340 wallets and not one of you has sold. genuinely moved. $ALLEY
              </p>
            </div>
            <div className={styles.queueActions}>
              <span className={styles.queuedApprove}>Approve</span>
              <span className={styles.queuedEdit}>Edit</span>
            </div>
          </div>
          <div className={styles.quietRow}>
            <span>Quiet hours</span>
            <b>23:00 – 07:00</b>
          </div>
          <p className={styles.caption}>Your rules, your banned words, your schedule.</p>
        </div>
      </div>
    </AppWindowFrame>
  );
}

const SLIDE_VISUALS: Record<(typeof SOCIAL_SHOWCASE_SLIDES)[number]["id"], () => React.JSX.Element> = {
  voice: VoiceSlideVisual,
  mascot: MascotSlideVisual,
  calendar: CalendarSlideVisual,
  control: ControlSlideVisual,
};

export function HoodlumsSocialShowcase() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isVisible, setIsVisible] = useState(true);
  const touchStartX = useRef<number | null>(null);
  const sectionRef = useRef<HTMLElement | null>(null);
  const total = SOCIAL_SHOWCASE_SLIDES.length;

  // Issue #323 part 2: auto-advancing while the showcase is scrolled off
  // screen still changed the page's total layout height (see the `.visual`
  // stacked-layer fix below) on the homepage's own clock, contributing to
  // the scroll-anchoring jumps the owner reported elsewhere on the page.
  // Pausing while off screen removes that background clock entirely.
  useEffect(() => {
    if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") return;
    const node = sectionRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(([entry]) => setIsVisible(entry.isIntersecting), {
      threshold: 0,
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isVisible) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const timer = window.setInterval(() => {
      setActiveIndex((current) => nextShowcaseIndex(current, total));
    }, SOCIAL_SHOWCASE_AUTO_ADVANCE_MS);

    return () => window.clearInterval(timer);
  }, [total, activeIndex, isVisible]);

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

  return (
    <section
      id="social-studio-showcase"
      className={styles.section}
      aria-labelledby="social-showcase-title"
      ref={sectionRef}
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
            {/* Every slide's visual mockup stays mounted, stacked in the
                same grid cell (see .visual/.visualLayer in the module CSS),
                so the container's height is always the CSS-computed max
                across all four — rotating slides can never change this
                section's layout height (issue #323 part 2). Only the active
                one is visible and reachable. */}
            <div className={styles.visual}>
              {SOCIAL_SHOWCASE_SLIDES.map((visualSlide, index) => {
                const SlideVisual = SLIDE_VISUALS[visualSlide.id];
                const active = index === activeIndex;
                return (
                  <div
                    key={visualSlide.id}
                    className={active ? styles.visualLayer : `${styles.visualLayer} ${styles.visualLayerHidden}`}
                    aria-hidden={active ? undefined : true}
                  >
                    <SlideVisual />
                  </div>
                );
              })}
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
