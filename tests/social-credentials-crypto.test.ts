import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decryptSocialCredentials,
  encryptSocialCredentials,
  isSocialCredentialsEncryptionConfigured,
  SocialCredentialsEncryptionUnavailableError,
} from "@/lib/server/social-credentials-crypto";

const KEY = randomBytes(32).toString("base64");
const ENV = { SOCIAL_CREDENTIALS_ENCRYPTION_KEY: KEY };

describe("isSocialCredentialsEncryptionConfigured", () => {
  it("is false when unset, malformed, or the wrong length", () => {
    expect(isSocialCredentialsEncryptionConfigured({})).toBe(false);
    expect(isSocialCredentialsEncryptionConfigured({ SOCIAL_CREDENTIALS_ENCRYPTION_KEY: "not-base64!!" })).toBe(false);
    expect(isSocialCredentialsEncryptionConfigured({ SOCIAL_CREDENTIALS_ENCRYPTION_KEY: Buffer.from("short").toString("base64") })).toBe(false);
  });

  it("is true for a valid base64 32-byte key", () => {
    expect(isSocialCredentialsEncryptionConfigured(ENV)).toBe(true);
  });
});

describe("encryptSocialCredentials / decryptSocialCredentials", () => {
  it("round-trips plaintext", () => {
    const encrypted = encryptSocialCredentials("super-secret-token", ENV);
    const decrypted = decryptSocialCredentials(encrypted, ENV);
    expect(decrypted).toEqual({ status: "ok", plaintext: "super-secret-token" });
  });

  it("produces different ciphertext each time (random IV) even for the same plaintext", () => {
    const a = encryptSocialCredentials("same-value", ENV);
    const b = encryptSocialCredentials("same-value", ENV);
    expect(a).not.toBe(b);
  });

  it("throws SocialCredentialsEncryptionUnavailableError on encrypt when the key is missing", () => {
    expect(() => encryptSocialCredentials("value", {})).toThrow(SocialCredentialsEncryptionUnavailableError);
  });

  it("decrypt resolves not_configured (never throws) when the key is missing", () => {
    const encrypted = encryptSocialCredentials("value", ENV);
    expect(decryptSocialCredentials(encrypted, {})).toEqual({ status: "not_configured" });
  });

  it("decrypt resolves invalid (never throws) for a tampered payload", () => {
    const encrypted = encryptSocialCredentials("value", ENV);
    const [iv, tag, ciphertext] = encrypted.split(":");
    const tampered = [iv, tag, Buffer.from("garbage").toString("base64")].join(":");
    expect(decryptSocialCredentials(tampered, ENV).status).toBe("invalid");
    void ciphertext;
  });

  it("decrypt resolves invalid (never throws) for a malformed payload shape", () => {
    expect(decryptSocialCredentials("not-the-right-shape", ENV).status).toBe("invalid");
  });

  it("decrypt resolves invalid when the wrong key is used (e.g. after rotation)", () => {
    const encrypted = encryptSocialCredentials("value", ENV);
    const otherKey = { SOCIAL_CREDENTIALS_ENCRYPTION_KEY: randomBytes(32).toString("base64") };
    expect(decryptSocialCredentials(encrypted, otherKey).status).toBe("invalid");
  });
});
