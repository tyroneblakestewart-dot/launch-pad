"use client";

import { useEffect } from "react";

type SiteLayout = "split" | "poster" | "gallery" | "minimal";
type SiteMood = "bold" | "playful" | "luxury" | "clean" | "retro" | "cyber";
type SiteTexture = "none" | "grain" | "glow" | "halftone" | "gradient";

type SiteStyle = {
  background: string;
  surface: string;
  text: string;
  muted: string;
  primary: string;
  secondary: string;
  accent: string;
  layout: SiteLayout;
  mood: SiteMood;
  texture: SiteTexture;
  radius: "sharp" | "soft" | "round";
  eyebrow: string;
  headline: string;
  cta: string;
  source: "openai" | "local";
};

type GenerateDetail = {
  name: string;
  ticker: string;
  description: string;
  imageDataUrl?: string;
};

type RGB = { r: number; g: number; b: number };

const STORAGE_KEY = "launchpad.generated-site-style.v1";

function clamp(value: number, min = 0, max = 255) {
  return Math.min(max, Math.max(min, value));
}

function toHex({ r, g, b }: RGB) {
  return `#${[r, g, b]
    .map((value) => clamp(Math.round(value)).toString(16).padStart(2, "0"))
    .join("")}`;
}

function luminance({ r, g, b }: RGB) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function saturation({ r, g, b }: RGB) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

function mix(a: RGB, b: RGB, weight: number): RGB {
  return {
    r: a.r * (1 - weight) + b.r * weight,
    g: a.g * (1 - weight) + b.g * weight,
    b: a.b * (1 - weight) + b.b * weight,
  };
}

function textFor(background: RGB) {
  return luminance(background) > 0.58 ? "#111411" : "#f8f7f0";
}

function seededColour(seed: string): RGB {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return {
    r: 70 + (hash & 127),
    g: 70 + ((hash >> 8) & 127),
    b: 70 + ((hash >> 16) & 127),
  };
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The uploaded artwork could not be analysed."));
    image.src = source;
  });
}

function chooseMood(colour: RGB, averageBrightness: number): SiteMood {
  const sat = saturation(colour);
  const warm = colour.r > colour.b * 1.18 && colour.r > colour.g * 0.9;
  const neon = sat > 0.62 && averageBrightness < 0.46;
  if (neon) return "cyber";
  if (warm && sat < 0.58) return "luxury";
  if (sat > 0.66) return "playful";
  if (sat < 0.2 && averageBrightness > 0.62) return "clean";
  if (sat < 0.35) return "retro";
  return "bold";
}

