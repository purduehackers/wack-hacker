import { z } from "zod";

import type { ChartRow, ChartSpec } from "./spec.ts";

export interface ChartPoint {
  readonly x: string | number;
  readonly y: number | null;
  readonly series: string;
}

function metricValue(entries: z.JSONType[], key: string): z.JSONType | undefined {
  for (const candidate of entries) {
    const parsed = z.object({ type: z.string(), value: z.json() }).safeParse(candidate);
    if (parsed.success && parsed.data.type === key) return parsed.data.value;
  }
  return undefined;
}

export function fieldValue(
  entry: ChartRow,
  path: string,
): z.output<ReturnType<typeof z.json>> | undefined {
  let value: z.output<ReturnType<typeof z.json>> | undefined = entry;
  for (const key of path.split(".")) {
    if (Array.isArray(value)) {
      value = metricValue(value, key);
    } else {
      value = z.record(z.string(), z.json()).safeParse(value).data?.[key];
    }
  }
  return value;
}

function bucketDate(value: string | number, spec: ChartSpec): string | number {
  if (!spec.timeBucket) return value;
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) throw new Error("A time bucket requires valid timestamps");
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: spec.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (name: string) => dateParts.find((entry) => entry.type === name)?.value ?? "";
  // Date-only source values already name a calendar day; do not move them backward in a western timezone.
  const day = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/u)
    .safeParse(value).success
    ? String(value)
    : `${part("year")}-${part("month")}-${part("day")}`;
  if (spec.timeBucket === "month") return day.slice(0, 7);
  if (spec.timeBucket === "day") return day;
  const local = new Date(`${day}T00:00:00Z`);
  local.setUTCDate(local.getUTCDate() - ((local.getUTCDay() + 6) % 7));
  return local.toISOString().slice(0, 10);
}

export function chartPoints(rows: readonly ChartRow[], spec: ChartSpec): ChartPoint[] {
  const points = rows.map((entry) => {
    const x = z.union([z.string().max(200), z.number()]).parse(fieldValue(entry, spec.x));
    const raw = spec.aggregate === "count" ? 1 : fieldValue(entry, spec.y);
    // oxlint-disable-next-line unicorn/no-null -- ECharts uses null to represent missing measurements without inventing zero
    const y = raw === undefined || raw === null ? null : z.number().parse(raw);
    const series = spec.series
      ? z
          .union([z.string().max(100), z.number()])
          .parse(fieldValue(entry, spec.series))
          .toString()
      : (spec.yLabel ?? spec.y);
    return { x: bucketDate(x, spec), y, series };
  });
  const groups = new Map<string, ChartPoint[]>();
  for (const datum of points) {
    const key = JSON.stringify([datum.x, datum.series]);
    groups.set(key, [...(groups.get(key) ?? []), datum]);
  }
  const result = [...groups.values()].map((members) => {
    const first = members[0];
    if (!first) throw new Error("Empty chart members");
    if (members.length === 1 || spec.aggregate === "none") {
      if (members.length > 1 && spec.type !== "scatter" && spec.type !== "histogram")
        throw new Error("Duplicate x/series observations require an explicit aggregation");
      return first;
    }
    const observations = members.map((datum) => datum.y);
    if (observations.some((value) => value === null)) {
      // oxlint-disable-next-line unicorn/no-null -- preserve unknown measurements through aggregates
      return { ...first, y: null };
    }
    const total = observations.reduce<number>((sum, value) => sum + (value ?? 0), 0);
    return { ...first, y: spec.aggregate === "mean" ? total / observations.length : total };
  });
  const selected = spec.type === "scatter" || spec.type === "histogram" ? points : result;
  if (new Set(selected.map((datum) => datum.series)).size > 12)
    throw new Error("A chart supports at most 12 series");
  if (selected.length > 1000 && spec.type !== "histogram")
    throw new Error("Aggregate the data to at most 1000 plotted points");
  if (spec.sort !== "input")
    selected.sort(
      (a, b) =>
        String(a.x).localeCompare(String(b.x), undefined, { numeric: true }) *
        (spec.sort === "descending" ? -1 : 1),
    );
  return selected;
}

/** Quote every cell and neutralize spreadsheet formulas in textual input. */
export function chartCsv(rows: readonly ChartRow[]): string {
  const keys = [...new Set(rows.flatMap((entry) => Object.keys(entry)))];
  const cell = (value: z.output<ReturnType<typeof z.json>> | undefined) => {
    const text =
      value === undefined || value === null
        ? ""
        : (z.string().safeParse(value).data ?? JSON.stringify(value));
    const safe =
      z.string().safeParse(value).success && /^(?:[\t\r\n]|\s*[=+@-])/u.test(text)
        ? `'${text}`
        : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  return [
    keys.map(cell).join(","),
    ...rows.map((entry) => keys.map((key) => cell(entry[key])).join(",")),
  ].join("\r\n");
}
