import type { OpenAIResponse } from "@/lib/server/generate-site-style";
import { sanitiseProviderDetail } from "@/lib/server/sanitise-provider-detail";
import { parseArtworkIdentityResponse, type ArtworkIdentity } from "@/lib/site-style-openai-pipeline";

export type ArtworkIdentityProviderFailure = {
  ok: false;
  kind: "network" | "http" | "invalid";
  status?: number;
  detail?: string;
};

export type ArtworkIdentityProviderResult =
  | { ok: true; payload: OpenAIResponse }
  | ArtworkIdentityProviderFailure;

export type ArtworkIdentityRequestResult =
  | { ok: true; identity: ArtworkIdentity }
  | { ok: false; stage: string; failure: ArtworkIdentityProviderFailure };

export type ArtworkIdentityRequestStages = {
  first: string;
  retry: string;
  parseFailure: string;
};

type OpenAIResponseMetadata = OpenAIResponse & {
  status?: unknown;
  incomplete_details?: { reason?: unknown } | null;
};

function artworkParseDetail(payload: OpenAIResponse, attempt: number): string {
  const metadata = payload as OpenAIResponseMetadata;
  const reason = metadata.incomplete_details?.reason;
  if (metadata.status === "incomplete") {
    const suffix = typeof reason === "string" && reason.trim()
      ? ` because ${reason.trim()}`
      : "";
    return `Artwork analysis attempt ${attempt} returned an incomplete response${suffix}.`;
  }
  return `Artwork analysis attempt ${attempt} completed but did not match the required seven-field identity object.`;
}

/**
 * Requests the artwork identity, retrying once when the provider call
 * succeeds but the response fails to parse into a complete identity.
 * Never retries a provider-level (network/http) failure.
 */
export async function requestArtworkIdentity(
  requestAttempt: (stage: string) => Promise<ArtworkIdentityProviderResult>,
  stages: ArtworkIdentityRequestStages,
): Promise<ArtworkIdentityRequestResult> {
  const parseDetails: string[] = [];

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const stage = attempt === 1 ? stages.first : stages.retry;
    const result = await requestAttempt(stage);
    if (!result.ok) return { ok: false, stage, failure: result };

    const identity = parseArtworkIdentityResponse(result.payload);
    if (identity) return { ok: true, identity };

    const detail = artworkParseDetail(result.payload, attempt);
    parseDetails.push(detail);
    if (attempt === 1) {
      console.warn("AI artwork identity response was incomplete; retrying once", detail);
    }
  }

  return {
    ok: false,
    stage: stages.parseFailure,
    failure: {
      ok: false,
      kind: "invalid",
      detail: sanitiseProviderDetail(parseDetails.join(" ")),
    },
  };
}
