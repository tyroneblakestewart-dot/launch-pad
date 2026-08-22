export type ClientErrorGroupDetails = {
  message: string;
  routePath: string;
  occurrenceCount: number;
  firstSeen: string;
  lastSeen: string;
  buildId: string | null;
  representativeStack: string | null;
};

/** Plain-text block for the admin Errors section's "Copy details" button (issue #405) — no AI/reply feature, just the group's own already-displayed fields. Kept as its own pure module (rather than inline in the component) so it's directly unit-testable without pulling in the component's CSS module / client-component setup. */
export function buildErrorGroupDetailsText(group: ClientErrorGroupDetails): string {
  const lines = [
    `Message: ${group.message}`,
    `Route: ${group.routePath}`,
    `Build: ${group.buildId ?? "unknown"}`,
    `First seen: ${group.firstSeen}`,
    `Last seen: ${group.lastSeen}`,
    `Occurrences: ${group.occurrenceCount}`,
  ];
  if (group.representativeStack) lines.push(`Stack:\n${group.representativeStack}`);
  return lines.join("\n");
}