async function analyseLocally(detail: GenerateDetail): Promise<SiteStyle> {
  let dominant = seededColour(`${detail.name}:${detail.ticker}`);
  let secondary = mix(dominant, { r: 255, g: 255, b: 255 }, 0.3);
  let averageBrightness = luminance(dominant);
  let aspectRatio = 1;

  if (detail.imageDataUrl) {
    const image = await loadImage(detail.imageDataUrl);
    aspectRatio = image.width / Math.max(1, image.height);
    const canvas = document.createElement("canvas");
    canvas.width = 56;
    canvas.height = 56;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context) {
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const buckets = new Map<string, { count: number; colour: RGB }>();
      let brightnessTotal = 0;
      let visible = 0;
      for (let index = 0; index < pixels.length; index += 16) {
        const alpha = pixels[index + 3];
        if (alpha < 90) continue;
        const colour = { r: pixels[index], g: pixels[index + 1], b: pixels[index + 2] };
        brightnessTotal += luminance(colour);
        visible += 1;
        const key = `${Math.round(colour.r / 32)}-${Math.round(colour.g / 32)}-${Math.round(colour.b / 32)}`;
        const current = buckets.get(key);
        if (current) current.count += 1;
        else buckets.set(key, { count: 1, colour });
      }
      averageBrightness = visible ? brightnessTotal / visible : averageBrightness;
      const ranked = [...buckets.values()]
        .filter((item) => saturation(item.colour) > 0.16)
        .sort((a, b) => b.count * (0.7 + saturation(b.colour)) - a.count * (0.7 + saturation(a.colour)));
      if (ranked[0]) dominant = ranked[0].colour;
      secondary = ranked[1]?.colour || mix(dominant, { r: 255, g: 255, b: 255 }, 0.32);
    }
  }

  const mood = chooseMood(dominant, averageBrightness);
  const darkSite = averageBrightness < 0.56 || mood === "cyber" || mood === "luxury";
  const background = darkSite
    ? mix(dominant, { r: 4, g: 6, b: 5 }, 0.82)
    : mix(dominant, { r: 250, g: 248, b: 241 }, 0.84);
  const surface = darkSite
    ? mix(background, dominant, 0.16)
    : mix(background, dominant, 0.08);
  const primary = saturation(dominant) < 0.22
    ? mix(dominant, { r: 44, g: 118, b: 255 }, 0.55)
    : dominant;
  const accent = saturation(secondary) < 0.18
    ? mix(primary, { r: 255, g: 211, b: 86 }, 0.48)
    : secondary;
  const layout: SiteLayout =
    aspectRatio < 0.84 ? "poster" : aspectRatio > 1.45 ? "split" : mood === "clean" ? "minimal" : "gallery";
  const texture: SiteTexture =
    mood === "cyber" ? "glow" : mood === "retro" ? "halftone" : mood === "clean" ? "none" : mood === "luxury" ? "gradient" : "grain";

  return {
    background: toHex(background),
    surface: toHex(surface),
    text: textFor(background),
    muted: textFor(background) === "#111411" ? "#596158" : "#aab2aa",
    primary: toHex(primary),
    secondary: toHex(secondary),
    accent: toHex(accent),
    layout,
    mood,
    texture,
    radius: mood === "clean" ? "round" : mood === "luxury" ? "soft" : "sharp",
    eyebrow: `${mood.toUpperCase()} DIGITAL COLLECTIVE`,
    headline: detail.description.split(/[.!?]/)[0]?.trim().slice(0, 82) || `${detail.name} is ready to launch.`,
    cta: `JOIN $${detail.ticker.toUpperCase()}`,
    source: "local",
  };
}

function validHex(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

function normaliseStyle(value: unknown): SiteStyle | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<SiteStyle>;
  const colours = [item.background, item.surface, item.text, item.muted, item.primary, item.secondary, item.accent];
  if (!colours.every(validHex)) return null;
  if (!(["split", "poster", "gallery", "minimal"] as string[]).includes(String(item.layout))) return null;
  if (!(["bold", "playful", "luxury", "clean", "retro", "cyber"] as string[]).includes(String(item.mood))) return null;
  if (!(["none", "grain", "glow", "halftone", "gradient"] as string[]).includes(String(item.texture))) return null;
  if (!(["sharp", "soft", "round"] as string[]).includes(String(item.radius))) return null;
  if (typeof item.eyebrow !== "string" || typeof item.headline !== "string" || typeof item.cta !== "string") return null;
  return item as SiteStyle;
}

function projectKey(detail: GenerateDetail) {
  return `${detail.name.trim().toLowerCase()}::${detail.ticker.trim().toUpperCase()}`;
}

