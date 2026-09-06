// Real links on the bespoke (paid AI) site (owner direction, 6 Sep 2026:
// "add that to bespoke"). The free-site template has always used the real X /
// Telegram handles and serve-time Buy / explorer placeholders; the bespoke
// pipeline used to receive only name / ticker / story / artwork and so either
// invented outbound links or left them out. Now:
//
//   1. the prompt tells the model the exact href placeholders to use (and
//      which social handles genuinely exist), never a guessed URL;
//   2. `enforceBespokeLinks` runs on the generated document server-side: it
//      fills the X / Telegram placeholders with the real handles (known at
//      generation time), rewrites any social / DEX / explorer link the model
//      invented anyway onto the same placeholders, and stamps the page with a
//      marker;
//   3. the served /[slug] page and the studio preview substitute the Buy /
//      explorer / contract placeholders at render time, exactly like the free
//      site — the contract address is only known after launch.
//
// Pure and client-safe (the preview runs it in the browser).

import type { SupportedChain } from "@/lib/types";
import { buildContractExplorerUrl, buildHoodlumsTradeUrl } from "@/lib/free-site-platform-facts";

export const BESPOKE_LINKS_MARKER = "<!--HOODLUMS_BESPOKE_LINKS-->";

export const BESPOKE_LINK_PLACEHOLDERS = {
  buy: "{{BUY_HREF}}",
  trade: "{{TRADE_URL}}",
  explorer: "{{EXPLORER_URL}}",
  contract: "{{CONTRACT_ADDRESS}}",
  xHref: "{{X_HREF}}",
  xHandle: "{{X_HANDLE}}",
  telegramHref: "{{TELEGRAM_HREF}}",
  telegram: "{{TELEGRAM}}",
} as const;

/** What a page shows when the contract is not known yet. */
export const CONTRACT_PENDING_LABEL = "Contract address published at launch";

export type BespokeSocialFacts = {
  xHandle: string;
  telegram: string;
};

export type BespokePlatformFacts = {
  contractAddress: string;
  chain?: SupportedChain;
};

const HANDLE_PATTERN = /^[A-Za-z0-9_]{1,32}$/;

/**
 * "@hoodlums", "hoodlums", "x.com/hoodlums", "https://twitter.com/hoodlums/",
 * "t.me/hoodlums?start=1" and "https://www.x.com/@hoodlums" all become
 * "hoodlums". Anything that is not a plain handle after stripping becomes ""
 * so it can never be written into an href.
 */
