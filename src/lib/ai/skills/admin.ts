import type { ToolSet } from "ai";

const ADMIN_MARKER = Symbol("admin");

/** Mark a tool as requiring admin access. */
export function admin<T>(t: T): T {
  (t as Record<symbol, boolean>)[ADMIN_MARKER] = true;
  return t;
}

/** Return a copy of the ToolSet with admin-marked tools removed. */
export function filterAdmin(tools: ToolSet): ToolSet {
  const filtered: ToolSet = {};
  for (const [name, t] of Object.entries(tools)) {
    if (!(t as Record<symbol, boolean>)[ADMIN_MARKER]) {
      filtered[name] = t;
    }
  }
  return filtered;
}
