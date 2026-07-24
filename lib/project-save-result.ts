/**
 * Explicit result signal used only when the workspace wrapper requested
 * "Save & close". A rejected slug save therefore leaves the editor open.
 */
export const PROJECT_SAVE_RESULT_EVENT = "launchpad:project-save-result";

export type ProjectSaveResultDetail = Readonly<{ success: boolean }>;

export function shouldCloseWorkspaceAfterSave(
  detail: ProjectSaveResultDetail | null | undefined,
): boolean {
  return detail?.success === true;
}
