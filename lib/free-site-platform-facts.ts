// Substitutes platform facts (contract address, Dexscreener chart, LP
// locked status) into a stored free-site document at request time, instead
// of baking them in at generation time. This file is isomorphic — no
// node:fs, no server-only imports — so both the server-rendered `/[slug]`
// route and the client-side studio preview can call the exact same
// function against the exact same placeholder-bearing HTML (issue #173).
//
// User-supplied data (X handle, Telegram, website) is never handled here:
// it is resolved once at generation time by lib/free-site-template.ts and
// omitted entirely when blank, never shown as "coming soon".

export type FreeSiteChartFact =
  | { found: true; url: string; dexId: string; liquidityLabel: string }
  | { found: false };

export type FreeSitePlatformFacts = {
  contractAddress: string;
  chart: FreeSiteChartFact;
  /** ISO timestamp once liquidity is locked at graduation, otherwise null. */
  lpLockedAt: string | null;
};

// A stable marker the free-site template writes right after <body ...>, so
// callers that hold a generated document (of unknown origin) can tell
// whether it is safe to run this substitution at all. The bespoke
// (paid AI) pipeline never writes this marker, so its pages pass through
// selectBlock/replaceAll below completely unchanged.
export const FREE_SITE_TEMPLATE_MARKER = "<!--HOODLUMS_FREE_SITE_TEMPLATE-->";

export function isFreeSiteTemplateHtml(html: string): boolean {
  return html.includes(FREE_SITE_TEMPLATE_MARKER);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildDexscreenerSearchUrl(address: string): string {
  const trimmed = address.trim();
  return trimmed ? `https://dexscreener.com/search?q=${encodeURIComponent(trimmed)}` : "";
}

export function formatLiquidityLabel(value: number): string {
  if (!value) return "Liquidity detected";
  return `${new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value)} liquidity`;
}

/**
 * Selects one side of a `<!--NAME_START-->..<!--NAME_END-->` marker pair,
 * dropping the marker comments either way. Leaves the HTML untouched when
 * the markers are absent: a stored page from before this marker existed,
 * or one from a different pipeline entirely, passes through unchanged
 * instead of throwing.
 */
function selectBlock(html: string, name: string, keep: boolean): string {
  const start = `<!--${name}_START-->`;
  const end = `<!--${name}_END-->`;
  const startIndex = html.indexOf(start);
  const endIndex = html.indexOf(end, startIndex);
  if (startIndex === -1 || endIndex === -1) return html;
  if (keep) {
    return (
      html.slice(0, startIndex) +
      html.slice(startIndex + start.length, endIndex) +
      html.slice(endIndex + end.length)
    );
  }
  return html.slice(0, startIndex) + html.slice(endIndex + end.length);
}

function formatLockedDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

export function substituteFreeSitePlatformFacts(html: string, facts: FreeSitePlatformFacts): string {
  const contractAddress = facts.contractAddress.trim();
  const hasContract = contractAddress !== "";

  let output = html;
  output = selectBlock(output, "CONTRACT_KNOWN", hasContract);
  output = selectBlock(output, "CONTRACT_PENDING", !hasContract);
  output = selectBlock(output, "BUY_KNOWN", hasContract);
  output = selectBlock(output, "BUY_PENDING", !hasContract);
  output = selectBlock(output, "FOOTER_CONTRACT_KNOWN", hasContract);
  output = selectBlock(output, "FOOTER_CONTRACT_PENDING", !hasContract);

  const buyHref = hasContract
    ? facts.chart.found
      ? facts.chart.url
      : buildDexscreenerSearchUrl(contractAddress)
    : "";
  output = output.replaceAll("{{CONTRACT_ADDRESS}}", escapeHtml(contractAddress));
  output = output.replaceAll("{{BUY_HREF}}", escapeHtml(buyHref));

  output = selectBlock(output, "CHART_FOUND", facts.chart.found);
  output = selectBlock(output, "CHART_UNKNOWN", !facts.chart.found);
  output = selectBlock(output, "CHART_SEARCH_LINK", hasContract);
  output = output.replaceAll("{{CHART_URL}}", escapeHtml(facts.chart.found ? facts.chart.url : ""));
  output = output.replaceAll("{{CHART_DEX_ID}}", escapeHtml(facts.chart.found ? facts.chart.dexId : ""));
  output = output.replaceAll(
    "{{CHART_LIQUIDITY}}",
    escapeHtml(facts.chart.found ? facts.chart.liquidityLabel : ""),
  );
  output = output.replaceAll(
    "{{CHART_SEARCH_URL}}",
    escapeHtml(hasContract ? buildDexscreenerSearchUrl(contractAddress) : ""),
  );

  const hasLpLocked = Boolean(facts.lpLockedAt);
  output = selectBlock(output, "LP_LOCKED", hasLpLocked);
  output = output.replaceAll(
    "{{LP_LOCKED_DATE}}",
    escapeHtml(facts.lpLockedAt ? formatLockedDate(facts.lpLockedAt) : ""),
  );

  return output;
}
