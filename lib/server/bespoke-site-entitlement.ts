import { createHash, randomBytes } from "node:crypto";
import { getAddress, verifyMessage } from "viem";
import {
  BESPOKE_SITE_CHALLENGE_TTL_MS,
  buildBespokeSiteChallengeMessage,
  hashBespokeSiteProject,
  normaliseBespokeSiteOrigin,
  type BespokeSiteAccessProof,
  type BespokeSiteChallengeResponse,
  type BespokeSiteProjectIdentity,
} from "@/lib/bespoke-site-access";
import {
  BespokeSiteChallengeStoreUnavailableError,
  getBespokeSiteChallengeStore,
  type BespokeSiteChallengeStore,
} from "@/lib/server/bespoke-site-challenge-store";
import {
  getBespokeSiteAccess,
  type BespokeSiteAccessTier,
} from "@/lib/server/subscribers";

export const BESPOKE_SITE_UPSELL_MESSAGE =
  "Bespoke AI design is included with Bond + Pro Site ($10 one-off), Pro, and Pro Bundle. Your free artwork-matched site remains available, or continue to the Bond + Pro Site checkout to unlock the premium responsive design pipeline.";

export type BespokeSiteChallengeIssue =
  | { status: "issued"; challenge: BespokeSiteChallengeResponse }
  | { status: "upsell"; walletAddress: string; message: string }
  | { status: "invalid-request"; message: string }
  | { status: "unavailable"; message: string };

export type BespokeSiteGenerationAuthorisation =
  | {
      status: "allowed";
      walletAddress: string;
      tier: BespokeSiteAccessTier;
      permanent: boolean;
    }
  | { status: "upsell"; walletAddress: string; message: string }
  | { status: "invalid-proof"; message: string }
  | { status: "unavailable"; message: string };

export type BespokeSiteChallengeIssuer = (input: {
  walletAddress: unknown;
  project: BespokeSiteProjectIdentity;
  requestOrigin: string;
}) => Promise<BespokeSiteChallengeIssue>;

export type BespokeSiteAuthoriser = (input: {
  proof: unknown;
  project: BespokeSiteProjectIdentity;
  requestOrigin: string;
}) => Promise<BespokeSiteGenerationAuthorisation>;

type AccessLookup = typeof getBespokeSiteAccess;
type VerifyMessage = typeof verifyMessage;

let testIssuer: BespokeSiteChallengeIssuer | null = null;
let testAuthoriser: BespokeSiteAuthoriser | null = null;

export function setBespokeSiteChallengeIssuerForTests(
  issuer: BespokeSiteChallengeIssuer,
): void {
  testIssuer = issuer;
}

export function resetBespokeSiteChallengeIssuerForTests(): void {
  testIssuer = null;
}

export function setBespokeSiteAuthoriserForTests(
  authoriser: BespokeSiteAuthoriser,
): void {
  testAuthoriser = authoriser;
}

export function resetBespokeSiteAuthoriserForTests(): void {
  testAuthoriser = null;
}

function nonceHash(nonce: string): string {
  return createHash("sha256").update(nonce, "utf8").digest("hex");
}

function proofRecord(value: unknown): BespokeSiteAccessProof | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const proof = value as Record<string, unknown>;
  if (
    typeof proof.challengeId !== "string" ||
    proof.challengeId.trim().length === 0 ||
    proof.challengeId.length > 128 ||
    typeof proof.nonce !== "string" ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(proof.nonce) ||
    typeof proof.signature !== "string" ||
    !/^0x[0-9a-f]+$/i.test(proof.signature)
  ) {
    return null;
  }
  return {
    challengeId: proof.challengeId.trim(),
    nonce: proof.nonce,
    signature: proof.signature as `0x${string}`,
  };
}

function accessUnavailable(message: string): BespokeSiteGenerationAuthorisation {
  return {
    status: "unavailable",
    message,
  };
}

