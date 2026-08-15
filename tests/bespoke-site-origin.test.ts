import { beforeEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { createMemoryBespokeSiteChallengeStore } from "@/lib/server/bespoke-site-challenge-store";
import {
  authoriseBespokeSiteGeneration,
  issueBespokeSiteGenerationChallenge,
  resetBespokeSiteAuthoriserForTests,
  resetBespokeSiteChallengeIssuerForTests,
} from "@/lib/server/bespoke-site-entitlement";

const ACCOUNT = privateKeyToAccount(
  "0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd",
);
const NOW = new Date("2026-08-14T12:00:00.000Z");
const PROJECT = {
  name: "Origin Bound",
  ticker: "BOUND",
  description:
    "A project used to prove that bespoke access signatures cannot move between origins.",
  inspirationUrl: "",
};

beforeEach(() => {
  resetBespokeSiteAuthoriserForTests();
  resetBespokeSiteChallengeIssuerForTests();
});

describe("bespoke-site wallet challenge origin binding", () => {
  it("refuses a valid production signature when replayed from another origin", async () => {
    const store = createMemoryBespokeSiteChallengeStore();
    const access = {
      status: "ready" as const,
      walletAddress: ACCOUNT.address.toLowerCase(),
      allowed: true,
      tier: "bond_pro_site" as const,
      accessSource: "paid" as const,
      permanent: true,
      paidUntil: null,
      message: "Permanent access is active.",
    };
    const issued = await issueBespokeSiteGenerationChallenge(
      {
        walletAddress: ACCOUNT.address,
        project: PROJECT,
        requestOrigin: "https://hoodlums.dev",
      },
      { now: NOW, store, accessLookup: async () => access },
    );
    if (issued.status !== "issued") throw new Error("Challenge was not issued.");
    const signature = await ACCOUNT.signMessage({
      message: issued.challenge.message,
    });
    const proof = {
      challengeId: issued.challenge.challengeId,
      nonce: issued.challenge.nonce,
      signature,
    };
    const accessLookup = vi.fn(async () => access);

    const crossOrigin = await authoriseBespokeSiteGeneration(
      {
        proof,
        project: PROJECT,
        requestOrigin: "https://preview.example.com",
      },
      { now: NOW, store, accessLookup },
    );

    expect(crossOrigin.status).toBe("invalid-proof");
    expect(accessLookup).not.toHaveBeenCalled();

    // An origin mismatch never authorises or consumes the production-bound
    // challenge; its single permitted use still belongs to the signed origin.
    const production = await authoriseBespokeSiteGeneration(
      {
        proof,
        project: PROJECT,
        requestOrigin: "https://hoodlums.dev",
      },
      { now: NOW, store, accessLookup },
    );
    expect(production.status).toBe("allowed");
    expect(accessLookup).toHaveBeenCalledTimes(1);
  });
});