export function normaliseSocialHandle(raw: string, domainPrefixes: readonly string[]): string {
  let value = raw.trim();
  value = value.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  const lower = value.toLowerCase();
  for (const prefix of domainPrefixes) {
    if (lower.startsWith(prefix)) {
      value = value.slice(prefix.length);
      break;
    }
  }
  value = value.replace(/^@+/, "");
  // A trailing path, query or fragment is dropped; anything else that is not a
  // plain handle (a space, a tag, a stray domain) fails the pattern below.
  value = value.split(/[/?#]/)[0] ?? "";
  return HANDLE_PATTERN.test(value) ? value : "";
}

export const X_HANDLE_PREFIXES = ["x.com/", "twitter.com/"] as const;
export const TELEGRAM_HANDLE_PREFIXES = ["t.me/", "telegram.me/"] as const;

export function normaliseXHandle(raw: string): string {
  return normaliseSocialHandle(raw, X_HANDLE_PREFIXES);
}

export function normaliseTelegramHandle(raw: string): string {
  return normaliseSocialHandle(raw, TELEGRAM_HANDLE_PREFIXES);
}

export function xProfileUrl(handle: string): string {
  return handle ? `https://x.com/${handle}` : "";
}

export function telegramUrl(handle: string): string {
  return handle ? `https://t.me/${handle}` : "";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Prompt lines for the bespoke page: exact placeholders, never invented URLs. */
export function buildBespokeLinkRules(facts: BespokeSocialFacts): string[] {
  const xHandle = normaliseXHandle(facts.xHandle);
  const telegram = normaliseTelegramHandle(facts.telegram);
  const lines = [
    "LINKS (NON-NEGOTIABLE — the application fills these in; never invent a URL):",
    `- Every buy / trade / swap / "get $TICKER" call-to-action is an <a> whose href is exactly ${BESPOKE_LINK_PLACEHOLDERS.buy}. Do not link to Dexscreener, Uniswap, Raydium, Jupiter, pump.fun or any other venue.`,
    `- Where you show the contract address, print exactly ${BESPOKE_LINK_PLACEHOLDERS.contract} as the text and link it with href="${BESPOKE_LINK_PLACEHOLDERS.explorer}" (the block explorer). Never make up an address.`,
  ];
  if (xHandle) {
    lines.push(
      `- The project's X account is @${xHandle}: link it with href="${BESPOKE_LINK_PLACEHOLDERS.xHref}" and show it as @${BESPOKE_LINK_PLACEHOLDERS.xHandle}.`,
    );
  } else {
    lines.push("- No X account was supplied: do not include any X / Twitter link or handle.");
  }
  if (telegram) {
    lines.push(
      `- The project's Telegram is t.me/${telegram}: link it with href="${BESPOKE_LINK_PLACEHOLDERS.telegramHref}" and show it as t.me/${BESPOKE_LINK_PLACEHOLDERS.telegram}.`,
    );
  } else {
    lines.push("- No Telegram was supplied: do not include any Telegram link.");
  }
  lines.push(
    '- Every outbound link opens in a new tab: target="_blank" rel="noopener noreferrer". In-page anchors (#about, #how-to-buy, …) are fine and encouraged for navigation.',
    "- No other external links of any kind (no Discord, Medium, GitHub, YouTube, CoinGecko, CoinMarketCap, explorers or wallets).",
  );
  return lines;
}

const SOCIAL_X_HOSTS = ["x.com", "twitter.com", "mobile.twitter.com"];
const SOCIAL_TELEGRAM_HOSTS = ["t.me", "telegram.me", "telegram.org"];
const BUY_VENUE_HOSTS = [
  "dexscreener.com",
  "dextools.io",
  "uniswap.org",
  "app.uniswap.org",
  "pump.fun",
  "raydium.io",
  "jup.ag",
  "jupiter.exchange",
  "birdeye.so",
  "geckoterminal.com",
  "coingecko.com",
  "coinmarketcap.com",
  "pancakeswap.finance",
  "sushi.com",
  "1inch.io",
];
const EXPLORER_HOSTS = ["blockscout.com", "etherscan.io", "solscan.io", "solana.fm", "explorer.solana.com", "basescan.org", "arbiscan.io"];

function hostMatches(host: string, hosts: readonly string[]): boolean {
  return hosts.some((known) => host === known || host.endsWith(`.${known}`));
}

function hostOf(href: string): string | null {
  try {
    const url = new URL(href);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Server-side, after the page passes every other gate: fills the social
 * placeholders with the real handles, re-aims any social / venue / explorer
 * URL the model invented onto the same placeholders (so it can never point at
 * the wrong account or the wrong exchange), and stamps the marker the serving
 * code looks for. Buy / explorer / contract placeholders stay for serve time.
 */
export function enforceBespokeLinks(html: string, facts: BespokeSocialFacts): string {
  const xHandle = normaliseXHandle(facts.xHandle);
  const telegram = normaliseTelegramHandle(facts.telegram);

  let output = html.replace(/href\s*=\s*(["'])(.*?)\1/gi, (match, quote: string, rawHref: string) => {
    const href = rawHref.trim();
    if (href.startsWith("{{")) return match;
    const host = hostOf(href);
    if (!host) return match;
    if (hostMatches(host, SOCIAL_X_HOSTS)) return `href=${quote}${BESPOKE_LINK_PLACEHOLDERS.xHref}${quote}`;
    if (hostMatches(host, SOCIAL_TELEGRAM_HOSTS)) return `href=${quote}${BESPOKE_LINK_PLACEHOLDERS.telegramHref}${quote}`;
    if (hostMatches(host, BUY_VENUE_HOSTS)) return `href=${quote}${BESPOKE_LINK_PLACEHOLDERS.buy}${quote}`;
    if (hostMatches(host, EXPLORER_HOSTS)) return `href=${quote}${BESPOKE_LINK_PLACEHOLDERS.explorer}${quote}`;
    return match;
  });

  // An invented social link with no real handle behind it goes nowhere ("#")
  // rather than to a stranger's account.
  output = output.replaceAll(BESPOKE_LINK_PLACEHOLDERS.xHref, escapeHtml(xProfileUrl(xHandle) || "#"));
  output = output.replaceAll(BESPOKE_LINK_PLACEHOLDERS.xHandle, escapeHtml(xHandle));
  output = output.replaceAll(BESPOKE_LINK_PLACEHOLDERS.telegramHref, escapeHtml(telegramUrl(telegram) || "#"));
  output = output.replaceAll(BESPOKE_LINK_PLACEHOLDERS.telegram, escapeHtml(telegram));

  if (!output.includes(BESPOKE_LINKS_MARKER)) {
    output = output.replace(/<body\b[^>]*>/i, (bodyTag) => `${bodyTag}${BESPOKE_LINKS_MARKER}`);
  }
  return output;
}

export function isBespokeLinksHtml(html: string): boolean {
  return html.includes(BESPOKE_LINKS_MARKER);
}

/** Serve-time: the Buy / explorer / contract placeholders, from the launch facts known now. */
export function substituteBespokePlatformFacts(html: string, facts: BespokePlatformFacts): string {
  const contractAddress = facts.contractAddress.trim();
  const hasContract = contractAddress !== "";
  const chain = facts.chain ?? "robinhood";
  const tradeUrl = hasContract ? buildHoodlumsTradeUrl(chain, contractAddress) : "#";
  const explorerUrl = hasContract ? buildContractExplorerUrl(chain, contractAddress) : "#";
  return html
    .replaceAll(BESPOKE_LINK_PLACEHOLDERS.buy, escapeHtml(tradeUrl))
    .replaceAll(BESPOKE_LINK_PLACEHOLDERS.trade, escapeHtml(tradeUrl))
    .replaceAll(BESPOKE_LINK_PLACEHOLDERS.explorer, escapeHtml(explorerUrl))
    .replaceAll(BESPOKE_LINK_PLACEHOLDERS.contract, escapeHtml(hasContract ? contractAddress : CONTRACT_PENDING_LABEL));
}
