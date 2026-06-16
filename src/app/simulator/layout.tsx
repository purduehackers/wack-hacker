import type { ReactNode } from "react";

import { notFound } from "next/navigation";

import { isSimEnabled } from "@/lib/simulator/guard";

/**
 * Gate the dev-only simulator UI exactly like its API routes (`server/index.ts`):
 * a deployment runs with `NODE_ENV=production`, so `isSimEnabled()` is false and
 * the whole `/simulator` segment 404s rather than serving a UI whose backend
 * isn't mounted. Renders only under local `next dev` with `SIMULATOR_ENABLED=1`.
 * Server component (no "use client") so it can read the gate's env server-side.
 */
export default function SimulatorLayout({ children }: { children: ReactNode }) {
  if (!isSimEnabled()) notFound();
  return children;
}
