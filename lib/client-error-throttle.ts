// Session-scoped throttle for the client-error reporter (issue #353): never
// send the same message+route twice in one session, and hard-cap total
// reports per session so a crash loop can't flood the endpoint. Reads/writes
// only a small list of already-sanitised group keys under one dedicated
// sessionStorage key — this is not a general read of existing storage
// content, which the feature's privacy rules rule out.

const SESSION_STORAGE_KEY = "hoodlums.client-error-reporter.session";
export const MAX_CLIENT_ERROR_REPORTS_PER_SESSION = 20;

type ReporterSessionState = { sentKeys: string[]; count: number };

type MinimalStorage = Pick<Storage, "getItem" | "setItem">;

function readSessionState(storage: MinimalStorage): ReporterSessionState {
  try {
    const raw = storage.getItem(SESSION_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as ReporterSessionState).sentKeys) &&
      typeof (parsed as ReporterSessionState).count === "number"
    ) {
      return parsed as ReporterSessionState;
    }
  } catch {
    // ignore — treated as a fresh session below
  }
  return { sentKeys: [], count: 0 };
}

/** Claims a one-time send slot for `key`. Returns false if already sent this session or the per-session cap is reached. */
export function claimClientErrorSendSlot(key: string, storage: MinimalStorage): boolean {
  try {
    const state = readSessionState(storage);
    if (state.count >= MAX_CLIENT_ERROR_REPORTS_PER_SESSION || state.sentKeys.includes(key)) return false;
    state.sentKeys.push(key);
    state.count += 1;
    storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}
