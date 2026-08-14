import { getAddress, isHash, verifyMessage } from "viem";
import {
  BESPOKE_SITE_ACCESS_PROOF_FUTURE_SKEW_MS,
  BESPOKE_SITE_ACCESS_PROOF_TTL_MS,
  buildBespokeSiteAccessMessage,
  hashBespokeSiteProject,
  normaliseBespokeSiteOrigin,
  type BespokeSiteAccessProof,
  type BespokeSiteProjectIdentity,
} from "@/lib/bespoke-site-access";
import {
  getBespokeSiteAccess,
  type BespokeSiteAccessTier,
} from "@/lib/server/subscribers";

export const BESPOKE_SITE_UPSELL_MESSAGE =
  "Bespoke AI design is included with Bond + Pro Site ($10 one-off), Pro, and Pro Bundle. Your free artwork-matched site and publishing tools remain available.";

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

export type BespokeSiteAuthoriser = (input: {
  proof: unknown;
  project: BespokeSiteProjectIdentity;
  requestOrigin: string;
}) => Promise<BespokeSiteGenerationAuthorisation>;

type AccessLookup = typeof getBespokeSiteAccess;
type VerifyMessage = typeof verifyMessage;

let testAuthoriser: BespokeSiteAuthoriser | null = null;

export function setBespokeSiteAuthoriserForTests(
  authoriser: BespokeSiteAuthoriser,
): void {
  testAuthoriser = authoriser;
}

export function resetBespokeSiteAuthoriserForTests(): void {
  testAuthoriser = null;
}

function proofRecord(value: unknown): BespokeSiteAccessProof | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const proof = value as Record<string, unknown>;
  if (
    typeof proof.walletAddress !== "string" ||
    typeof proof.origin !== "string" ||
    typeof proof.issuedAt !== "string" ||
    typeof proof.expiresAt !== "string" ||
    typeof proof.projectHash !== "string" ||
    !isHash(proof.projectHash) ||
    typeof proof.signature !== "string" ||
    !/^0x[0-9a-f]+$/i.test(proof.signature)
  ) {
    return null;
  }

  try {
    return {
      walletAddress: getAddress(proof.walletAddress),
      origin: proof.origin,
      issuedAt: proof.issuedAt,
      expiresAt: proof.expiresAt,
      projectHash: proof.projectHash,
      signature: proof.signature as `0x${string}`,
    };
  } catch {
    return null;
  }
}

async function verifyProof(input: {
  proof: unknown;
  project: BespokeSiteProjectIdentity;
  requestOrigin: string;
  now: Date;
  verify: VerifyMessage;
}): Promise<string | null> {
  const proof = proofRecord(input.proof);
  const origin = normaliseBespokeSiteOrigin(input.requestOrigin);
  if (!proof || !origin || normaliseBespokeSiteOrigin(proof.origin) !== origin) {
    return null;
  }

  if (proof.projectHash !== hashBespokeSiteProject(input.project)) return null;

  const issuedAt = new Date(proof.issuedAt);
  const expiresAt = new Date(proof.expiresAt);
  if (
    Number.isNaN(issuedAt.getTime()) ||
    Number.isNaN(expiresAt.getTime()) ||
    expiresAt.getTime() <= issuedAt.getTime() ||
    expiresAt.getTime() - issuedAt.getTime() > BESPOKE_SITE_ACCESS_PROOF_TTL_MS ||
    issuedAt.getTime() >
      input.now.getTime() + BESPOKE_SITE_ACCESS_PROOF_FUTURE_SKEW_MS ||
    expiresAt.getTime() <= input.now.getTime()
  ) {
    return null;
  }

  try {
    const valid = await input.verify({
      address: proof.walletAddress as `0x${string}`,
      message: buildBespokeSiteAccessMessage(proof),
      signature: proof.signature,
    });
    return valid ? proof.walletAddress : null;
  } catch {
    return null;
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
  } = {},
): Promise<BespokeSiteGenerationAuthorisation> {
  if (process.env.NODE_ENV === "test" && testAuthoriser) {
    return testAuthoriser(input);
  }

  const walletAddress = await verifyProof({
    ...input,
    now: options.now ?? new Date(),
    verify: options.verify ?? verifyMessage,
  });
  if (!walletAddress) {
    return {
      status: "invalid-proof",
      message:
        "Connect and sign with the EVM wallet that owns an eligible Hoodlums plan. The signature sends no funds.",
    };
  }

  const access = await (options.accessLookup ?? getBespokeSiteAccess)(
    walletAddress,
    { now: options.now },
  );
  if (access.status === "unavailable") {
    return {
      status: "unavailable",
      message:
        "Bespoke plan access could not be checked. No AI generation was started; try again when the server is available.",
    };
  }
  if (!access.allowed || !access.tier) {
    return {
      status: "upsell",
      walletAddress,
      message: BESPOKE_SITE_UPSELL_MESSAGE,
    };
  }

  return {
    status: "allowed",
    walletAddress,
    tier: access.tier,
    permanent: access.permanent,
  };
}
