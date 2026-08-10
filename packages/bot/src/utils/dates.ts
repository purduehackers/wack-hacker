/**
 * Wall-clock helpers for the one timezone this bot cares about.
 *
 * The process runs in UTC. Hack night being an Indiana event is a fact about
 * the domain, not about whichever host happens to run the image, so the zone
 * lives here in version control rather than in a container's `TZ` — the bot
 * runs on Vercel Sandbox, on persistent container hosts, and on laptops, and
 * only one of those was ever configured.
 *
 * `minuteId` is why this matters rather than being a style preference: it is a
 * cross-process coordination key. Two bot instances claim a schedule fire by
 * racing `SET NX` on the same key, so if they ever disagreed about local time
 * their keys would not collide, both claims would win, and the schedule would
 * fire twice with no error anywhere. Deriving it from ambient host config makes
 * that correctness property unasserted; deriving it from `TIME_ZONE` makes it
 * a property of the code.
 */
export const TIME_ZONE = "America/Indiana/Indianapolis";

const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

interface WallClock {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

export interface CalendarDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

function wallClock(at: Date): WallClock {
  const formatted = new Map(formatter.formatToParts(at).map((part) => [part.type, part.value]));
  const read = (name: Intl.DateTimeFormatPartTypes): number => {
    const raw = formatted.get(name);
    if (raw === undefined) throw new Error(`Intl omitted ${name} for ${TIME_ZONE}`);
    return Number(raw);
  };
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}

/** How far this zone runs ahead of UTC at `at`, in milliseconds. */
function offsetMs(at: Date): number {
  const local = wallClock(at);
  const represented = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  );
  // `formatToParts` resolves to the second, so compare against a whole second.
  return represented - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * `at` as a Date whose *local component getters* read this zone's wall clock.
 *
 * For libraries that are ambient-local: `@purduehackers/time` derives Lightning
 * Time from `getHours()`/`getMinutes()`/`getSeconds()`/`getMilliseconds()` on
 * the Date handed to it, so a raw instant reports whichever zone the host runs
 * in — UTC here — and the hack night countdown renders `2~a~9|a` instead of
 * `f~f~f|0`, never reaching `0~0~0|0`. Feeding it a Date built from this zone's
 * parts through the local constructor makes those getters read Indiana on any
 * host, since the constructor is the exact inverse of the getters.
 *
 * The instant this Date names is meaningless; only its components are. Never
 * compare it, store it, or subtract it — convert, read, discard.
 */
export function wallClockDate(at: Date): Date {
  const { year, month, day, hour, minute, second } = wallClock(at);
  // Milliseconds are zone-independent: no real zone offsets by a sub-second.
  return new Date(year, month - 1, day, hour, minute, second, at.getUTCMilliseconds());
}

/** The calendar date `at` falls on in this zone. */
export function calendarDate(at: Date): CalendarDate {
  const { year, month, day } = wallClock(at);
  return { year, month, day };
}

/** The instant of the midnight that ends the day `at` falls on in this zone. */
export function nextMidnight(at: Date): Date {
  const { year, month, day } = wallClock(at);
  const wall = Date.UTC(year, month - 1, day + 1);
  // The offset at the guessed instant can differ from the offset at the real
  // one across a DST boundary, so refine once. This zone never changes clocks
  // at midnight, so the second pass is always a fixed point.
  const guess = wall - offsetMs(new Date(wall));
  return new Date(wall - offsetMs(new Date(guess)));
}

/**
 * The Friday of the hack night week containing `at`.
 *
 * `(weekday + 2) % 7` maps Sunday to 2 and Saturday to 1, so both weekend days
 * walk back to the Friday that started the event rather than forward to the
 * next one.
 *
 * The result is anchored at noon UTC, which reads as 07:00 or 08:00 in this
 * zone and therefore as the same calendar date — the only thing any consumer
 * takes from it. Anchoring this way keeps the zone conversion one-directional.
 */
export function fridayOfWeek(at: Date): Date {
  const { year, month, day } = calendarDate(at);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return new Date(Date.UTC(year, month - 1, day - ((weekday + 2) % 7), 12));
}

/** Stable per-minute identity in this zone, used to make a schedule fire idempotent. */
export function minuteId(at: Date): string {
  const { year, month, day, hour, minute } = wallClock(at);
  return [year, month, day, hour, minute].map((part) => String(part).padStart(2, "0")).join("");
}
