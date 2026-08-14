import { deleteProjectBlob, getProjectBlob, putProjectBlob } from "@/lib/token-project-db";
import {
  serialiseSavedTokenProjects,
  toIndexEntry,
  TOKEN_STUDIO_PROJECTS_STORAGE_KEY,
  type SavedProjectIndexEntry,
} from "@/lib/token-project-storage";
import type { TokenProject } from "@/lib/types";

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Something went wrong. Try again in a moment.";
}

function writeIndex(index: SavedProjectIndexEntry[]) {
  localStorage.setItem(TOKEN_STUDIO_PROJECTS_STORAGE_KEY, serialiseSavedTokenProjects(index));
}

export type SaveProjectOutcome =
  | { success: true; index: SavedProjectIndexEntry[] }
  | { success: false; error: string };

/**
 * Saves a project's heavy data (artwork + generated site HTML) to
 * IndexedDB, then updates the lightweight localStorage index. Both steps
 * are awaited and error-handled: a failure at either step is reported back
 * instead of being swallowed, and the localStorage index is left untouched
 * so a project that could not be saved never appears as a "Saved launches"
 * row with nothing behind it (issue #307).
 */
export async function saveProjectToStorage(
  project: TokenProject,
  currentIndex: readonly SavedProjectIndexEntry[],
): Promise<SaveProjectOutcome> {
  try {
    await putProjectBlob(project.id, {
      heroImage: project.heroImage,
      generatedSiteHtml: project.generatedSiteHtml ?? null,
    });
  } catch (error) {
    return {
      success: false,
      error: `Could not save this project locally — ${describeError(error)} Free up browser storage and try again.`,
    };
  }

  const nextIndex = [toIndexEntry(project), ...currentIndex.filter((item) => item.id !== project.id)];
  try {
    writeIndex(nextIndex);
  } catch (error) {
    // Roll back the blob write so it doesn't linger as an orphan with no
    // index entry pointing at it.
    await deleteProjectBlob(project.id).catch(() => {});
    return {
      success: false,
      error: `Could not save this project locally — ${describeError(error)} Free up browser storage and try again.`,
    };
  }

  return { success: true, index: nextIndex };
}

export type LoadProjectOutcome =
  | { success: true; project: TokenProject }
  | { success: false; error: string };

export async function loadProjectFromStorage(
  entry: SavedProjectIndexEntry,
): Promise<LoadProjectOutcome> {
  try {
    const blob = await getProjectBlob(entry.id);
    return {
      success: true,
      project: {
        ...entry,
        heroImage: blob?.heroImage ?? "",
        generatedSiteHtml: blob?.generatedSiteHtml ?? null,
      },
    };
  } catch (error) {
    return { success: false, error: `Could not load this project — ${describeError(error)}` };
  }
}

export type DeleteProjectOutcome =
  | { success: true; index: SavedProjectIndexEntry[] }
  | { success: false; error: string };

export async function deleteProjectFromStorage(
  id: string,
  currentIndex: readonly SavedProjectIndexEntry[],
): Promise<DeleteProjectOutcome> {
  const nextIndex = currentIndex.filter((item) => item.id !== id);
  try {
    writeIndex(nextIndex);
  } catch (error) {
    return { success: false, error: `Could not remove this project — ${describeError(error)}` };
  }
  // The index no longer points at this id either way, so a failure to
  // delete the underlying blob just leaves a harmless orphan rather than a
  // broken row — it never surfaces in the UI again.
  await deleteProjectBlob(id).catch(() => {});
  return { success: true, index: nextIndex };
}
