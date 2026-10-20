import { INTEGRATION_DOMAINS } from "./domains.ts";

/** Stable provider namespace; a missing entry never falls back to another provider. */
export function integrationDomainNamed(name: string) {
  const domain = Object.entries(INTEGRATION_DOMAINS).find(([key]) => key === name)?.[1];
  if (domain === undefined) throw new Error(`Unknown integration namespace: ${name}`);
  return domain;
}

export function integrationTool(domainName: string, name: string) {
  const tool = integrationDomainNamed(domainName).tools[name];
  if (tool === undefined) throw new Error(`Unknown integration operation: ${domainName}__${name}`);
  return tool;
}