function updateCopy(site: HTMLElement, detail: GenerateDetail, style: SiteStyle) {
  const heroEyebrow = site.querySelector<HTMLElement>(".hero-copy .terminal-line");
  const roadTitle = site.querySelector<HTMLElement>(".road-section h3");
  const buyEyebrow = site.querySelector<HTMLElement>(".buy-section .terminal-line");
  const buyTitle = site.querySelector<HTMLElement>(".buy-section h3");
  const buyButton = site.querySelector<HTMLButtonElement>(".buy-section > button");
  const cards = site.querySelectorAll<HTMLElement>(".roadmap-grid article");
  const cardContent = [
    ["01", "DISCOVER", "Share the story, artwork and purpose behind the project."],
    ["02", "LAUNCH", "Publish the token, contract details and official links."],
    ["03", "GROW", "Build community momentum with updates and milestones."],
  ];

  if (heroEyebrow) heroEyebrow.textContent = style.eyebrow;
  if (roadTitle) roadTitle.textContent = "ROADMAP";
  if (buyEyebrow) buyEyebrow.textContent = `${detail.name.toUpperCase()} COMMUNITY`;
  if (buyTitle) buyTitle.textContent = style.headline;
  if (buyButton) buyButton.textContent = style.cta;
  cards.forEach((card, index) => {
    const content = cardContent[index];
    if (!content) return;
    const number = card.querySelector("b");
    const heading = card.querySelector("h4");
    const paragraph = card.querySelector("p");
    if (number) number.textContent = content[0];
    if (heading) heading.textContent = content[1];
    if (paragraph) paragraph.textContent = content[2];
  });

  site.querySelectorAll<HTMLElement>(".ticker-tape span").forEach((span) => {
    span.textContent = `$${detail.ticker.toUpperCase()} ✦ ${detail.name.toUpperCase()} ✦ COMMUNITY POWERED ✦ `;
  });
}

function applyStyle(detail: GenerateDetail, style: SiteStyle) {
  const site = document.querySelector<HTMLElement>(".site-preview");
  if (!site) throw new Error("Website preview was not found.");

  site.classList.add("artwork-generated-site");
  site.dataset.generatedLayout = style.layout;
  site.dataset.generatedMood = style.mood;
  site.dataset.generatedTexture = style.texture;
  site.dataset.generatedRadius = style.radius;
  site.style.setProperty("--generated-bg", style.background);
  site.style.setProperty("--generated-surface", style.surface);
  site.style.setProperty("--generated-text", style.text);
  site.style.setProperty("--generated-muted", style.muted);
  site.style.setProperty("--generated-primary", style.primary);
  site.style.setProperty("--generated-secondary", style.secondary);
  site.style.setProperty("--generated-accent", style.accent);
  updateCopy(site, detail, style);

  const toolbar = document.querySelector<HTMLElement>(".preview-toolbar");
  let badge = toolbar?.querySelector<HTMLElement>(".generated-style-badge");
  if (toolbar && !badge) {
    badge = document.createElement("span");
    badge.className = "generated-style-badge";
    toolbar.appendChild(badge);
  }
  if (badge) {
    badge.textContent = `${style.source === "openai" ? "AI" : "ARTWORK"} STYLE · ${style.mood.toUpperCase()} · ${style.layout.toUpperCase()}`;
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ key: projectKey(detail), detail, style }));
  } catch {
    // The generated design still works for the current session when storage is unavailable.
  }
}

