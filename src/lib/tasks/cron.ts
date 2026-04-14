const DEFAULT_TZ = "America/Indiana/Indianapolis";

function parseField(field: string, min: number, max: number): Set<number> {
  const values = new Set<number>();

  for (const part of field.split(",")) {
    const stepMatch = part.match(/^(.+)\/(\d+)$/);
    const step = stepMatch ? parseInt(stepMatch[2], 10) : 1;
    const range = stepMatch ? stepMatch[1] : part;

    if (range === "*") {
      for (let i = min; i <= max; i += step) values.add(i);
    } else if (range.includes("-")) {
      const [lo, hi] = range.split("-").map(Number);
      for (let i = lo; i <= hi; i += step) values.add(i);
    } else {
      values.add(parseInt(range, 10));
    }
  }

  return values;
}

function parseCron(expr: string) {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`Invalid cron: expected 5 fields, got ${parts.length}`);

  return {
    minute: parseField(parts[0], 0, 59),
    hour: parseField(parts[1], 0, 23),
    dayOfMonth: parseField(parts[2], 1, 31),
    month: parseField(parts[3], 1, 12),
    dayOfWeek: parseField(parts[4], 0, 6),
  };
}

/** Find the next value >= `from` in a sorted set, or null if none. */
function nextIn(set: Set<number>, from: number): number | null {
  return [...set].sort((a, b) => a - b).find((v) => v >= from) ?? null;
}

function toTZ(date: Date, tz: string) {
  const str = date.toLocaleString("en-US", { timeZone: tz, hour12: false });
  const [datePart, timePart] = str.split(", ");
  const [month, day, year] = datePart.split("/").map(Number);
  const [hour, minute, second] = timePart.split(":").map(Number);
  return { year, month, day, hour: hour === 24 ? 0 : hour, minute, second };
}

function fromTZ(
  parts: { year: number; month: number; day: number; hour: number; minute: number },
  tz: string,
): Date {
  // Treat parts as if they were UTC to get a starting guess
  const guess = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute),
  );
  // See what local time that UTC instant maps to
  const local = toTZ(guess, tz);
  // Convert that local time back to a UTC-based timestamp to measure the offset
  const localAsUTC = new Date(
    Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute),
  );
  const offsetMs = localAsUTC.getTime() - guess.getTime();
  return new Date(guess.getTime() - offsetMs);
}

/**
 * Compute the next occurrence of a 5-field cron expression after `after`.
 * Supports: `*`, ranges (`1-5`), lists (`1,3,5`), and steps (`*​/15`).
 */
export function nextOccurrence(cron: string, after: Date, timezone?: string): Date {
  const tz = timezone ?? DEFAULT_TZ;
  const fields = parseCron(cron);

  // Start one minute past `after` in the target timezone
  const start = toTZ(new Date(after.getTime() + 60_000), tz);
  let { year, month, day } = start;
  let startHour = start.hour;
  let startMinute = start.minute;

  // Search up to ~4 years of days
  const maxDays = 366 * 4;
  for (let d = 0; d < maxDays; d++) {
    const date = new Date(year, month - 1, day);
    const cy = date.getFullYear();
    const cm = date.getMonth() + 1;
    const cd = date.getDate();
    const dow = date.getDay();

    if (fields.month.has(cm) && fields.dayOfMonth.has(cd) && fields.dayOfWeek.has(dow)) {
      // This day matches — find the first matching hour:minute
      const hourFloor = d === 0 ? startHour : 0;

      for (const h of [...fields.hour].sort((a, b) => a - b)) {
        if (h < hourFloor) continue;

        const minuteFloor = d === 0 && h === startHour ? startMinute : 0;
        const m = nextIn(fields.minute, minuteFloor);

        if (m !== null) {
          return fromTZ({ year: cy, month: cm, day: cd, hour: h, minute: m }, tz);
        }
      }
    }

    // Advance to next day, reset hour/minute search
    day += 1;
    startHour = 0;
    startMinute = 0;
  }

  throw new Error(`No cron match found within 4 years for "${cron}"`);
}
