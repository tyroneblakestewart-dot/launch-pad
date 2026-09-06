// Client-safe constants for the one-signature-a-day approval session (owner
// direction, 6 Sep 2026). Mirrors lib/server/social-approval-session.ts's
// purpose and signed payload without pulling server-only code into the
// bundle; tests assert the two stay identical.

export const SOCIAL_APPROVAL_SESSION_PURPOSE = "social:approval-session" as const;
export const SOCIAL_APPROVAL_SESSION_PAYLOAD: Record<string, string> = { grant: "approve-posts", validFor: "24h" };
