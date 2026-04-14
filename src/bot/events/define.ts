import type { EventHandler } from "./types";

export function defineEvent<T extends EventHandler>(event: T): T {
  return event;
}
