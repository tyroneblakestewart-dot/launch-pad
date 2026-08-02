/**
 * Signal used by chrome that lives outside the token studio workspace (the
 * top bar and hero CTA) to open it directly, without duplicating the
 * open/focus logic that already lives in TokenStudioWorkspace.
 */
export const OPEN_WORKSPACE_REQUEST_EVENT = "launchpad:open-workspace-request";

export type WorkspaceOpenAction = "new" | "saved";

export type OpenWorkspaceRequestDetail = Readonly<{ action: WorkspaceOpenAction }>;

export function requestWorkspaceOpen(action: WorkspaceOpenAction): void {
  window.dispatchEvent(
    new CustomEvent<OpenWorkspaceRequestDetail>(OPEN_WORKSPACE_REQUEST_EVENT, {
      detail: { action },
    }),
  );
}