export async function issueBespokeSiteGenerationChallenge(
  input: {
    walletAddress: unknown;
    project: BespokeSiteProjectIdentity;
    requestOrigin: string;
  },
  options: {
    now?: Date;
    accessLookup?: AccessLookup;
    store?: BespokeSiteChallengeStore;
  } = {},
): Promise<BespokeSiteChallengeIssue> {
  if (process.env.NODE_ENV === "test" && testIssuer) {
    return testIssuer(input);
  }

  const origin = normaliseBespokeSiteOrigin(input.requestOrigin);
  let walletAddress: string;
  try {
    walletAddress = getAddress(String(input.walletAddress || ""));
  } catch {
    return {
      status: "invalid-request",
      message: "Connect a valid EVM wallet to check bespoke-site access.",
    };
  }
  if (!origin) {
    return {
      status: "invalid-request",
      message: "The bespoke-site request origin is invalid.",
    };
  }

  const now = options.now ?? new Date();
  const access = await (options.accessLookup ?? getBespokeSiteAccess)(
    walletAddress,
    { now },
  );
  if (access.status === "unavailable") {
    return {
      status: "unavailable",
      message:
        "Bespoke plan access could not be checked. No wallet signature or AI generation was requested.",
    };
  }
  if (!access.allowed || !access.tier) {
    return {
      status: "upsell",
      walletAddress,
      message: BESPOKE_SITE_UPSELL_MESSAGE,
    };
  }

  const nonce = randomBytes(24).toString("base64url");
  const issuedAt = now;
  const expiresAt = new Date(now.getTime() + BESPOKE_SITE_CHALLENGE_TTL_MS);
  const projectHash = hashBespokeSiteProject(input.project);

  try {
    const stored = await (options.store ?? getBespokeSiteChallengeStore()).create({
      nonceHash: nonceHash(nonce),
      walletAddress,
      origin,
      projectHash,
      issuedAt,
      expiresAt,
    });
    const challengeInput = {
      challengeId: stored.id,
      nonce,
      walletAddress: stored.walletAddress,
      origin: stored.origin,
      issuedAt: stored.issuedAt.toISOString(),
      expiresAt: stored.expiresAt.toISOString(),
      projectHash: stored.projectHash,
    };
    return {
      status: "issued",
      challenge: {
        ...challengeInput,
        message: buildBespokeSiteChallengeMessage(challengeInput),
        tier: access.tier,
      },
    };
  } catch (error) {
    return {
      status: "unavailable",
      message:
        error instanceof BespokeSiteChallengeStoreUnavailableError
          ? "Bespoke wallet verification is not configured on this deployment."
          : "The one-time bespoke wallet challenge could not be created.",
    };
  }
}

export async function authoriseBespokeSiteGeneration(
  input: {
    proof: unknown;
    project: BespokeSiteProjectIdentity;
    requestOrigin: string;
  },
  options: {
    now?: Date;
    verify?: VerifyMessage;
    accessLookup?: AccessLookup;
    store?: BespokeSiteChallengeStore;
  } = {},
): Promise<BespokeSiteGenerationAuthorisation> {
  if (process.env.NODE_ENV === "test" && testAuthoriser) {
    return testAuthoriser(input);
  }

  const proof = proofRecord(input.proof);
  const origin = normaliseBespokeSiteOrigin(input.requestOrigin);
  if (!proof || !origin) {
    return {
      status: "invalid-proof",
      message:
        "A fresh one-time wallet approval is required for bespoke AI generation. The signature sends no funds.",
    };
  }

  const now = options.now ?? new Date();
  let consumed;
  try {
    consumed = await (options.store ?? getBespokeSiteChallengeStore()).consume({
      challengeId: proof.challengeId,
      nonceHash: nonceHash(proof.nonce),
      origin,
      projectHash: hashBespokeSiteProject(input.project),
      now,
    });
  } catch (error) {
    return accessUnavailable(
      error instanceof BespokeSiteChallengeStoreUnavailableError
        ? "Bespoke wallet verification is not configured on this deployment."
        : "The one-time bespoke wallet challenge could not be checked.",
    );
  }

  if (consumed.status !== "ok") {
    const reason =
      consumed.status === "replayed"
        ? "This one-time wallet approval has already been used. Request a new challenge and sign again."
        : consumed.status === "expired"
          ? "The one-time wallet approval expired. Request a fresh challenge and sign again."
          : "The one-time wallet approval did not match this project and request.";
    return { status: "invalid-proof", message: reason };
  }

  const challenge = consumed.challenge;
  const challengeMessage = buildBespokeSiteChallengeMessage({
    challengeId: challenge.id,
    nonce: proof.nonce,
    walletAddress: challenge.walletAddress,
    origin: challenge.origin,
    issuedAt: challenge.issuedAt.toISOString(),
    expiresAt: challenge.expiresAt.toISOString(),
    projectHash: challenge.projectHash,
  });

  try {
    const valid = await (options.verify ?? verifyMessage)({
      address: challenge.walletAddress as `0x${string}`,
      message: challengeMessage,
      signature: proof.signature,
    });
    if (!valid) {
      return {
        status: "invalid-proof",
        message:
          "The wallet signature did not match this one-time bespoke request. Request a fresh approval and try again.",
      };
    }
  } catch {
    return {
      status: "invalid-proof",
      message:
        "The wallet signature could not be verified. Request a fresh approval and try again.",
    };
  }

  const access = await (options.accessLookup ?? getBespokeSiteAccess)(
    challenge.walletAddress,
    { now },
  );
  if (access.status === "unavailable") {
    return accessUnavailable(
      "Bespoke plan access could not be checked. No AI generation was started; try again when the server is available.",
    );
  }
  if (!access.allowed || !access.tier) {
    return {
      status: "upsell",
      walletAddress: challenge.walletAddress,
      message: BESPOKE_SITE_UPSELL_MESSAGE,
    };
  }

  return {
    status: "allowed",
    walletAddress: challenge.walletAddress,
    tier: access.tier,
    permanent: access.permanent,
  };
}
