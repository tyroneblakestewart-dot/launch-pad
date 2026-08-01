import { afterEach, describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import {
  ADMIN_SESSION_COOKIE,
  buildAdminAuthorisationMessage,
  createAdminNonce,
  getAdminWalletAddress,
  hashAdminNonce,
  normaliseAdminWalletAddress,
  parseAdminSessionCookie,
  verifyAdminPassword,
  verifyAdminWalletSignature,
  type AdminChallenge,
} from "@/lib/server/admin-auth";

const ADMIN_ACCOUNT = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as `0x${string}`,
);
const OTHER_ACCOUNT = privateKeyToAccount(
  "0x8b3a350cf5c34c9194ca3a545d5a8b9c7f8b4f5a33c56c2f4ec1d0e1c7f5b3a2" as `0x${string}`,
);

const originalAdminWalletAddress = process.env.ADMIN_WALLET_ADDRESS;
const originalAdminPassword = process.env.ADMIN_PASSWORD;

afterEach(() => {
  process.env.ADMIN_WALLET_ADDRESS = originalAdminWalletAddress;
  process.env.ADMIN_PASSWORD = originalAdminPassword;
});

function makeChallenge(overrides: Partial<AdminChallenge> = {}): AdminChallenge {
  const now = new Date();
  return {
    id: "11111111-1111-1111-1111-111111111111",
    nonceHash: hashAdminNonce("test-nonce"),
    walletAddress: ADMIN_ACCOUNT.address,
    issuedAt: now,
    expiresAt: new Date(now.getTime() + 5 * 60 * 1000),
    usedAt: null,
    ...overrides,
  };
}

describe("getAdminWalletAddress", () => {
  it("normalises a configured address to its canonical checksum form", () => {
    process.env.ADMIN_WALLET_ADDRESS = ADMIN_ACCOUNT.address.toLowerCase();
    expect(getAdminWalletAddress()).toBe(ADMIN_ACCOUNT.address);
  });

  it("returns null when unset", () => {
    delete process.env.ADMIN_WALLET_ADDRESS;
    expect(getAdminWalletAddress()).toBeNull();
  });

  it("returns null for a malformed address instead of throwing", () => {
    process.env.ADMIN_WALLET_ADDRESS = "not-an-address";
    expect(getAdminWalletAddress()).toBeNull();
  });
});

describe("normaliseAdminWalletAddress", () => {
  it("checksums valid addresses and rejects everything else", () => {
    expect(normaliseAdminWalletAddress(ADMIN_ACCOUNT.address.toLowerCase())).toBe(ADMIN_ACCOUNT.address);
    expect(normaliseAdminWalletAddress("nope")).toBeNull();
    expect(normaliseAdminWalletAddress(42)).toBeNull();
    expect(normaliseAdminWalletAddress(undefined)).toBeNull();
  });
});

describe("verifyAdminWalletSignature", () => {
  it("accepts a signature from the challenge's own wallet over the exact challenge message", async () => {
    const nonce = createAdminNonce();
    const challenge = makeChallenge({ nonceHash: hashAdminNonce(nonce) });
    const message = buildAdminAuthorisationMessage({ ...challenge, nonce });
    const signature = await ADMIN_ACCOUNT.signMessage({ message });

    expect(await verifyAdminWalletSignature(challenge, nonce, signature)).toBe(true);
  });

  it("rejects a signature from a different wallet than the challenge names", async () => {
    const nonce = createAdminNonce();
    const challenge = makeChallenge({ nonceHash: hashAdminNonce(nonce) });
    const message = buildAdminAuthorisationMessage({ ...challenge, nonce });
    const signature = await OTHER_ACCOUNT.signMessage({ message });

    expect(await verifyAdminWalletSignature(challenge, nonce, signature)).toBe(false);
  });

  it("rejects once the challenge has already been used", async () => {
    const nonce = createAdminNonce();
    const challenge = makeChallenge({ nonceHash: hashAdminNonce(nonce), usedAt: new Date() });
    const message = buildAdminAuthorisationMessage({ ...challenge, nonce });
    const signature = await ADMIN_ACCOUNT.signMessage({ message });

    expect(await verifyAdminWalletSignature(challenge, nonce, signature)).toBe(false);
  });

  it("rejects an expired challenge", async () => {
    const nonce = createAdminNonce();
    const challenge = makeChallenge({
      nonceHash: hashAdminNonce(nonce),
      expiresAt: new Date(Date.now() - 1_000),
    });
    const message = buildAdminAuthorisationMessage({ ...challenge, nonce });
    const signature = await ADMIN_ACCOUNT.signMessage({ message });

    expect(await verifyAdminWalletSignature(challenge, nonce, signature)).toBe(false);
  });

  it("rejects a mismatched nonce", async () => {
    const nonce = createAdminNonce();
    const challenge = makeChallenge({ nonceHash: hashAdminNonce(nonce) });
    const message = buildAdminAuthorisationMessage({ ...challenge, nonce: "a-different-nonce" });
    const signature = await ADMIN_ACCOUNT.signMessage({ message });

    expect(await verifyAdminWalletSignature(challenge, "a-different-nonce", signature)).toBe(false);
  });
});

describe("verifyAdminPassword", () => {
  it("accepts the exact configured password", () => {
    process.env.ADMIN_PASSWORD = "correct horse battery staple";
    expect(verifyAdminPassword("correct horse battery staple")).toBe(true);
  });

  it("rejects an incorrect password", () => {
    process.env.ADMIN_PASSWORD = "correct horse battery staple";
    expect(verifyAdminPassword("wrong password")).toBe(false);
  });

  it("fails closed when ADMIN_PASSWORD is not configured, even against an empty guess", () => {
    delete process.env.ADMIN_PASSWORD;
    expect(verifyAdminPassword("")).toBe(false);
    expect(verifyAdminPassword("anything")).toBe(false);
  });

  it("rejects non-string input without throwing", () => {
    process.env.ADMIN_PASSWORD = "correct horse battery staple";
    expect(verifyAdminPassword(undefined)).toBe(false);
    expect(verifyAdminPassword(12345)).toBe(false);
  });
});

describe("parseAdminSessionCookie", () => {
  it("extracts the session token among multiple cookies", () => {
    const header = `other=1; ${ADMIN_SESSION_COOKIE}=abc123; another=2`;
    expect(parseAdminSessionCookie(header)).toBe("abc123");
  });

  it("returns null when the cookie is absent", () => {
    expect(parseAdminSessionCookie("other=1")).toBeNull();
    expect(parseAdminSessionCookie(null)).toBeNull();
    expect(parseAdminSessionCookie(undefined)).toBeNull();
  });
});
