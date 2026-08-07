export const INDIANA_TIME_ZONE = "America/Indiana/Indianapolis";

interface CalendarParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly weekday: number;
}

const WEEKDAYS: Readonly<Record<string, number>> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: INDIANA_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  weekday: "short",
  hourCycle: "h23",
});

function numberPart(parts: ReadonlyMap<string, string>, name: string): number {
  const value = parts.get(name);
  if (value === undefined) throw new Error(`Intl omitted ${name}`);
  return Number(value);
}

export function indianaParts(date: Date): CalendarParts {
  const values = new Map(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const weekdayName = values.get("weekday");
  const weekday = weekdayName === undefined ? undefined : WEEKDAYS[weekdayName];
  if (weekday === undefined) throw new Error("Intl returned an unknown weekday");
  return {
    year: numberPart(values, "year"),
    month: numberPart(values, "month"),
    day: numberPart(values, "day"),
    hour: numberPart(values, "hour"),
    minute: numberPart(values, "minute"),
    second: numberPart(values, "second"),
    weekday,
  };
}

function zonedInstant(parts: {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour?: number;
  readonly minute?: number;
  readonly second?: number;
}): Date {
  const { year, month, day, hour = 0, minute = 0, second = 0 } = parts;
  const wallClockUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let candidate = wallClockUtc;
  for (let pass = 0; pass < 3; pass += 1) {
    const actual = indianaParts(new Date(candidate));
    const represented = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    candidate += wallClockUtc - represented;
  }
  return new Date(candidate);
}

export function nextIndianaMidnight(date: Date): Date {
  const local = indianaParts(date);
  const tomorrow = new Date(Date.UTC(local.year, local.month - 1, local.day + 1, 12));
  return zonedInstant({
    year: tomorrow.getUTCFullYear(),
    month: tomorrow.getUTCMonth() + 1,
    day: tomorrow.getUTCDate(),
  });
}

export function indianaWallClock(date: Date): Date {
  const local = indianaParts(date);
  return new Date(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
    date.getMilliseconds(),
  );
}

export function indianaDate(date: Date): {
  readonly year: number;
  readonly month: number;
  readonly day: number;
} {
  const { year, month, day } = indianaParts(date);
  return { year, month, day };
}

export function fridayOfIndianaWeek(date: Date): Date {
  const local = indianaParts(date);
  const friday = new Date(
    Date.UTC(local.year, local.month - 1, local.day - ((local.weekday + 2) % 7), 12),
  );
  return zonedInstant({
    year: friday.getUTCFullYear(),
    month: friday.getUTCMonth() + 1,
    day: friday.getUTCDate(),
    hour: 12,
  });
}

export function indianaMinuteId(date: Date): string {
  const local = indianaParts(date);
  return [local.year, local.month, local.day, local.hour, local.minute]
    .map((part) => String(part).padStart(2, "0"))
    .join("");
}
