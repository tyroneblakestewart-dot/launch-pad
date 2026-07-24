export const PROJECT_SAVE_RESULT_EVENT = "launchpad:project-save-result";

export type ProjectSaveResultDetail = Readonly<{ success: boolean }>;

export function shouldCloseWorkspaceAfterSave(
  detail: ProjectSaveResultDetail | null | undefined,
): boolean {
  return detail?.success === true;
}
