/**
 * The simulator installs process-global fakes (Redis override, Discord REST
 * swap). These must never run in a real bot process, so every entry point is
 * gated on an explicit dev-only flag.
 */
export function isSimEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.SIMULATOR_ENABLED === "1";
}

export function assertSimEnabled(): void {
  if (!isSimEnabled()) {
    throw new Error(
      "Simulator is disabled. Set SIMULATOR_ENABLED=1 in a non-production environment.",
    );
  }
}
