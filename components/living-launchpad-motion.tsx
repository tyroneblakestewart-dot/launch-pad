"use client";

import { useEffect } from "react";

const CODE_COLUMNS = Array.from({ length: 34 }, (_, index) => ({
  left: `${(index / 34) * 100}%`,
  delay: `${-((index * 1.37) % 12)}s`,
  duration: `${8 + (index % 7) * 1.15}s`,
  text: index % 3 === 0 ? "01\n10\n$\nAI\n00\n11\nWEB3" : "10\n01\n◆\n11\n00\n01\nTOKEN",
}));

const AMBIENT_ORBS = Array.from({ length: 8 }, (_, index) => ({
  left: `${8 + ((index * 17) % 84)}%`,
  top: `${7 + ((index * 23) % 82)}%`,
  delay: `${-(index * 1.7)}s`,
  size: `${140 + (index % 4) * 70}px`,
}));

const SITE_PARTICLES = Array.from({ length: 22 }, (_, index) => ({
  left: `${4 + ((index * 29) % 92)}%`,
  top: `${5 + ((index * 37) % 90)}%`,
  delay: `${-((index * 0.83) % 9)}s`,
  size: `${2 + (index % 4)}px`,
}));

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function LivingLaunchpadMotion() {
  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const root = document.documentElement;
    const boundTilt = new WeakSet<Element>();
    let frame = 0;
    let observer: IntersectionObserver | null = null;

    function setReducedMotion() {
      root.classList.toggle("motion-reduced", reducedMotion.matches);
    }

    function ensureSiteLayer() {
      const site = document.querySelector<HTMLElement>(".site-preview");
      if (!site) return;
      site.classList.add("living-site");

      if (!site.querySelector(".living-site-background")) {
        const layer = document.createElement("div");
        layer.className = "living-site-background";
        layer.setAttribute("aria-hidden", "true");
        layer.innerHTML = `
          <div class="living-code-field">
            ${CODE_COLUMNS.map(
              (column) =>
                `<span class="living-code-column" style="left:${column.left};animation-delay:${column.delay};animation-duration:${column.duration}">${column.text.replaceAll("\n", "<br />")}</span>`,
            ).join("")}
          </div>
          <div class="living-particle-field">
            ${SITE_PARTICLES.map(
              (particle) =>
                `<i style="left:${particle.left};top:${particle.top};width:${particle.size};height:${particle.size};animation-delay:${particle.delay}"></i>`,
            ).join("")}
          </div>
          <div class="living-grid-plane"></div>
          <div class="living-scan-beam"></div>
          <div class="living-site-progress"><span></span></div>
        `;
        site.prepend(layer);
      }
    }

    function bindRevealElements() {
      if (!observer) return;
      const selectors = [
        ".builder-panel > *",
        ".preview-toolbar",
        ".site-preview .preview-nav",
        ".site-preview .hero-copy > *",
        ".site-preview .hero-art",
        ".site-preview .ticker-tape",
        ".site-preview .preview-content > *",
        ".site-preview .terminal-card",
        ".site-preview .roadmap-grid article",
        ".site-preview .buy-section > *",
      ];

      document.querySelectorAll<HTMLElement>(selectors.join(",")).forEach((element, index) => {
        if (element.dataset.motionBound === "true") return;
        element.dataset.motionBound = "true";
        element.classList.add("motion-reveal");
        element.style.setProperty("--motion-delay", `${Math.min(index % 7, 5) * 55}ms`);
        observer?.observe(element);
      });
    }

    function bindTiltCards() {
      const selector = [
        ".terminal-card",
        ".roadmap-grid article",
        ".readiness-card",
        ".upload-box",
        ".build-site-gate",
        ".chain-option",
      ].join(",");

      document.querySelectorAll<HTMLElement>(selector).forEach((element) => {
        if (boundTilt.has(element)) return;
        boundTilt.add(element);

        element.addEventListener("pointermove", (event) => {
          if (reducedMotion.matches) return;
          const pointer = event as PointerEvent;
          const rect = element.getBoundingClientRect();
          const x = clamp((pointer.clientX - rect.left) / Math.max(rect.width, 1));
          const y = clamp((pointer.clientY - rect.top) / Math.max(rect.height, 1));
          element.style.setProperty("--tilt-y", `${(x - 0.5) * 5}deg`);
          element.style.setProperty("--tilt-x", `${(0.5 - y) * 4}deg`);
          element.style.setProperty("--glow-x", `${x * 100}%`);
          element.style.setProperty("--glow-y", `${y * 100}%`);
        });

        element.addEventListener("pointerleave", () => {
          element.style.setProperty("--tilt-y", "0deg");
          element.style.setProperty("--tilt-x", "0deg");
        });
      });
    }

    function refreshBindings() {
      ensureSiteLayer();
      bindRevealElements();
      bindTiltCards();
    }

    function updateMotion() {
      frame = 0;
      const documentHeight = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
      const pageProgress = clamp(window.scrollY / documentHeight);
      root.style.setProperty("--page-progress", String(pageProgress));
      root.style.setProperty("--page-progress-percent", `${pageProgress * 100}%`);

      const site = document.querySelector<HTMLElement>(".site-preview");
      if (site) {
        const rect = site.getBoundingClientRect();
        const travel = Math.max(rect.height + window.innerHeight, 1);
        const siteProgress = clamp((window.innerHeight - rect.top) / travel);
        site.style.setProperty("--site-scroll", String(siteProgress));
        site.style.setProperty("--site-progress-percent", `${siteProgress * 100}%`);
      }
    }

    function requestMotionUpdate() {
      if (frame) return;
      frame = window.requestAnimationFrame(updateMotion);
    }

    function onPointerMove(event: PointerEvent) {
      if (reducedMotion.matches) return;
      const x = clamp(event.clientX / Math.max(window.innerWidth, 1));
      const y = clamp(event.clientY / Math.max(window.innerHeight, 1));
      root.style.setProperty("--pointer-x", String(x));
      root.style.setProperty("--pointer-y", String(y));

      const site = document.querySelector<HTMLElement>(".site-preview");
      if (!site) return;
      const rect = site.getBoundingClientRect();
      const siteX = clamp((event.clientX - rect.left) / Math.max(rect.width, 1));
      const siteY = clamp((event.clientY - rect.top) / Math.max(rect.height, 1));
      site.style.setProperty("--site-pointer-x", String(siteX - 0.5));
      site.style.setProperty("--site-pointer-y", String(siteY - 0.5));
    }

    setReducedMotion();
    reducedMotion.addEventListener("change", setReducedMotion);

    observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          (entry.target as HTMLElement).classList.add("motion-visible");
          observer?.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -8%", threshold: 0.08 },
    );

    const mutationObserver = new MutationObserver(refreshBindings);
    mutationObserver.observe(document.body, { childList: true, subtree: true });

    window.addEventListener("scroll", requestMotionUpdate, { passive: true });
    window.addEventListener("resize", requestMotionUpdate, { passive: true });
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    document.querySelector(".builder-panel")?.addEventListener("scroll", requestMotionUpdate, {
      passive: true,
    });

    refreshBindings();
    updateMotion();

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer?.disconnect();
      mutationObserver.disconnect();
      reducedMotion.removeEventListener("change", setReducedMotion);
      window.removeEventListener("scroll", requestMotionUpdate);
      window.removeEventListener("resize", requestMotionUpdate);
      window.removeEventListener("pointermove", onPointerMove);
      root.classList.remove("motion-reduced");
      root.style.removeProperty("--page-progress");
      root.style.removeProperty("--page-progress-percent");
      document.querySelector(".living-site-background")?.remove();
      document.querySelector(".site-preview")?.classList.remove("living-site");
    };
  }, []);

  return (
    <>
      <div className="studio-ambient" aria-hidden="true">
        <div className="studio-grid" />
        <div className="studio-code-streams">
          {CODE_COLUMNS.slice(0, 18).map((column, index) => (
            <span
              key={index}
              style={{
                left: column.left,
                animationDelay: column.delay,
                animationDuration: column.duration,
              }}
            >
              {column.text}
            </span>
          ))}
        </div>
        <div className="studio-orbs">
          {AMBIENT_ORBS.map((orb, index) => (
            <i
              key={index}
              style={{
                left: orb.left,
                top: orb.top,
                width: orb.size,
                height: orb.size,
                animationDelay: orb.delay,
              }}
            />
          ))}
        </div>
        <div className="studio-pointer-glow" />
      </div>
      <div className="studio-scroll-meter" aria-hidden="true">
        <span />
      </div>
      <style>{`
        .studio-ambient {
          position: fixed;
          inset: 0;
          z-index: 0;
          overflow: hidden;
          pointer-events: none;
          background:
            radial-gradient(circle at calc(var(--pointer-x, .72) * 100%) calc(var(--pointer-y, .15) * 100%), rgba(85,255,120,.1), transparent 24rem),
            linear-gradient(180deg, #050706, #030504 72%);
        }
        .app-shell { position: relative; z-index: 1; background: transparent !important; isolation: isolate; }
        .studio-grid {
          position: absolute;
          inset: -20%;
          opacity: .28;
          background-image:
            linear-gradient(rgba(85,255,120,.045) 1px, transparent 1px),
            linear-gradient(90deg, rgba(85,255,120,.045) 1px, transparent 1px);
          background-size: 58px 58px;
          transform: perspective(900px) rotateX(62deg) translateY(calc(var(--page-progress, 0) * -90px));
          transform-origin: center 28%;
          mask-image: linear-gradient(to bottom, transparent, black 18%, black 72%, transparent);
          animation: living-grid-drift 18s linear infinite;
        }
        .studio-code-streams { position: absolute; inset: 0; opacity: .06; }
        .studio-code-streams span {
          position: absolute;
          top: -260px;
          white-space: pre-line;
          color: var(--green);
          font: 8px/1.5 var(--mono);
          text-shadow: 0 0 10px rgba(85,255,120,.7);
          animation: living-code-fall 12s linear infinite;
        }
        .studio-orbs i {
          position: absolute;
          border-radius: 50%;
          opacity: .13;
          background: radial-gradient(circle at 35% 35%, rgba(85,255,120,.7), rgba(33,184,74,.08) 54%, transparent 72%);
          filter: blur(14px);
          animation: living-orb-float 14s ease-in-out infinite alternate;
        }
        .studio-pointer-glow {
          position: absolute;
          width: 460px;
          height: 460px;
          left: calc(var(--pointer-x, .7) * 100% - 230px);
          top: calc(var(--pointer-y, .2) * 100% - 230px);
          border-radius: 50%;
          opacity: .2;
          background: radial-gradient(circle, rgba(85,255,120,.2), transparent 68%);
          filter: blur(8px);
          transition: left .2s ease-out, top .2s ease-out;
        }
        .studio-scroll-meter {
          position: fixed;
          z-index: 95;
          left: 0;
          right: 0;
          top: 0;
          height: 2px;
          pointer-events: none;
          background: rgba(85,255,120,.06);
        }
        .studio-scroll-meter span {
          display: block;
          width: var(--page-progress-percent, 0%);
          height: 100%;
          background: linear-gradient(90deg, var(--green-2), var(--green), var(--gold));
          box-shadow: 0 0 16px var(--green);
        }
        .topbar {
          border-bottom-color: rgba(85,255,120,.28) !important;
          box-shadow: 0 12px 45px rgba(0,0,0,.3), 0 1px 0 rgba(85,255,120,.04) inset;
        }
        .topbar::after {
          content: "";
          position: absolute;
          left: -30%;
          bottom: -1px;
          width: 28%;
          height: 1px;
          background: linear-gradient(90deg, transparent, var(--green), transparent);
          animation: living-border-scan 7s linear infinite;
        }
        .brand-mark { animation: living-brand-pulse 4s ease-in-out infinite; }
        .safe-badge i, .live-dot { animation: living-status-pulse 1.8s ease-in-out infinite; }
        .notice-bar { position: relative; overflow: hidden; backdrop-filter: blur(12px); }
        .notice-bar::after {
          content: "";
          position: absolute;
          inset: 0;
          width: 35%;
          background: linear-gradient(90deg, transparent, rgba(85,255,120,.08), transparent);
          transform: translateX(-130%);
          animation: living-notice-sweep 8s ease-in-out infinite;
          pointer-events: none;
        }
        .builder-panel {
          position: relative;
          background: linear-gradient(180deg, rgba(9,13,10,.93), rgba(7,11,8,.86)) !important;
          backdrop-filter: blur(20px);
        }
        .builder-panel::before {
          content: "";
          position: fixed;
          width: 460px;
          height: 460px;
          left: calc(var(--pointer-x, .2) * 250px - 230px);
          top: calc(var(--pointer-y, .4) * 80vh - 230px);
          border-radius: 50%;
          background: radial-gradient(circle, rgba(85,255,120,.055), transparent 68%);
          pointer-events: none;
        }
        .preview-panel {
          position: relative;
          background: linear-gradient(135deg, rgba(8,11,9,.9), rgba(3,6,4,.78)) !important;
          backdrop-filter: blur(12px);
        }
        .panel-heading, .build-site-gate-heading { position: relative; }
        .panel-heading::after {
          content: "";
          position: absolute;
          left: 0;
          right: 0;
          bottom: -13px;
          height: 1px;
          opacity: .45;
          background: linear-gradient(90deg, var(--green), transparent 72%);
          transform: scaleX(calc(.12 + var(--page-progress, 0) * .88));
          transform-origin: left;
        }
        .primary-button, .wallet-button, .build-site-button:not(:disabled) {
          position: relative;
          overflow: hidden;
        }
        .primary-button::after, .wallet-button::after, .build-site-button:not(:disabled)::after {
          content: "";
          position: absolute;
          inset: -2px;
          background: linear-gradient(105deg, transparent 34%, rgba(255,255,255,.34), transparent 66%);
          transform: translateX(-130%);
          animation: living-button-sheen 5.5s ease-in-out infinite;
          pointer-events: none;
        }
        .upload-box, .readiness-card, .build-site-gate, .terminal-card, .roadmap-grid article, .chain-option {
          --tilt-x: 0deg;
          --tilt-y: 0deg;
          transform: perspective(900px) rotateX(var(--tilt-x)) rotateY(var(--tilt-y));
          transform-style: preserve-3d;
          transition: transform .22s ease, border-color .22s ease, box-shadow .22s ease;
        }
        .upload-box::after, .readiness-card::after, .build-site-gate::after, .terminal-card::after, .roadmap-grid article::after {
          content: "";
          position: absolute;
          inset: 0;
          border-radius: inherit;
          opacity: 0;
          background: radial-gradient(circle at var(--glow-x, 50%) var(--glow-y, 50%), rgba(85,255,120,.11), transparent 45%);
          transition: opacity .2s ease;
          pointer-events: none;
        }
        .upload-box:hover::after, .readiness-card:hover::after, .build-site-gate:hover::after, .terminal-card:hover::after, .roadmap-grid article:hover::after { opacity: 1; }
        .upload-box:hover, .readiness-card:hover, .build-site-gate:hover, .terminal-card:hover, .roadmap-grid article:hover {
          border-color: color-mix(in srgb, var(--generated-primary, var(--green)) 48%, transparent) !important;
          box-shadow: 0 18px 48px rgba(0,0,0,.28), 0 0 25px color-mix(in srgb, var(--generated-primary, var(--green)) 9%, transparent);
        }
        .motion-reveal {
          opacity: 0;
          transform: translate3d(0, 20px, 0) scale(.985);
          filter: blur(5px);
          transition:
            opacity .7s cubic-bezier(.2,.75,.2,1) var(--motion-delay, 0ms),
            transform .8s cubic-bezier(.2,.75,.2,1) var(--motion-delay, 0ms),
            filter .6s ease var(--motion-delay, 0ms);
        }
        .motion-reveal.motion-visible { opacity: 1; transform: translate3d(0,0,0) scale(1); filter: blur(0); }
        .site-preview.living-site { isolation: isolate; }
        .living-site-background {
          position: absolute;
          inset: 0;
          z-index: 0;
          overflow: hidden;
          pointer-events: none;
          color: var(--generated-primary, var(--green));
        }
        .living-code-field, .living-particle-field, .living-grid-plane { position: absolute; inset: 0; }
        .living-code-field {
          opacity: .1;
          mask-image: linear-gradient(to bottom, black, transparent 92%);
          transform: translateY(calc(var(--site-scroll, 0) * -70px));
        }
        .living-code-column {
          position: absolute;
          top: -260px;
          color: currentColor;
          font: 8px/1.42 var(--mono);
          text-shadow: 0 0 8px currentColor;
          animation: living-code-fall linear infinite;
        }
        .living-particle-field i {
          position: absolute;
          border-radius: 50%;
          color: currentColor;
          background: currentColor;
          box-shadow: 0 0 12px currentColor;
          opacity: .28;
          animation: living-particle-float 7s ease-in-out infinite alternate;
        }
        .living-grid-plane {
          inset: 28% -20% -28%;
          opacity: .13;
          background-image:
            linear-gradient(currentColor 1px, transparent 1px),
            linear-gradient(90deg, currentColor 1px, transparent 1px);
          background-size: 48px 48px;
          transform: perspective(700px) rotateX(66deg) translateY(calc(var(--site-scroll, 0) * -90px));
          transform-origin: top;
          mask-image: linear-gradient(to bottom, transparent, black 22%, transparent 88%);
        }
        .living-scan-beam {
          position: absolute;
          left: 0;
          right: 0;
          top: -8%;
          height: 14%;
          opacity: .12;
          background: linear-gradient(to bottom, transparent, currentColor, transparent);
          filter: blur(10px);
          animation: living-site-scan 8s linear infinite;
        }
        .living-site-progress {
          position: sticky;
          top: 0;
          z-index: 30;
          height: 2px;
          background: color-mix(in srgb, currentColor 8%, transparent);
        }
        .living-site-progress span {
          display: block;
          width: var(--site-progress-percent, 0%);
          height: 100%;
          background: linear-gradient(90deg, currentColor, var(--generated-accent, var(--gold)));
          box-shadow: 0 0 12px currentColor;
        }
        .living-site .preview-nav { position: sticky; top: 0; z-index: 25; }
        .living-site .hero-art {
          transform: translate3d(calc(var(--site-pointer-x, 0) * 22px), calc(var(--site-pointer-y, 0) * 16px + var(--site-scroll, 0) * -26px), 0);
          transition: transform .16s ease-out;
        }
        .living-site .hero-copy {
          transform: translate3d(calc(var(--site-pointer-x, 0) * -9px), calc(var(--site-pointer-y, 0) * -7px), 0);
          transition: transform .2s ease-out;
        }
        .living-site .hero-art > img { animation: living-art-breathe 5.5s ease-in-out infinite; }
        .living-site .spray-ring { animation: living-ring-turn 18s linear infinite; }
        .living-site .ticker-tape span { animation-duration: 11s; }
        .living-site .terminal-line::after {
          content: "_";
          margin-left: 4px;
          animation: living-cursor-blink .9s steps(1) infinite;
        }
        .living-site .token-stats strong { animation: living-text-glow 3.4s ease-in-out infinite; }
        .living-site .roadmap-grid article:nth-child(2) { animation-delay: .12s; }
        .living-site .roadmap-grid article:nth-child(3) { animation-delay: .24s; }
        .artwork-generated-site[data-generated-mood="clean"] .living-code-field,
        .artwork-generated-site[data-generated-mood="luxury"] .living-code-field { opacity: .035; }
        .artwork-generated-site[data-generated-mood="clean"] .living-grid-plane { opacity: .055; }
        .artwork-generated-site[data-generated-mood="cyber"] .living-code-field { opacity: .22; }
        .artwork-generated-site[data-generated-mood="cyber"] .living-scan-beam { opacity: .22; animation-duration: 5.5s; }
        .artwork-generated-site[data-generated-mood="playful"] .living-particle-field i { animation-duration: 4.5s; opacity: .48; }
        .artwork-generated-site[data-generated-mood="luxury"] .living-particle-field i { opacity: .18; box-shadow: 0 0 18px var(--generated-accent, var(--gold)); }
        @keyframes living-grid-drift { to { background-position: 58px 58px; } }
        @keyframes living-code-fall { to { transform: translateY(1500px); } }
        @keyframes living-orb-float { to { transform: translate3d(42px,-36px,0) scale(1.12); } }
        @keyframes living-particle-float { to { transform: translate3d(15px,-28px,0) scale(1.8); opacity: .08; } }
        @keyframes living-border-scan { to { transform: translateX(520%); } }
        @keyframes living-brand-pulse { 50% { box-shadow: 0 0 34px rgba(85,255,120,.24), inset 0 0 20px rgba(85,255,120,.12); transform: rotate(1deg) scale(1.03); } }
        @keyframes living-status-pulse { 50% { opacity: .45; transform: scale(.72); box-shadow: 0 0 18px var(--green); } }
        @keyframes living-notice-sweep { 45%,100% { transform: translateX(360%); } }
        @keyframes living-button-sheen { 42%,100% { transform: translateX(145%); } }
        @keyframes living-site-scan { to { transform: translateY(950%); } }
        @keyframes living-art-breathe { 50% { transform: translateY(-8px) scale(1.018); filter: drop-shadow(0 30px 42px rgba(0,0,0,.72)) drop-shadow(0 0 28px color-mix(in srgb, var(--generated-primary, var(--green)) 18%, transparent)); } }
        @keyframes living-ring-turn { to { transform: rotate(346deg); } }
        @keyframes living-cursor-blink { 50% { opacity: 0; } }
        @keyframes living-text-glow { 50% { text-shadow: 0 0 14px color-mix(in srgb, var(--generated-primary, var(--green)) 48%, transparent); } }
        @media (max-width: 780px) {
          .studio-code-streams { opacity: .035; }
          .studio-grid { background-size: 42px 42px; }
          .living-site .hero-art, .living-site .hero-copy { transform: none; }
          .living-code-field { opacity: .065; }
          .preview-nav { position: relative !important; }
        }
        @media (prefers-reduced-motion: reduce) {
          .studio-ambient *, .living-site-background *, .brand-mark, .safe-badge i, .live-dot,
          .primary-button::after, .wallet-button::after, .build-site-button::after,
          .living-site .hero-art > img, .living-site .spray-ring, .living-site .terminal-line::after,
          .living-site .token-stats strong { animation: none !important; }
          .motion-reveal { opacity: 1 !important; transform: none !important; filter: none !important; transition: none !important; }
          .upload-box, .readiness-card, .build-site-gate, .terminal-card, .roadmap-grid article, .chain-option { transform: none !important; }
          .living-site .hero-art, .living-site .hero-copy { transform: none !important; }
        }
      `}</style>
    </>
  );
}