async function requestAiStyle(detail: GenerateDetail): Promise<SiteStyle | null> {
  if (!detail.imageDataUrl) return null;
  const response = await fetch("/api/generate-site-style", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(detail),
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as { style?: unknown };
  return normaliseStyle(payload.style);
}

export function ArtworkSiteGenerator() {
  useEffect(() => {
    async function onGenerate(event: Event) {
      const customEvent = event as CustomEvent<GenerateDetail>;
      const detail = customEvent.detail;
      try {
        const aiStyle = await requestAiStyle(detail).catch(() => null);
        const style = aiStyle || (await analyseLocally(detail));
        applyStyle(detail, style);
        window.dispatchEvent(new CustomEvent("launchpad:site-generated", { detail: { style } }));
      } catch (error) {
        window.dispatchEvent(
          new CustomEvent("launchpad:site-generation-failed", {
            detail: { message: error instanceof Error ? error.message : "The site could not be generated." },
          }),
        );
      }
    }

    window.addEventListener("launchpad:generate-site", onGenerate);

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const stored = JSON.parse(raw) as { detail?: GenerateDetail; style?: unknown };
        const style = normaliseStyle(stored.style);
        if (stored.detail && style) window.setTimeout(() => applyStyle(stored.detail as GenerateDetail, style), 450);
      }
    } catch {
      // Ignore stale or malformed browser-only theme data.
    }

    return () => window.removeEventListener("launchpad:generate-site", onGenerate);
  }, []);

  return (
    <style>{`
      .generated-style-badge {
        margin-left: auto;
        padding: 6px 9px;
        border: 1px solid color-mix(in srgb, var(--generated-primary, #55ff78) 42%, transparent);
        border-radius: 999px;
        color: var(--generated-primary, #55ff78);
        font: 700 8px "IBM Plex Mono", monospace;
        letter-spacing: .08em;
      }
      .artwork-generated-site {
        --generated-radius-value: 4px;
        color: var(--generated-text);
        border-color: color-mix(in srgb, var(--generated-primary) 42%, transparent);
        background: var(--generated-bg);
        box-shadow: 0 32px 110px color-mix(in srgb, var(--generated-primary) 15%, rgba(0,0,0,.65));
      }
      .artwork-generated-site[data-generated-radius="soft"] { --generated-radius-value: 16px; }
      .artwork-generated-site[data-generated-radius="round"] { --generated-radius-value: 28px; }
      .artwork-generated-site::after { opacity: .28; }
      .artwork-generated-site .matrix-rain { display: none; }
      .artwork-generated-site[data-generated-texture="glow"] .matrix-rain { display: block; color: var(--generated-primary); opacity: .1; }
      .artwork-generated-site .preview-nav {
        color: var(--generated-muted);
        border-color: color-mix(in srgb, var(--generated-primary) 25%, transparent);
        background: color-mix(in srgb, var(--generated-bg) 90%, transparent);
      }
      .artwork-generated-site .preview-nav strong,
      .artwork-generated-site .section-tag,
      .artwork-generated-site .terminal-line,
      .artwork-generated-site .graffiti-ticker,
      .artwork-generated-site .roadmap-grid b,
      .artwork-generated-site .token-stats strong {
        color: var(--generated-primary);
        text-shadow: none;
      }
      .artwork-generated-site .preview-nav button,
      .artwork-generated-site .hero-buttons button,
      .artwork-generated-site .buy-section > button {
        color: var(--generated-bg);
        background: var(--generated-primary);
        clip-path: none;
        border-radius: var(--generated-radius-value);
      }
      .artwork-generated-site .hero-buttons button.outline {
        color: var(--generated-primary);
        border-color: color-mix(in srgb, var(--generated-primary) 55%, transparent);
        background: transparent;
      }
      .artwork-generated-site .hero-section {
        background:
          radial-gradient(circle at 78% 38%, color-mix(in srgb, var(--generated-primary) 28%, transparent), transparent 35%),
          linear-gradient(115deg, var(--generated-bg), color-mix(in srgb, var(--generated-surface) 88%, transparent));
      }
      .artwork-generated-site[data-generated-texture="gradient"] .hero-section {
        background: linear-gradient(130deg, var(--generated-bg), var(--generated-surface) 48%, color-mix(in srgb, var(--generated-primary) 28%, var(--generated-bg)));
      }
      .artwork-generated-site[data-generated-texture="halftone"] .hero-section {
        background-color: var(--generated-bg);
        background-image: radial-gradient(color-mix(in srgb, var(--generated-primary) 32%, transparent) 1px, transparent 1px);
        background-size: 14px 14px;
      }
      .artwork-generated-site .hero-copy h2,
      .artwork-generated-site .preview-content h3,
      .artwork-generated-site .buy-section h3,
      .artwork-generated-site .roadmap-grid h4 {
        color: var(--generated-text);
        text-shadow: none;
        transform: none;
      }
      .artwork-generated-site[data-generated-mood="clean"] .hero-copy h2,
      .artwork-generated-site[data-generated-mood="luxury"] .hero-copy h2,
      .artwork-generated-site[data-generated-mood="clean"] .preview-content h3,
      .artwork-generated-site[data-generated-mood="luxury"] .preview-content h3 {
        font-family: "Inter", sans-serif;
        font-weight: 800;
        letter-spacing: -.055em;
      }
      .artwork-generated-site .hero-copy > p:not(.terminal-line),
      .artwork-generated-site .roadmap-grid p,
      .artwork-generated-site .social-row,
      .artwork-generated-site .terminal-card pre,
      .artwork-generated-site .token-stats span {
        color: var(--generated-muted);
      }
      .artwork-generated-site .hero-art > img {
        border-radius: var(--generated-radius-value);
        filter: drop-shadow(0 28px 45px rgba(0,0,0,.5)) drop-shadow(0 0 24px color-mix(in srgb, var(--generated-primary) 20%, transparent));
      }
      .artwork-generated-site .spray-ring {
        border-color: color-mix(in srgb, var(--generated-primary) 28%, transparent);
        box-shadow: 0 0 0 8px color-mix(in srgb, var(--generated-secondary) 7%, transparent), inset 0 0 30px color-mix(in srgb, var(--generated-primary) 12%, transparent);
      }
      .artwork-generated-site .chain-stamp { color: var(--generated-accent); border-color: var(--generated-accent); }
      .artwork-generated-site .ticker-tape {
        color: var(--generated-bg);
        border-color: var(--generated-primary);
        background: var(--generated-primary);
        transform: none;
      }
      .artwork-generated-site .preview-content,
      .artwork-generated-site .buy-section,
      .artwork-generated-site .road-section {
        color: var(--generated-text);
        border-color: color-mix(in srgb, var(--generated-primary) 20%, transparent);
        background: var(--generated-bg);
      }
      .artwork-generated-site .road-section { background: var(--generated-surface); }
      .artwork-generated-site .terminal-card,
      .artwork-generated-site .roadmap-grid article {
        border-color: color-mix(in srgb, var(--generated-primary) 25%, transparent);
        border-radius: var(--generated-radius-value);
        background: color-mix(in srgb, var(--generated-surface) 84%, transparent);
        box-shadow: none;
        transform: none;
      }
      .artwork-generated-site .terminal-bar,
      .artwork-generated-site .terminal-card pre,
      .artwork-generated-site .token-stats article {
        border-color: color-mix(in srgb, var(--generated-primary) 17%, transparent);
      }
      .artwork-generated-site[data-generated-layout="poster"] .hero-section {
        min-height: 680px;
        grid-template-columns: 1fr;
        text-align: center;
      }
      .artwork-generated-site[data-generated-layout="poster"] .hero-copy { max-width: 800px; margin: 0 auto; }
      .artwork-generated-site[data-generated-layout="poster"] .hero-copy > p:not(.terminal-line) { margin-inline: auto; }
      .artwork-generated-site[data-generated-layout="poster"] .hero-buttons { justify-content: center; }
      .artwork-generated-site[data-generated-layout="poster"] .contract-strip { margin-inline: auto; }
      .artwork-generated-site[data-generated-layout="poster"] .hero-art { order: -1; }
      .artwork-generated-site[data-generated-layout="poster"] .hero-art > img { height: 430px; }
      .artwork-generated-site[data-generated-layout="gallery"] .hero-section { grid-template-columns: .85fr 1.15fr; }
      .artwork-generated-site[data-generated-layout="gallery"] .hero-art {
        padding: 20px;
        border: 1px solid color-mix(in srgb, var(--generated-primary) 24%, transparent);
        border-radius: var(--generated-radius-value);
        background: var(--generated-surface);
      }
      .artwork-generated-site[data-generated-layout="minimal"] .ticker-tape,
      .artwork-generated-site[data-generated-layout="minimal"] .spray-ring,
      .artwork-generated-site[data-generated-layout="minimal"] .chain-stamp { display: none; }
      .artwork-generated-site[data-generated-layout="minimal"] .hero-section { min-height: 560px; padding-block: 85px; }
      .artwork-generated-site[data-generated-layout="minimal"] .preview-content { padding-block: 80px; }
      @media (max-width: 780px) {
        .generated-style-badge { display: none; }
        .artwork-generated-site[data-generated-layout] .hero-section { grid-template-columns: 1fr; text-align: left; }
        .artwork-generated-site[data-generated-layout="poster"] .hero-buttons { justify-content: flex-start; }
        .artwork-generated-site[data-generated-layout="poster"] .contract-strip { margin-inline: 0; }
        .artwork-generated-site[data-generated-layout="poster"] .hero-art > img { height: 320px; }
      }
    `}</style>
  );
}
