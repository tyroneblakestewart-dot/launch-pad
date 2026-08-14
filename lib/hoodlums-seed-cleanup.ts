/**
 * A previous build force-wrote this fixed id into every visitor's saved
 * projects on every page load. Existing users may still have it on disk;
 * this id is used to find and remove that one record without touching
 * anything the user saved themselves.
 */
export const SEEDED_HOODLUMS_LAUNCH_ID = "hoodlums-robinhood-testnet-46630";

export function removeSeededHoodlumsLaunch<T extends { id: string }>(
  projects: readonly T[],
): T[] {
  return projects.filter((project) => project?.id !== SEEDED_HOODLUMS_LAUNCH_ID);
}
