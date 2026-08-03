import type { LaunchPath } from "./types";

/**
 * Signal used by chrome that lives outside the token studio workspace (the
 * top bar, hero CTA and plans section) to open it directly, without
 * duplicating the open/focus logic that already lives in TokenStudioWorkspace.
 */
export const OPEN_WORKSPACE_REQUEST_EVENT = "launchpad:open-workspace-request";

export type WorkspaceOpenAction = "new" | "saved";

export type OpenWorkspaceRequestDetail = Readonly<{
  action: WorkspaceOpenAction;
  launchPath?: LaunchPath;
}>;

export function requestWorkspaceOpen(
  action: WorkspaceOpenAction,
  launchPath?: LaunchPath,
  target?: EventTarget,
): void {
  const eventTarget = target ?? (typeof window === "undefined" ? null : window);
  if (!eventTarget) return;

  eventTarget.dispatchEvent(
    new CustomEvent<OpenWorkspaceRequestDetail>(OPEN_WORKSPACE_REQUEST_EVENT, {
      detail: launchPath ? { action, launchPath } : { action },
    }),
  );
}
