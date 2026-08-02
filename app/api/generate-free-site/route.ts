import { NextResponse } from "next/server";
import {
  buildFreeSiteDesignRequestBody,
  parseFreeSiteDesignResponse,
} from "@/lib/free-site-openai-pipeline";
import {
  FREE_SITE_SECTION_DEFAULTS,
  FREE_SITE_SECTION_KEYS,
  renderFreeSiteTemplate,
  type FreeSiteFacts,
  type FreeSiteSections,
} from "@/lib/free-site-template";
import { isCompleteGeneratedPageHtml } from "@/lib/generated-site-page";
import {
  getVercelOidcToken,
  resolveAIResponsesRuntime,
  type AIResponsesRuntime,
} from "@/lib/server/ai-responses-runtime";
import {
  GENERATE_SITE_STYLE_LIMIT,
  consumeGenerateSiteStyleRateLimit,
  getClientIp,
  isGenerateSiteStyleRequestAuthorised,
} from "@/lib/server/api-protection";
import { sanitiseProviderDetail } from "@/lib/server/sanitise-provider-detail";
import {
  isValidImageDataUrl,
  normaliseGenerateSiteStyleRequest,
  type GenerateSiteStyleRequest,
  type OpenAIResponse,
} from "@/lib/server/generate-site-style";
import { buildPageArtworkIdentityRequestBody } from "@/lib/site-page-openai-pipeline";
import { requestArtworkIdentity } from "@/lib/server/artwork-identity-request";
import { getServiceIsolationResponse } from "@/lib/server/service-isolation";

// The studio form already collects these alongside name/ticker/description;
// the free-site template renders them as verified facts and never asks the
// model to write them. See lib/free-site-template.ts (FreeSiteFacts) and
// issue #163.
// contractAddress is intentionally not read here: it is a platform fact
// resolved at request time from the published_sites row, not baked into
// the generated HTML at generation time (issue #173). The studio may still
// send it as part of the shared request payload; it is simply ignored.
type GenerateFreeSiteRequest = GenerateSiteStyleRequest & {
  supply?: unknown;
  decimals?: unknown;
  xHandle?: unknown;
  telegram?: unknown;
  sections?: unknown;
};

