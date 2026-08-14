import { putProjectBlob } from "@/lib/token-project-db";
import type { TokenProject } from "@/lib/types";

export const TOKEN_STUDIO_PROJECTS_STORAGE_KEY = "private-meme-token-studio-projects-v1";

/**
 * Everything localStorage is allowed to hold for a saved launch. The two
 * heavy fields (`heroImage`, `generatedSiteHtml`) live in IndexedDB instead
 * — a full generated site + artwork data URL routinely exceeds the ~5MB
 * localStorage quota, which used to make saves fail silently (issue #307).
 */
export type SavedProjectIndexEntry = Omit<TokenProject, "heroImage" | "generatedSiteHtml">;

function isStoredIndexEntry(value: unknown): value is SavedProjectIndexEntry {
  return typeof value === "object" && value !== null && typeof (value as { id?: unknown }).id === "string";
}

export function toIndexEntry(project: TokenProject): SavedProjectIndexEntry {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured only to drop the two heavy fields
  const { heroImage, generatedSiteHtml, ...entry } = project;
  return entry;
}

export function parseSavedTokenProjects(raw: string | null): SavedProjectIndexEntry[] {
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isStoredIndexEntry);
  } catch {
    return [];
  }
}

export function serialiseSavedTokenProjects(entries: SavedProjectIndexEntry[]): string {
  return JSON.stringify(entries);
}

export type LegacyMigrationResult = {
  index: SavedProjectIndexEntry[];
  /** Legacy rows that carried inline heroImage/generatedSiteHtml and were moved into IndexedDB. */
  migratedCount: number;
  /** Rows that could not be parsed or recovered, and were dropped. */
  droppedCount: number;
};

function hasInlineHeavyData(record: Record<string, unknown>): boolean {
  return (
    (typeof record.heroImage === "string" && record.heroImage.length > 0) ||
    (typeof record.generatedSiteHtml === "string" && record.generatedSiteHtml.length > 0)
  );
}

/**
 * Reads whatever is currently in the localStorage index and, for any
 * pre-migration row still carrying the full generated HTML/artwork inline,
 * moves that heavy data into IndexedDB and rewrites the row as a lightweight
 * index entry. Rows that cannot be parsed at all, or whose heavy data fails
 * to migrate (for example because IndexedDB itself is unavailable), are
 * dropped rather than kept around as an entry that can never reopen
 * (issue #307). Safe to run on every load — already-migrated rows and rows
 * with no heavy data pass through unchanged, so a second run finds nothing
 * left to do.
 */
export async function migrateLegacySavedProjects(raw: string | null): Promise<LegacyMigrationResult> {
  if (!raw) return { index: [], migratedCount: 0, droppedCount: 0 };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { index: [], migratedCount: 0, droppedCount: 1 };
  }
  if (!Array.isArray(parsed)) return { index: [], migratedCount: 0, droppedCount: 0 };

  const index: SavedProjectIndexEntry[] = [];
  let migratedCount = 0;
  let droppedCount = 0;

  for (const item of parsed) {
    if (!isStoredIndexEntry(item)) {
      droppedCount += 1;
      continue;
    }

    const record = item as Record<string, unknown> & { id: string };
    if (!hasInlineHeavyData(record)) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured only to drop the two heavy fields
      const { heroImage, generatedSiteHtml, ...entry } = record;
      index.push(entry as SavedProjectIndexEntry);
      continue;
    }

    const { heroImage, generatedSiteHtml, ...entry } = record;
    try {
      await putProjectBlob(record.id, {
        heroImage: typeof heroImage === "string" ? heroImage : "",
        generatedSiteHtml: typeof generatedSiteHtml === "string" ? generatedSiteHtml : null,
      });
      index.push(entry as SavedProjectIndexEntry);
      migratedCount += 1;
    } catch {
      droppedCount += 1;
    }
  }

  return { index, migratedCount, droppedCount };
}
