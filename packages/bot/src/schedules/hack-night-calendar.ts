/**
 * Approved CMS slots for the rest of the 2026–27 school year.
 *
 * Dates follow https://www.purdue.edu/registrar/calendars/academic/, checked
 * October 11, 2026. Club exceptions: no Thanksgiving/finals events, Hack Lite
 * before spring break, and a patch-version encore before spring finals.
 * Missing weeks deliberately have no slot. Extend this list when the next
 * semester's events are approved; never infer approval from a CMS title alone.
 */

import { calendarDate, TIME_ZONE } from "../utils/dates.ts";

export interface HackNightSlot {
  readonly id: number;
  readonly date: string;
  readonly slug: string;
  readonly name: string;
  readonly eventType: string;
}

function night(id: number, date: string, version: string): HackNightSlot {
  return { id, date, slug: version, name: `Hack Night ${version}`, eventType: "hack-night" };
}

export const HACK_NIGHT_CALENDAR: readonly HackNightSlot[] = [
  night(216, "2026-10-16", "7.5"),
  night(217, "2026-10-23", "7.6"),
  night(219, "2026-10-30", "7.7"),
  night(220, "2026-11-06", "7.8"),
  night(221, "2026-11-13", "7.9"),
  night(222, "2026-11-20", "7.10"),
  night(223, "2026-12-04", "7.11"),
  night(224, "2026-12-11", "7.12"),
  night(225, "2027-01-15", "7.13"),
  night(226, "2027-01-22", "7.14"),
  night(227, "2027-01-29", "7.15"),
  night(228, "2027-02-05", "7.16"),
  night(229, "2027-02-12", "7.17"),
  night(230, "2027-02-19", "7.18"),
  night(231, "2027-02-26", "7.19"),
  night(232, "2027-03-05", "7.20"),
  {
    id: 233,
    date: "2027-03-12",
    slug: "hack-lite-spring-2027",
    name: "Hack Lite",
    eventType: "Special",
  },
  night(234, "2027-03-26", "7.21"),
  night(235, "2027-04-02", "7.22"),
  night(236, "2027-04-09", "7.23"),
  night(237, "2027-04-16", "7.24"),
  night(238, "2027-04-23", "7.25"),
  night(239, "2027-04-30", "7.25.1"),
];

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

/** Local components only; never use this string as a UTC instant. */
export function hackNightLocalTime(iso: string | undefined | null): string | undefined {
  const at = new Date(iso ?? "");
  if (!Number.isFinite(at.getTime())) return undefined;
  const components = new Map(formatter.formatToParts(at).map((part) => [part.type, part.value]));
  return `${components.get("year")}-${components.get("month")}-${components.get("day")}T${components.get("hour")}:${components.get("minute")}:${components.get("second")}`;
}

/** The current local week's Friday; a break never advances to the next event. */
export function thisWeeksHackNight(now: Date): HackNightSlot | undefined {
  const { year, month, day } = calendarDate(now);
  const date = new Date(Date.UTC(year, month - 1, day));
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - mondayOffset + 4);
  const friday = date.toISOString().slice(0, 10);
  return HACK_NIGHT_CALENDAR.find((slot) => slot.date === friday);
}
