import type { TokenProject } from "@/lib/types";

export const TOKEN_STUDIO_PROJECTS_STORAGE_KEY = "private-meme-token-studio-projects-v1";

function isStoredProject(value: unknown): value is TokenProject {
  return typeof value === "object" && value !== null && typeof (value as { id?: unknown }).id === "string";
}

export function parseSavedTokenProjects(raw: string | null): TokenProject[] {
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isStoredProject);
  } catch {
    return [];
  }
}

export function serialiseSavedTokenProjects(projects: TokenProject[]): string {
  return JSON.stringify(projects);
}
