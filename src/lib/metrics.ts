import * as Sentry from "@sentry/nextjs";

type Attrs = Record<string, string | number>;

export function countMetric(name: string, attrs?: Attrs) {
  Sentry.metrics.count(name, 1, { attributes: attrs });
}

export function recordDuration(name: string, ms: number, attrs?: Attrs) {
  Sentry.metrics.distribution(name, ms, { unit: "millisecond", attributes: attrs });
}

export function recordDistribution(name: string, value: number, attrs?: Attrs) {
  Sentry.metrics.distribution(name, value, { attributes: attrs });
}
