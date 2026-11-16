import { aggregatedPostMetricsArguments } from "../../inputs.ts";
import { defineBufferOperation } from "../../operation.ts";
export const aggregated_post_metrics = defineBufferOperation(
  "aggregatedPostMetrics",
  aggregatedPostMetricsArguments,
);
