/**
 * Time zones for Social Studio scheduling (owner direction, 7 Sep 2026:
 * "what happened to time zones, that needs to come back … and have an edit
 * local time tab").
 *
 * The Calendar tab used to carry a three-option select whose hardcoded
 * offsets nothing ever read; PR #534 replaced it with an honest read-only
 * line naming the browser's own zone, because every time on the page is
 * browser-local by nature. This module is what makes a *chosen* zone real:
 * the wall clock the calendar shows, the day a post belongs to, quiet
 * hours and the schedule pickers are all computed in it.
 *
 * `null` everywhere means "follow the device", and every helper with an
 * optional `timeZone` behaves exactly as before when it is absent — the
 * device path uses `Date`'s own local getters, not a zone conversion, so
 * nothing about the default experience changes.
 */

/** A wall-clock reading — what a person sees on a clock in some zone. `month` is 0-based, like `Date`. */
export type WallClock = { year: number; month: number; day: number; hour: number; minute: number };

const PART_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(zone: string): Intl.DateTimeFormat {
  let formatter = PART_FORMATTERS.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    PART_FORMATTERS.set(zone, formatter);
  }
  return formatter;
}

/** The browser's own zone, or "" when the runtime cannot say. */
export function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

/** Whether the runtime recognises this IANA zone name. */
export function isValidTimezone(zone: unknown): zone is string {
  if (typeof zone !== "string" || !zone.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** A stored zone, or `null` for "follow the device" — which is also what an unrecognised name falls back to, never a wrong clock. */
export function normaliseTimezone(raw: unknown): string | null {
  return isValidTimezone(raw) ? raw : null;
}

/** The zone actually in force: the chosen one, else the device's. */
export function effectiveTimezone(chosen: string | null | undefined): string {
  return chosen && isValidTimezone(chosen) ? chosen : detectTimezone();
}

/** "Europe/London · GMT+1" for the line above the calendar; the bare zone when the offset cannot be read, and a plain phrase when neither can. */
export function describeTimezone(zone: string | null | undefined, now: Date = new Date()): string {
  const resolved = effectiveTimezone(zone);
  if (!resolved) return "your local time";
  try {
    const offset = new Intl.DateTimeFormat("en-GB", { timeZone: resolved, timeZoneName: "shortOffset" })
      .formatToParts(now)
      .find((part) => part.type === "timeZoneName")?.value;
    return offset ? `${resolved} · ${offset}` : resolved;
  } catch {
    return resolved;
  }
}

/** A short curated list for a runtime without `Intl.supportedValuesOf`, so the picker is never empty. */
const FALLBACK_TIMEZONES = [
  "Africa/Johannesburg", "Africa/Lagos", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "America/New_York", "America/Sao_Paulo", "America/Toronto", "Asia/Dubai", "Asia/Hong_Kong",
  "Asia/Kolkata", "Asia/Seoul", "Asia/Shanghai", "Asia/Singapore", "Asia/Tokyo",
  "Australia/Melbourne", "Australia/Sydney", "Europe/Amsterdam", "Europe/Berlin", "Europe/Dublin",
  "Europe/Lisbon", "Europe/London", "Europe/Madrid", "Europe/Paris", "Europe/Warsaw", "UTC",
];

/** Every zone the runtime knows, plus any zone already in play, sorted — the picker's source. */
export function listTimezones(...include: Array<string | null | undefined>): string[] {
  let zones: string[];
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
    zones = typeof supported === "function" ? supported.call(Intl, "timeZone") : [...FALLBACK_TIMEZONES];
  } catch {
    zones = [...FALLBACK_TIMEZONES];
  }
  const all = new Set(zones);
  for (const zone of include) {
    if (isValidTimezone(zone)) all.add(zone);
  }
  return [...all].sort((a, b) => a.localeCompare(b));
}

/** Zone names compare as plain words: "America/New_York" reads "america new york", so "new yor" finds it. */
function searchable(value: string): string {
  return value.toLowerCase().replace(/[_/]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Country and region words that IANA zone names never contain (owner report,
 * 7 Sep 2026: "limited countries"). Typing the country finds its zone, which
 * a city-only list cannot do — nobody should have to know their zone is
 * named after a city they may not live in.
 */
const TIMEZONE_ALIASES: Record<string, string[]> = {
  uk: ["Europe/London"],
  britain: ["Europe/London"],
  england: ["Europe/London"],
  scotland: ["Europe/London"],
  wales: ["Europe/London"],
  "northern ireland": ["Europe/London"],
  ireland: ["Europe/Dublin"],
  usa: ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles"],
  us: ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles"],
  "united states": ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles"],
  canada: ["America/Toronto", "America/Vancouver"],
  mexico: ["America/Mexico_City"],
  brazil: ["America/Sao_Paulo"],
  argentina: ["America/Buenos_Aires"],
  germany: ["Europe/Berlin"],
  france: ["Europe/Paris"],
  spain: ["Europe/Madrid"],
  portugal: ["Europe/Lisbon"],
  italy: ["Europe/Rome"],
  netherlands: ["Europe/Amsterdam"],
  holland: ["Europe/Amsterdam"],
  poland: ["Europe/Warsaw"],
  turkey: ["Europe/Istanbul"],
  greece: ["Europe/Athens"],
  sweden: ["Europe/Stockholm"],
  norway: ["Europe/Oslo"],
  switzerland: ["Europe/Zurich"],
  russia: ["Europe/Moscow"],
  uae: ["Asia/Dubai"],
  "saudi arabia": ["Asia/Riyadh"],
  israel: ["Asia/Jerusalem"],
  india: ["Asia/Kolkata", "Asia/Calcutta"],
  pakistan: ["Asia/Karachi"],
  china: ["Asia/Shanghai"],
  japan: ["Asia/Tokyo"],
  korea: ["Asia/Seoul"],
  vietnam: ["Asia/Saigon"],
  thailand: ["Asia/Bangkok"],
  philippines: ["Asia/Manila"],
  indonesia: ["Asia/Jakarta"],
  malaysia: ["Asia/Kuala_Lumpur"],
  australia: ["Australia/Sydney", "Australia/Melbourne", "Australia/Perth", "Australia/Brisbane"],
  "new zealand": ["Pacific/Auckland"],
  nigeria: ["Africa/Lagos"],
  "south africa": ["Africa/Johannesburg"],
  kenya: ["Africa/Nairobi"],
  egypt: ["Africa/Cairo"],
  morocco: ["Africa/Casablanca"],
  ghana: ["Africa/Accra"],
};

/**
 * The picker's matches for what the user typed (owner report, 7 Sep 2026:
 * the full zone list as a native dropdown filled the whole screen and was
 * mis-tapped). A country word comes first, then a city that starts with the
 * query, then a zone that starts with it, then anything containing it — so
 * both "uk" and "lond" land on Europe/London.
 */
export function searchTimezones(zones: readonly string[], query: string, limit = 40): string[] {
  const needle = searchable(query);
  if (!needle) return zones.slice(0, limit);
  const aliasKey = Object.keys(TIMEZONE_ALIASES).find((key) => key === needle || key.startsWith(needle));
  // The alias list's own order is the useful one (a country's main zone first),
  // so it ranks ahead of the alphabetical sort below.
  const aliased = new Map<string, number>(
    (aliasKey ? TIMEZONE_ALIASES[aliasKey].filter((zone) => zones.includes(zone)) : []).map((zone, index) => [zone, index - 1000]),
  );
  const scored: Array<{ zone: string; score: number }> = [];
  for (const zone of zones) {
    const whole = searchable(zone);
    const city = searchable(zone.slice(zone.lastIndexOf("/") + 1));
    const score = aliased.has(zone)
      ? (aliased.get(zone) as number)
      : city.startsWith(needle)
        ? 0
        : whole.startsWith(needle)
          ? 1
          : city.includes(needle)
            ? 2
            : whole.includes(needle)
              ? 3
              : Number.NaN;
    if (!Number.isNaN(score)) scored.push({ zone, score });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.zone.localeCompare(b.zone))
    .slice(0, limit)
    .map((entry) => entry.zone);
}

/**
 * What the list shows: the matches while the user is typing, else the
 * suggestions followed by every other zone (owner report, 7 Sep 2026:
 * "limited countries" — the un-typed list stopped at eight, so a zone that
 * was not suggested could only be reached by knowing what to type).
 */
export function buildTimezoneOptions(
  zones: readonly string[],
  query: string,
  current: string | null | undefined,
  device: string | null | undefined,
): string[] {
  if (query.trim()) return searchTimezones(zones, query);
  const suggested = suggestedTimezones(current, device);
  const seen = new Set(suggested);
  return [...suggested, ...zones.filter((zone) => !seen.has(zone))];
}

/** What the picker offers before anything is typed: the zone in force, the device's own, then common ones — never an alphabetical wall starting at Africa/Abidjan. */
export function suggestedTimezones(current: string | null | undefined, device: string | null | undefined, limit = 8): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const zone of [current, device, ...FALLBACK_TIMEZONES]) {
    if (!isValidTimezone(zone) || seen.has(zone)) continue;
    seen.add(zone);
    out.push(zone);
    if (out.length >= limit) break;
  }
  return out;
}

/** "GMT+1" for the zone at this instant — the small print beside each match. */
export function timezoneOffsetLabel(zone: string, now: Date = new Date()): string {
  try {
    return (
      new Intl.DateTimeFormat("en-GB", { timeZone: zone, timeZoneName: "shortOffset" })
        .formatToParts(now)
        .find((part) => part.type === "timeZoneName")?.value ?? ""
    );
  } catch {
    return "";
  }
}

/** The picker's `<optgroup>`s: zones grouped by their region prefix ("Europe", "America", …), each group sorted. */
export function groupTimezones(zones: readonly string[]): Array<{ region: string; zones: string[] }> {
  const groups = new Map<string, string[]>();
  for (const zone of zones) {
    const region = zone.includes("/") ? zone.slice(0, zone.indexOf("/")) : "Other";
    const bucket = groups.get(region);
    if (bucket) bucket.push(zone);
    else groups.set(region, [zone]);
  }
  return [...groups.entries()]
    .map(([region, list]) => ({ region, zones: list.sort((a, b) => a.localeCompare(b)) }))
    .sort((a, b) => a.region.localeCompare(b.region));
}

/** How far `zone` is ahead of UTC at that instant, in milliseconds (negative west of Greenwich). */
export function zoneOffsetMs(zone: string, ms: number): number {
  const parts = partsFormatter(zone).formatToParts(new Date(ms));
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  const asUtc = Date.UTC(read("year"), read("month") - 1, read("day"), read("hour"), read("minute"), read("second"));
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** What a clock in `zone` reads at that instant — the device's own clock when no zone is given. */
export function wallClockIn(date: Date, zone?: string | null): WallClock {
  const resolved = zone && isValidTimezone(zone) ? zone : null;
  if (!resolved) {
    return { year: date.getFullYear(), month: date.getMonth(), day: date.getDate(), hour: date.getHours(), minute: date.getMinutes() };
  }
  const parts = partsFormatter(resolved).formatToParts(date);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  return { year: read("year"), month: read("month") - 1, day: read("day"), hour: read("hour"), minute: read("minute") };
}

/**
 * The instant at which a clock in `zone` reads exactly this wall clock —
 * the device's own clock when no zone is given. Two passes, because the
 * offset to apply depends on the instant we are solving for: the first
 * guess lands within an hour or two, the second corrects it across a
 * daylight-saving change. A wall clock that never happens (the hour a
 * spring-forward skips) resolves to the instant the clock jumps to, and an
 * hour that happens twice resolves to its first occurrence.
 */
export function dateFromWallClock(wall: WallClock, zone?: string | null): Date {
  const resolved = zone && isValidTimezone(zone) ? zone : null;
  if (!resolved) return new Date(wall.year, wall.month, wall.day, wall.hour, wall.minute, 0, 0);
  const asUtc = Date.UTC(wall.year, wall.month, wall.day, wall.hour, wall.minute, 0, 0);
  const firstPass = asUtc - zoneOffsetMs(resolved, asUtc);
  return new Date(asUtc - zoneOffsetMs(resolved, firstPass));
}

/** Whether two instants fall on the same calendar day in `zone`. */
export function isSameZonedDay(a: Date, b: Date, zone?: string | null): boolean {
  const left = wallClockIn(a, zone);
  const right = wallClockIn(b, zone);
  return left.year === right.year && left.month === right.month && left.day === right.day;
}

/** Minutes since midnight on that instant's own clock in `zone`. */
export function zonedMinutesOfDay(date: Date, zone?: string | null): number {
  const wall = wallClockIn(date, zone);
  return wall.hour * 60 + wall.minute;
}
