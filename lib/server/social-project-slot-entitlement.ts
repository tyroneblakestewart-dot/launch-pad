import type { AdminServiceKey } from "@/lib/admin-operations";
import {
  normaliseSocialProjectDisplayName,
  normaliseSocialProjectId,
  socialProjectSlotLimit,
  socialProjectSlotLimitMessage,
} from "@/lib/social-project-slots";
import type { SubscriptionPlan } from "@/lib/subscription-lifecycle";
import { recordAdminActivityBestEffort } from "@/lib/server/admin-operations-store";
import {
  SocialProjectSlotsStoreUnavailableError,
  getSocialProjectSlotsStore,
} from "@/lib/server/social-project-slots-store";
import type { SocialStudioAuthorisation } from "@/lib/server/social-studio-entitlement";

// Wraps around (never forks) the canonical authoriseSocialStudioRequest
// decision to additionally enforce the Pro/Pro Bundle project-slot billing
// gap (issue #407). Every AI Social Studio paid entry point and the
// approve-first post-create route call this once they already have an
// "allowed" authorisation, passing the client-supplied project id/display
// name snapshot.

export type AllowedSocialStudioAuthorisation = Extract<SocialStudioAuthorisation, { status: "allowed" }>;

export type SocialProjectSlotAuthorisation =
  | { status: "ok" }
  | { status: "invalid-project"; message: string }
  | { status: "limit-reached"; message: string; activeCount: number; limit: number }
  | { status: "unavailable"; message: string };

export async function authoriseSocialProjectSlot(
  authorisation: AllowedSocialStudioAuthorisation,
  input: { projectId: unknown; displayName: unknown },
  options: { serviceKey: AdminServiceKey },
): Promise<SocialProjectSlotAuthorisation> {
  // Test-allowlist wallets (an admin-granted bypass, not a paid plan) get
  // unlimited use and are never registered into the slot registry.
  if (authorisation.accessSource === "test-allowlist") {
    return { status: "ok" };
  }

  const projectId = normaliseSocialProjectId(input.projectId);
  const displayName = normaliseSocialProjectDisplayName(input.displayName);
  if (!projectId || !displayName) {
    return { status: "invalid-project", message: "A valid project id and project name are required." };
  }

  const plan: SubscriptionPlan | null = authorisation.plan ?? null;
  if (!plan) {
    // Should not happen for a real "allowed" paid authorisation — active
    // Pro/Pro Bundle access always carries a plan. Fail closed rather than
    // allow unlimited use if it ever does.
    return { status: "unavailable", message: "Your plan could not be determined. No AI request was made." };
  }
  const limit = socialProjectSlotLimit(plan);

  try {
    const result = await getSocialProjectSlotsStore().ensureSlot({
      walletAddress: authorisation.walletAddress,
      projectId,
      displayName,
      limit,
    });

    if (result.status === "limit_reached") {
      return {
        status: "limit-reached",
        message: socialProjectSlotLimitMessage(plan, limit),
        activeCount: result.activeCount,
        limit,
      };
    }

    if (result.status === "registered") {
      void recordAdminActivityBestEffort({
        kind: "slot-registered",
        serviceKey: options.serviceKey,
        message: `Project slot registered for ${authorisation.walletAddress}: ${result.slot.displayName} (${result.slot.projectId}).`,
      });
    }

    return { status: "ok" };
  } catch (error) {
    if (error instanceof SocialProjectSlotsStoreUnavailableError) {
      return { status: "unavailable", message: "The project-slot registry is not configured. No AI request was made." };
    }
    console.error(
      "Project-slot check failed unexpectedly.",
      error instanceof Error ? (error.stack ?? error.message) : error,
    );
    return { status: "unavailable", message: "The project-slot registry could not be reached. No AI request was made." };
  }
}
