import { ACCOUNT_WALLET_STORAGE_KEY, parseStoredAccountWallet } from "@/lib/account-wallet-state";
import { putProjectBlob } from "@/lib/token-project-db";
import type { TokenProject } from "@/lib/types";

/**
 * The saved-project index for drafts made with NO wallet confirmed — and,
 * unchanged, the key every pre-wallet-scoping draft was saved under, so
 * existing drafts land in that "unassigned" bucket rather than under any
 * wallet by accident.
 */
export const TOKEN_STUDIO_PROJECTS_STORAGE_KEY = "private-meme-token-studio-projects-v1";

// Per-wallet project scoping (owner direction, 6 Sep 2026: "every new wallet
// has to have its own clean slate"). Saved projects live in one localStorage
// index PER OWNER: the confirmed wallet's lower-cased address, or null for
// drafts saved with no wallet confirmed. A wallet only ever reads its own
// partition, so switching wallets in the same browser can never show another
// wallet's projects. Every reader in the app goes through readProjectIndex /
// writeProjectIndex below (tests pin that no component touches the raw key),
// so there is exactly one place that decides which partition is in play.

/** Lower-cased confirmed wallet address from the stored account-wallet JSON, or null when none is confirmed. */
export function projectOwnerFromStoredWallet(raw: string | null): string | null {
  const account = parseStoredAccountWallet(raw)?.account.trim().toLowerCase();
  return account ? account : null;
}

/** The owner whose partition is currently in play, read from the confirmed wallet in localStorage. Never throws. */
export function currentProjectOwner(): string | null {
  try {
    return projectOwnerFromStoredWallet(localStorage.getItem(ACCOUNT_WALLET_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function projectIndexStorageKey(owner: string | null): string {
  const normalised = owner?.trim().toLowerCase();
  return normalised ? `${TOKEN_STUDIO_PROJECTS_STORAGE_KEY}:${normalised}` : TOKEN_STUDIO_PROJECTS_STORAGE_KEY;
}

/** `undefined` means "whichever owner is confirmed right now"; `null` means the unassigned (no-wallet) bucket. */
type OwnerArgument = string | null | undefined;

function resolveOwner(owner: OwnerArgument): string | null {
  return owner === undefined ? currentProjectOwner() : owner;
}

/** The saved-project index for one owner's partition. Never throws — unreadable storage reads as empty. */
export function readProjectIndex(owner?: OwnerArgument): SavedProjectIndexEntry[] {
  try {
    return parseSavedTokenProjects(localStorage.getItem(projectIndexStorageKey(resolveOwner(owner))));
  } catch {
    return [];
  }
}

/** Writes one owner's partition. Throws on a storage failure (quota etc.) so callers can report it, like the persistence layer does. */
export function writeProjectIndex(entries: readonly SavedProjectIndexEntry[], owner?: OwnerArgument): void {
  localStorage.setItem(projectIndexStorageKey(resolveOwner(owner)), serialiseSavedTokenProjects([...entries]));
}

/** Drafts saved with no wallet confirmed (which includes every draft saved before wallet scoping existed). */
export function readUnassignedProjectIndex(): SavedProjectIndexEntry[] {
  return readProjectIndex(null);
}

export type MoveUnassignedProjectsResult = {
  moved: number;
  /** The owner's partition after the move, moved entries first. */
  index: SavedProjectIndexEntry[];
};

/**
 * Moves unassigned drafts into a wallet's partition — all of them, or only
 * the given ids. This is the ONLY way a draft ever changes owner, and it is
 * always an explicit act (a tap on "Move to this wallet", or confirming a
 * wallet while that very draft is open); nothing is ever attributed
 * silently. Entries already present in the wallet's partition (same id) are
 * replaced by the moved copy. Throws on a storage failure; the unassigned
 * bucket is only rewritten after the wallet partition write succeeded, so a
 * failure never loses a draft.
 */
export function moveUnassignedProjects(owner: string, ids?: readonly string[]): MoveUnassignedProjectsResult {
  const normalisedOwner = owner.trim().toLowerCase();
  if (!normalisedOwner) throw new Error("A wallet is required to take ownership of drafts.");

  const unassigned = readUnassignedProjectIndex();
  const wanted = ids ? new Set(ids) : null;
  const moving = unassigned.filter((entry) => (wanted ? wanted.has(entry.id) : true));
  const current = readProjectIndex(normalisedOwner);
  if (moving.length === 0) return { moved: 0, index: current };

  const movingIds = new Set(moving.map((entry) => entry.id));
  const index = [...moving, ...current.filter((entry) => !movingIds.has(entry.id))];
  writeProjectIndex(index, normalisedOwner);
  writeProjectIndex(unassigned.filter((entry) => !movingIds.has(entry.id)), null);
  return { moved: moving.length, index };
}

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
