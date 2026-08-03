// Shared between the client feed UI and the server store/routes so the
// category list can't drift between the two.
export const HOODCHAT_CATEGORIES = ["new-launches", "trading", "projects", "general"] as const;
export type HoodchatCategory = (typeof HOODCHAT_CATEGORIES)[number];

export function isHoodchatCategory(value: unknown): value is HoodchatCategory {
  return typeof value === "string" && (HOODCHAT_CATEGORIES as readonly string[]).includes(value);
}

export const HOODCHAT_CATEGORY_LABELS: Record<HoodchatCategory, string> = {
  "new-launches": "New Launches",
  trading: "Trading",
  projects: "Projects",
  general: "General",
};
