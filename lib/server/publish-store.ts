import type { PublicGeneratedSite, PublishedSiteVisibility } from "@/lib/public-site";
import type { PublishChallenge } from "@/lib/server/publish-auth";
import type { PublishableSite } from "@/lib/server/published-site-validation";
import { createPostgresPublishStore } from "@/lib/server/postgres-publish-store";

export type CreatePublishChallengeInput = {
  nonceHash: string;
  walletAddress: string;
  slug: string;
  walletChainId: number;
  sitePayloadHash: string;
  issuedAt: Date;
  expiresAt: Date;
};

export type PublishWithChallengeInput = {
  challengeId: string;
  nonceHash: string;
  sitePayloadHash: string;
  site: PublishableSite;
};

export type SetVisibilityWithChallengeInput = {
  challengeId: string;
  nonceHash: string;
  slug: string;
  visibility: Extract<PublishedSiteVisibility, "live">;
};

export type PublishStoreResult =
  | { status: "published"; site: PublicGeneratedSite; ownerWalletAddress: string }
  | { status: "nonce_not_found" }
  | { status: "nonce_expired" }
  | { status: "nonce_replayed" }
  | { status: "nonce_mismatch" }
  | { status: "invalid_signature" }
  | { status: "slug_conflict" };

export type PublishVisibilityResult =
  | { status: "updated"; site: PublicGeneratedSite; ownerWalletAddress: string }
  | { status: "nonce_not_found" }
  | { status: "nonce_expired" }
  | { status: "nonce_replayed" }
  | { status: "nonce_mismatch" }
  | { status: "invalid_signature" }
  | { status: "site_not_found" }
  | { status: "not_owner" };

export type UpdateContractAddressInput = { slug: string; contractAddress: string };

export type UpdateContractAddressResult =
  | { status: "updated"; site: PublicGeneratedSite }
  | { status: "site_not_found" };

export type PublishSignatureVerifier = (challenge: PublishChallenge) => Promise<boolean>;

export interface PublishStore {
  createChallenge(input: CreatePublishChallengeInput): Promise<PublishChallenge>;
  publishWithChallenge(
    input: PublishWithChallengeInput,
    verifySignature: PublishSignatureVerifier,
  ): Promise<PublishStoreResult>;
  setVisibilityWithChallenge?(
    input: SetVisibilityWithChallengeInput,
    verifySignature: PublishSignatureVerifier,
  ): Promise<PublishVisibilityResult>;
  getBySlug(slug: string): Promise<PublicGeneratedSite | null>;
  listLive(): Promise<PublicGeneratedSite[]>;
  /**
   * Admin-only path (issue #286) to attach or correct a published site's
   * contract address outside the normal single-use signed publish flow — the
   * only way a site published before its token launched can pick one up
   * later. Optional so existing test fixtures implementing `PublishStore`
   * don't need to grow a method they never exercise.
   */
  updateContractAddress?(input: UpdateContractAddressInput): Promise<UpdateContractAddressResult>;
}

export class PublishStoreUnavailableError extends Error {
  constructor() {
    super("DATABASE_URL is not configured for durable publishing.");
    this.name = "PublishStoreUnavailableError";
  }
}

const unconfiguredStore: PublishStore = {
  async createChallenge() {
    throw new PublishStoreUnavailableError();
  },
  async publishWithChallenge() {
    throw new PublishStoreUnavailableError();
  },
  async setVisibilityWithChallenge() {
    throw new PublishStoreUnavailableError();
  },
  async getBySlug() {
    return null;
  },
  async listLive() {
    return [];
  },
  async updateContractAddress() {
    throw new PublishStoreUnavailableError();
  },
};

let testStore: PublishStore | null = null;
let productionStore: PublishStore | null = null;
let productionDatabaseUrl = "";

export function setPublishStoreForTests(store: PublishStore): void {
  testStore = store;
}

export function resetPublishStoreForTests(): void {
  testStore = null;
}

export function getPublishStore(): PublishStore {
  if (testStore) return testStore;

  const databaseUrl = process.env.DATABASE_URL?.trim() || "";
  if (!databaseUrl) return unconfiguredStore;
  if (!productionStore || productionDatabaseUrl !== databaseUrl) {
    productionStore = createPostgresPublishStore(databaseUrl);
    productionDatabaseUrl = databaseUrl;
  }
  return productionStore;
}