function stringFact(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// Buy tax, sell tax, mint authority and ownership are fixed by
// contracts/FixedSupplyMemeToken.sol (a plain ERC20 + ERC20Burnable with no
// transfer hook, no owner and no external mint function) and never vary
// per launch, so they are hard-coded here rather than read from the request.
function buildFreeSiteFacts(body: GenerateFreeSiteRequest): FreeSiteFacts {
  const decimals = Number(body.decimals);
  return {
    supply: stringFact(body.supply),
    decimals: Number.isFinite(decimals) ? decimals : 0,
    buyTax: "0%",
    sellTax: "0%",
    mintAuthority: "None",
    ownership: "No owner",
    xHandle: stringFact(body.xHandle),
    telegram: stringFact(body.telegram),
  };
}

// The studio sends a toggle per optional section; hero is always on and is
// never part of this set. Missing or malformed values fall back to the
// studio's own default (about + tokenomics on, the rest off — issue #171)
// so older clients that predate this field keep working unchanged.
function buildFreeSiteSections(body: GenerateFreeSiteRequest): FreeSiteSections {
  const raw =
    body.sections && typeof body.sections === "object" && !Array.isArray(body.sections)
      ? (body.sections as Record<string, unknown>)
      : {};
  const sections = {} as FreeSiteSections;
  for (const key of FREE_SITE_SECTION_KEYS) {
    sections[key] = typeof raw[key] === "boolean" ? (raw[key] as boolean) : FREE_SITE_SECTION_DEFAULTS[key];
  }
  return sections;
}

export const runtime = "nodejs";
export const maxDuration = 60;

const ARTWORK_TIMEOUT_MS = 18_000;
const DESIGN_TIMEOUT_MS = 35_000;

type ProviderResult =
  | { ok: true; payload: OpenAIResponse }
  | {
      ok: false;
      kind: "network" | "http" | "invalid";
      status?: number;
      detail?: string;
    };

function noStoreHeaders(extra: Record<string, string> = {}) {
  return { "Cache-Control": "no-store", ...extra };
}

async function requestProvider(
  ai: AIResponsesRuntime,
  body: unknown,
  timeoutMs: number,
): Promise<ProviderResult> {
  let response: Response;
  try {
    response = await fetch(ai.responsesUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ai.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return { ok: false, kind: "network", detail: sanitiseProviderDetail(error) };
  }

  if (!response.ok) {
    return { ok: false, kind: "http", status: response.status };
  }

  try {
    return { ok: true, payload: (await response.json()) as OpenAIResponse };
  } catch {
    return { ok: false, kind: "invalid" };
  }
}

function isTimeoutFailure(failure: { kind: string; detail?: string }): boolean {
  if (failure.kind !== "network") return false;
  return /\b(?:abort|aborted|timeout|timed out)\b/i.test(failure.detail || "");
}

function describeProviderFailure(failure: {
  kind: "network" | "http" | "invalid";
  status?: number;
  detail?: string;
}): string {
  if (isTimeoutFailure(failure)) return "timeout";
  if (failure.kind === "http") return `http ${failure.status}`;
  return failure.kind;
}

export async function POST(request: Request) {
  const sharedSecret = process.env.GENERATE_SITE_STYLE_SHARED_SECRET || "";
  const allowedOrigin =
    process.env.GENERATE_SITE_STYLE_ALLOWED_ORIGIN || "https://hoodlums.dev";
  const protectionEnabled = Boolean(sharedSecret);

  if (!protectionEnabled && process.env.NODE_ENV !== "test") {
    return NextResponse.json(
      { error: "Website generation access protection is not configured." },
      { status: 503, headers: noStoreHeaders() },
    );
  }

  let rateHeaders: Record<string, string> = {};
  if (protectionEnabled) {
    if (!isGenerateSiteStyleRequestAuthorised(request, sharedSecret, allowedOrigin)) {
      return NextResponse.json(
        { error: "Unauthorised website-generation request." },
        { status: 401, headers: noStoreHeaders() },
      );
    }

    const rate = consumeGenerateSiteStyleRateLimit(getClientIp(request));
    rateHeaders = {
      "RateLimit-Limit": String(GENERATE_SITE_STYLE_LIMIT),
      "RateLimit-Remaining": String(rate.remaining),
      "RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)),
    };
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Website generation rate limit exceeded. Try again later." },
        {
          status: 429,
          headers: noStoreHeaders({
            ...rateHeaders,
            "Retry-After": String(rate.retryAfterSeconds),
          }),
        },
      );
    }
  }

  const isolationResponse = await getServiceIsolationResponse("website-generation");
  if (isolationResponse) return isolationResponse;

  const ai = resolveAIResponsesRuntime(
    process.env,
    getVercelOidcToken(request),
  );
  if (!ai) {
    return NextResponse.json(
      {
        error:
          "AI website generation is unavailable because neither OpenAI nor Vercel AI Gateway authentication is available.",
      },
      { status: 503, headers: noStoreHeaders(rateHeaders) },
    );
  }

  let body: GenerateFreeSiteRequest;
  try {
    body = (await request.json()) as GenerateFreeSiteRequest;
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400, headers: noStoreHeaders(rateHeaders) },
    );
  }

  const input = normaliseGenerateSiteStyleRequest(body);
  if (!isValidImageDataUrl(input.imageDataUrl)) {
    return NextResponse.json(
      { error: "A valid optimised artwork image is required." },
      { status: 400, headers: noStoreHeaders(rateHeaders) },
    );
  }

  const artworkBody = buildPageArtworkIdentityRequestBody(input, ai.model);
  const artworkResult = await requestArtworkIdentity(
    () => requestProvider(ai, artworkBody, ARTWORK_TIMEOUT_MS),
    {
      first: "artwork-analysis",
      retry: "artwork-analysis-retry",
      parseFailure: "artwork-analysis-parse",
    },
  );
  if (!artworkResult.ok) {
    const parseFailure = artworkResult.failure.kind === "invalid";
    return NextResponse.json(
      {
        error: parseFailure
          ? "The AI returned an invalid artwork identity."
          : `The AI artwork-analysis service could not complete the request (${describeProviderFailure(artworkResult.failure)}).`,
      },
      { status: 502, headers: noStoreHeaders(rateHeaders) },
    );
  }

  const artworkIdentity = artworkResult.identity;
  const sections = buildFreeSiteSections(body);

  const designResult = await requestProvider(
    ai,
    buildFreeSiteDesignRequestBody(input, ai.model, artworkIdentity, sections),
    DESIGN_TIMEOUT_MS,
  );
  if (!designResult.ok) {
    return NextResponse.json(
      {
        error: `The AI free-site design service could not complete the request (${describeProviderFailure(designResult)}).`,
      },
      { status: 502, headers: noStoreHeaders(rateHeaders) },
    );
  }

  let design;
  try {
    design = parseFreeSiteDesignResponse(designResult.payload, sections);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Invalid free-site design: the model response was rejected.",
      },
      { status: 502, headers: noStoreHeaders(rateHeaders) },
    );
  }

  const facts = buildFreeSiteFacts(body);

  let templateHtml: string;
  try {
    templateHtml = renderFreeSiteTemplate({ ...design, facts });
  } catch {
    return NextResponse.json(
      { error: "The generated free-site theme or copy could not be rendered." },
      { status: 502, headers: noStoreHeaders(rateHeaders) },
    );
  }

  const acceptance =
    design.theme.tokenomicsStyle === "terminal"
      ? {}
      : { forbidTerminalAesthetic: true };
  if (!isCompleteGeneratedPageHtml(templateHtml, acceptance)) {
    return NextResponse.json(
      { error: "The generated free-site document failed server-side validation." },
      { status: 502, headers: noStoreHeaders(rateHeaders) },
    );
  }

  return NextResponse.json(
    { html: templateHtml },
    { headers: noStoreHeaders(rateHeaders) },
  );
}
