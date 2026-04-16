import { createInstrumentation } from "evlog/next/instrumentation";

export const { register, onRequestError } = createInstrumentation({
  service: "wack-hacker",
});
