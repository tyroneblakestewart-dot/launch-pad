import { createHash } from "node:crypto";
import { isCompleteGeneratedPageHtml } from "@/lib/generated-site-page";
import { decodeArtworkDataUrl } from "@/lib/server/public-site-artwork";
import type { ProjectStatus, SupportedChain } from "@/lib/types";

export const MAX_PUBLISHED_HTML_BYTES = 90_000;
export const MAX_ARTWORK_REFERENCE_BYTES = 8_100_000;

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const STATUS_VALUES = new Set<ProjectStatus>(["draft", "prepared", "launched"]);
const SAFE_NOOP_SCRIPT = "<script>void 0;</script>";

export type PublishableSite = {
  slug: string;
  name: string;
  ticker: string;
  description: string;
  supply: string;
  decimals: number;
  chain: SupportedChain;
  chainId: string;
  contractAddress: string;
  generatedSiteHtml: string;
  artworkReference: string;
  xHandle: string;
  telegram: string;
  status: ProjectStatus;
};

export type PublishableSiteValidation =
  | { valid: true; site: PublishableSite }
  | { valid: false; reason: string };

function cleanText(value: unknown, maximumLength: number, fallback = ""): string | null {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  if (cleaned.length > maximumLength || CONTROL_CHARACTERS.test(cleaned)) return null;
  return cleaned;
}

function quotedAttribute(name: string): RegExp {
  return new RegExp(`\\s${name}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)`, "gi");
}

/**
 * Sanitises the generated standalone document before storage and again before
 * serving. All model-authored JavaScript and inline handlers are removed; the
 * only executable code later added to the public iframe is the trusted height
 * bridge from `prepareGeneratedPageForPreview`. CSS presentation and animation
 * remain available inside the existing sandbox/CSP.
 */
export function sanitisePublishedGeneratedHtml(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (Buffer.byteLength(value, "utf8") > MAX_PUBLISHED_HTML_BYTES) return null;
  if (!isCompleteGeneratedPageHtml(value)) return null;

  let output = value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<base\b[^>]*>/gi, "")
    .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?(?:refresh|content-security-policy)["']?[^>]*>/gi, "")
    .replace(/<link\b(?![^>]*href\s*=\s*["']https:\/\/fonts\.googleapis\.com\/)[^>]*>/gi, "")
    .replace(quotedAttribute("on[a-z]+"), "")
    .replace(quotedAttribute("srcdoc"), "")
    .replace(quotedAttribute("formaction"), "")
    .replace(quotedAttribute("action"), "")
    .replace(quotedAttribute("href"), "")
    .replace(quotedAttribute("ping"), "")
    .replace(quotedAttribute("target"), "")
    .replace(quotedAttribute("download"), "")
    .replace(/@import\s+(?:url\()?\s*["']?https?:[^;\n]+;?/gi, "")
    .replace(/url\(\s*["']?https?:\/\/[^)]*\)/gi, "url()")
    .replace(/(?:javascript|vbscript)\s*:/gi, "");

  output = output.replace(/<\/body\s*>/i, `${SAFE_NOOP_SCRIPT}</body>`).trim();
  if (Buffer.byteLength(output, "utf8") > MAX_PUBLISHED_HTML_BYTES) return null;
  return isCompleteGeneratedPageHtml(output) ? output : null;
}

/** Stable hash of the exact normalised and sanitised content a wallet authorises. */
export function hashPublishableSite(site: PublishableSite): string {
  const canonical = JSON.stringify({
    slug: site.slug,
    name: site.name,
    ticker: site.ticker,
    description: site.description,
    supply: site.supply,
    decimals: site.decimals,
    chain: site.chain,
    chainId: site.chainId,
    contractAddress: site.contractAddress,
    generatedSiteHtml: site.generatedSiteHtml,
    artworkReference: site.artworkReference,
    xHandle: site.xHandle,
    telegram: site.telegram,
    status: site.status,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function normalisePublishableSite(value: unknown): PublishableSiteValidation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, reason: "A complete site payload is required." };
  }

  const item = value as Record<string, unknown>;
  const slug = cleanText(item.slug, 48);
  const name = cleanText(item.name, 80);
  const ticker = cleanText(item.ticker, 12);
  const description = cleanText(item.description, 1_000);
  const supply = cleanText(item.supply, 80);
  const contractAddress = cleanText(item.contractAddress, 128);
  const xHandle = cleanText(item.xHandle, 128);
  const telegram = cleanText(item.telegram, 256);

  if (!slug || !name || name.length < 2) {
    return { valid: false, reason: "The slug and token name are required." };
  }
  if (!ticker || !/^[A-Za-z0-9]{2,12}$/.test(ticker)) {
    return { valid: false, reason: "The ticker must contain 2–12 letters or numbers." };
  }
  if (!description || description.length < 20) {
    return { valid: false, reason: "The project description must contain at least 20 characters." };
  }
  if (!supply || !/^\d{1,80}$/.test(supply) || BigInt(supply) <= 0n) {
    return { valid: false, reason: "The published supply must be a positive integer." };
  }
  if (contractAddress === null || xHandle === null || telegram === null) {
    return { valid: false, reason: "One of the optional project fields is too long or contains control characters." };
  }
  if (contractAddress && !/^[A-Za-z0-9]+$/.test(contractAddress)) {
    return { valid: false, reason: "The contract address contains unsupported characters." };
  }

  const decimals = Number(item.decimals);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    return { valid: false, reason: "Decimals must be an integer between 0 and 255." };
  }

  const chain = item.chain;
  if (chain !== "robinhood" && chain !== "solana") {
    return { valid: false, reason: "The published chain is not supported." };
  }
  const expectedChainId = chain === "robinhood" ? "46630" : "solana-devnet";
  const chainId = cleanText(item.chainId, 64);
  if (chainId !== expectedChainId) {
    return { valid: false, reason: `The ${chain} chain identifier must be ${expectedChainId}.` };
  }

  const status = item.status === undefined ? "prepared" : item.status;
  if (typeof status !== "string" || !STATUS_VALUES.has(status as ProjectStatus)) {
    return { valid: false, reason: "The project status is invalid." };
  }

  const generatedSiteHtml = sanitisePublishedGeneratedHtml(item.generatedSiteHtml);
  if (!generatedSiteHtml) {
    return { valid: false, reason: "The generated site HTML is incomplete, unsafe, or too large." };
  }

  if (typeof item.artworkReference !== "string") {
    return { valid: false, reason: "A valid artwork reference is required." };
  }
  const artworkReference = item.artworkReference.trim();
  if (Buffer.byteLength(artworkReference, "utf8") > MAX_ARTWORK_REFERENCE_BYTES) {
    return { valid: false, reason: "The artwork reference is too large." };
  }
  if (!decodeArtworkDataUrl(artworkReference)) {
    return { valid: false, reason: "The artwork must be a valid PNG, JPEG, WebP, or GIF within the size limit." };
  }

  return {
    valid: true,
    site: {
      slug,
      name,
      ticker: ticker.toUpperCase(),
      description,
      supply,
      decimals,
      chain,
      chainId,
      contractAddress,
      generatedSiteHtml,
      artworkReference,
      xHandle,
      telegram,
      status: status as ProjectStatus,
    },
  };
}
