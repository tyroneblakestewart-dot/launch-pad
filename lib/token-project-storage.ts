import type { TokenProject } from "@/lib/types";
import type { ProjectBlob } from "@/lib/token-project-db";

export const TOKEN_STUDIO_PROJECTS_STORAGE_KEY = "private-meme-token-studio-projects-v1";

/**
 * Everything about a saved launch except the two fields that can be large
 * enough to blow the ~5MB localStorage quota (issue #307). This is the only
 * shape localStorage ever stores; `heroImage` and `generatedSiteHtml` live
 * per-project in IndexedDB (see `lib/token-project-db.ts`) and are merged
 * back in when a project is opened.
 */
export type SavedProjectIndexEntry = Omit<TokenProject, "heroImage" | "generatedSiteHtml">;

function isIndexEntryShaped(value: unknown): value is SavedProjectIndexEntry {
  if (typeof value !== "object" || value === null) return false;
  const record = value as { id?: unknown; name?: unknown; chain?: unknown; status?: unknown };
  return (
    typeof record.id === "string" &&
    typeof record.name === "string" &&
    typeof record.chain === "string" &&
    typeof record.status === "string"
  );
}

export function parseSavedProjectIndex(raw: string | null): SavedProjectIndexEntry[] {
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isIndexEntryShaped);
  } catch {
    return [];
  }
}

export function serialiseSavedProjectIndex(index: SavedProjectIndexEntry[]): string {
  return JSON.stringify(index);
}

export type LegacyMigrationResult = {
  /** The lightweight index to write back to localStorage. */
  index: SavedProjectIndexEntry[];
  /** Heavy per-project data recovered from legacy entries, to move into IndexedDB. */
  blobs: ProjectBlob[];
  /** Entries that were present but too malformed to recover at all. */
  droppedCount: number;
};

/**
 * Reads a legacy (or already-migrated) localStorage payload and splits it
 * into a lightweight index plus any heavy `heroImage`/`generatedSiteHtml`
 * data that still needs moving into IndexedDB. Safe to run on every load —
 * an already-migrated index simply produces no blobs. Throws on JSON that
 * isn't a parseable array at all; per-entry problems are dropped and
 * counted instead of failing the whole batch, so one broken row can never
 * hide every other saved launch.
 */
export function migrateLegacySavedProjects(raw: string): LegacyMigrationResult {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("Saved projects were not in the expected format.");
  }

  const index: SavedProjectIndexEntry[] = [];
  const blobs: ProjectBlob[] = [];
  let droppedCount = 0;

  for (const item of parsed) {
    if (!isIndexEntryShaped(item)) {
      droppedCount += 1;
      continue;
    }

    const record = item as SavedProjectIndexEntry & {
      heroImage?: unknown;
      generatedSiteHtml?: unknown;
      generatedSiteVersion?: unknown;
    };
    const heroImage = typeof record.heroImage === "string" ? record.heroImage : "";
    const generatedSiteHtml =
      typeof record.generatedSiteHtml === "string" ? record.generatedSiteHtml : null;
    const generatedSiteVersion =
      typeof record.generatedSiteVersion === "number" ? record.generatedSiteVersion : null;

    if (heroImage || generatedSiteHtml) {
      blobs.push({ id: record.id, heroImage, generatedSiteHtml, generatedSiteVersion });
    }

    const { heroImage: _heroImage, generatedSiteHtml: _html, ...rest } = record;
    index.push({ ...(rest as SavedProjectIndexEntry), generatedSiteVersion });
  }

  return { index, blobs, droppedCount };
}
