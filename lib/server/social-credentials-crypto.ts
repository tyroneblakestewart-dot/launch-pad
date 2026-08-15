import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM at-rest encryption for Social Studio connection secrets (X
// user access token/secret, in future any other platform credential) before
// they reach social_connections.encrypted_credentials or
// social_x_oauth_requests.encrypted_request_secret (issue #335). Postgres
// access alone must never be enough to recover a usable credential —
// CLAUDE.md rule 4's "encrypted, minimum scope, deletable" requirement.
//
// SOCIAL_CREDENTIALS_ENCRYPTION_KEY must be a base64-encoded 32-byte key
// (e.g. `openssl rand -base64 32`), kept server-side only, distinct from
// every other secret in this app. Rotating it invalidates every stored
// connection — callers must treat decrypt failure as "reconnect needed",
// never as a crash.

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function readKey(env: Record<string, string | undefined>): Buffer | null {
  const raw = (env.SOCIAL_CREDENTIALS_ENCRYPTION_KEY || "").trim();
  if (!raw) return null;
  try {
    const key = Buffer.from(raw, "base64");
    return key.byteLength === 32 ? key : null;
  } catch {
    return null;
  }
}

export function isSocialCredentialsEncryptionConfigured(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return readKey(env) !== null;
}

export class SocialCredentialsEncryptionUnavailableError extends Error {
  constructor() {
    super("SOCIAL_CREDENTIALS_ENCRYPTION_KEY is not configured (must be a base64 32-byte key).");
    this.name = "SocialCredentialsEncryptionUnavailableError";
  }
}

/** Returns `${iv}:${authTag}:${ciphertext}`, each base64. Throws if the key is missing/invalid — callers must check isSocialCredentialsEncryptionConfigured first. */
export function encryptSocialCredentials(
  plaintext: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const key = readKey(env);
  if (!key) throw new SocialCredentialsEncryptionUnavailableError();

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(":");
}

export type DecryptSocialCredentialsResult =
  | { status: "ok"; plaintext: string }
  | { status: "not_configured" }
  | { status: "invalid" };

/** Never throws: a tampered payload, wrong key (e.g. after rotation) or malformed value all resolve to "invalid" so callers can flip the connection to reconnect-needed instead of crashing. */
export function decryptSocialCredentials(
  payload: string,
  env: Record<string, string | undefined> = process.env,
): DecryptSocialCredentialsResult {
  const key = readKey(env);
  if (!key) return { status: "not_configured" };

  const parts = payload.split(":");
  if (parts.length !== 3) return { status: "invalid" };
  const [ivPart, authTagPart, ciphertextPart] = parts;

  try {
    const iv = Buffer.from(ivPart, "base64");
    const authTag = Buffer.from(authTagPart, "base64");
    const ciphertext = Buffer.from(ciphertextPart, "base64");
    if (iv.byteLength !== IV_LENGTH || authTag.byteLength !== AUTH_TAG_LENGTH) {
      return { status: "invalid" };
    }

    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    return { status: "ok", plaintext };
  } catch {
    return { status: "invalid" };
  }
}
