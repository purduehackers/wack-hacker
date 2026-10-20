import { capabilityReport, summarizeCapabilityReport } from "./lib/capability-report.ts";
import { readCapabilitySurface } from "./lib/capability-surface.ts";

const args = Bun.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== "--json")) {
  throw new Error("Usage: bun run report:capabilities [--json]");
}
const { domains } = await readCapabilitySurface();
const report = capabilityReport(domains);
console.info(
  args[0] === "--json" ? JSON.stringify(report, undefined, 2) : summarizeCapabilityReport(report),
);
