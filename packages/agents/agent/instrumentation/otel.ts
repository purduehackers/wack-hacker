import { otel } from "eve/instrumentation/otel";

export default otel({
  traceChannelRequests: true,
  // Preserve the existing deployment's deliberate input/output capture policy.
  tracePolicy: () => ({ emit: true, recordInputs: true, recordOutputs: true }),
});
