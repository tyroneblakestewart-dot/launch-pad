export const ARTWORK_PLACEHOLDER = "{{ARTWORK_DATA_URL}}";
export const REQUIRED_PAGE_SECTIONS = [
  "hero",
  "about",
  "tokenomics",
  "roadmap",
  "how-to-buy",
  "community",
] as const;

const MAX_GENERATED_HTML_LENGTH = 90_000;
const MIN_GENERATED_HTML_LENGTH = 3_500;
const FORBIDDEN_TEMPLATE_MARKERS = [
  "initiate_heist",
  "steal the memes",
  "the loot",
  "take from the rich. give to the memes",
];

export type GeneratedPageEvidence = {
  artworkBriefId: string;
  inspirationBriefId: string;
};

export type GeneratedPagePayload = GeneratedPageEvidence & {
  html: string;
};

export function isCompleteGeneratedPageHtml(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const html = value.trim();
  if (html.length < MIN_GENERATED_HTML_LENGTH || html.length > MAX_GENERATED_HTML_LENGTH) {
    return false;
  }

  const lower = html.toLowerCase();
  if (!lower.includes("<!doctype html") || !lower.includes("<html")) return false;
  if (!lower.includes("<head") || !lower.includes("<body")) return false;
  if (!lower.includes("<style") || !lower.includes("<script")) return false;
  if (!lower.includes('name="viewport"') && !lower.includes("name='viewport'")) return false;
  if (!html.includes(ARTWORK_PLACEHOLDER)) return false;

  for (const section of REQUIRED_PAGE_SECTIONS) {
    if (!lower.includes(`id="${section}"`) && !lower.includes(`id='${section}'`)) return false;
  }

  if (/<script\b[^>]*\bsrc\s*=/i.test(html)) return false;
  if (/<(?:iframe|object|embed)\b/i.test(html)) return false;
  if (/javascript\s*:/i.test(html)) return false;
  if (FORBIDDEN_TEMPLATE_MARKERS.some((marker) => lower.includes(marker))) return false;

  return true;
}

export function parseGeneratedPagePayload(
  value: unknown,
  expected: GeneratedPageEvidence,
): GeneratedPagePayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (item.artworkBriefId !== expected.artworkBriefId) return null;
  if (item.inspirationBriefId !== expected.inspirationBriefId) return null;
  if (!isCompleteGeneratedPageHtml(item.html)) return null;
  return {
    html: item.html,
    artworkBriefId: expected.artworkBriefId,
    inspirationBriefId: expected.inspirationBriefId,
  };
}

function escapeForHtmlAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

export function prepareGeneratedPageForPreview(html: string, artworkDataUrl: string): string {
  if (!isCompleteGeneratedPageHtml(html)) {
    throw new Error("The generated website document is incomplete.");
  }
  if (!artworkDataUrl.startsWith("data:image/")) {
    throw new Error("The uploaded artwork is unavailable for the website preview.");
  }

  const artwork = escapeForHtmlAttribute(artworkDataUrl);
  const csp = [
    "default-src 'none'",
    "img-src data:",
    "style-src 'unsafe-inline' https://fonts.googleapis.com",
    "font-src data: https://fonts.gstatic.com",
    "script-src 'unsafe-inline'",
    "connect-src 'none'",
    "media-src data:",
    "form-action 'none'",
    "base-uri 'none'",
    "frame-src 'none'",
  ].join("; ");
  const bridge = `<script>(function(){var send=function(){var h=Math.max(document.body?document.body.scrollHeight:0,document.documentElement?document.documentElement.scrollHeight:0);parent.postMessage({type:'hoodlums-generated-page-height',height:h},'*')};addEventListener('load',send);addEventListener('resize',send);new MutationObserver(send).observe(document.documentElement,{subtree:true,childList:true,attributes:true});setTimeout(send,60);setTimeout(send,500);setTimeout(send,1500)})();<\/script>`;

  let output = html.replaceAll(ARTWORK_PLACEHOLDER, artwork);
  output = output.replace(/<head([^>]*)>/i, `<head$1><meta http-equiv="Content-Security-Policy" content="${csp}">`);
  output = output.replace(/<\/body>/i, `${bridge}</body>`);
  return output;
}
