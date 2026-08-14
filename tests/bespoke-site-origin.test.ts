import { beforeEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { createUnsignedBespokeSiteAccessProof } from "@/lib/bespoke-site-access";
import {
  authoriseBespokeSiteGeneration,
  resetBespokeSiteAuthoriserForTests,
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
});

describe("bespoke-site wallet proof origin binding", () => {
  it("refuses a valid production signature when replayed from another origin", async () => {
    const { proof, message } = createUnsignedBespokeSiteAccessProof({
      walletAddress: ACCOUNT.address,
      origin: "https://hoodlums.dev",
      project: PROJECT,
      now: NOW,
    });
    const signature = await ACCOUNT.signMessage({ message });
    const accessLookup = vi.fn();

    const result = await authoriseBespokeSiteGeneration(
      {
        proof: { ...proof, signature },
        project: PROJECT,
        requestOrigin: "https://preview.example.com",
      },
      { now: NOW, accessLookup },
    );

    expect(result.status).toBe("invalid-proof");
    expect(accessLookup).not.toHaveBeenCalled();
  });
});
