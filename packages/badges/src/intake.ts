import type { MessagePayload } from "@repo/shared/wire";

import type { BadgeEvent, Criterion, Review } from "./contracts.ts";

/** Read explicit attachment order only. Filenames and SVG text are not instructions. */
export function badgeIndex(text: string): number | undefined {
  const badgeFirst =
    /\b(?:badge\s+(?:is\s+)?(?:the\s+)?first|first\s+(?:one\s+)?(?:is\s+)?(?:(?:the|a)\s+)?badge|stamp\s+(?:is\s+)?(?:the\s+)?second)\b/iu.test(
      text,
    );
  const stampFirst =
    /\b(?:stamp\s+(?:is\s+)?(?:the\s+)?first|first\s+(?:one\s+)?(?:is\s+)?(?:(?:the|a)\s+)?stamp|badge\s+(?:is\s+)?(?:the\s+)?second)\b/iu.test(
      text,
    );
  return badgeFirst === stampFirst ? undefined : Number(!badgeFirst);
}

export function singleRole(text: string, previous?: Review): Criterion | undefined {
  const badge = /\bbadge\b/iu.test(text),
    stamp = /\bstamp\b/iu.test(text);
  if (badge !== stamp) return badge ? "badge" : "stamp";
  if (!previous) return undefined;
  if (previous.pendingRole) return previous.pendingRole;
  if (previous.badge && !previous.stamp) return "stamp";
  if (previous.stamp && !previous.badge) return "badge";
  return undefined;
}

export function inferEvent(
  payload: MessagePayload,
  candidates: BadgeEvent[],
  previous?: BadgeEvent,
) {
  const versions = [...payload.content.matchAll(/\bHack\s+Night\s+(\d+\.\d+)\b/giu)].map(
    (match) => match[1],
  );
  const links = [
    ...payload.content.matchAll(/https:\/\/(?:events|cms)\.purduehackers\.com\/[^\s<>)]*/gu),
  ]
    .map((match) => (URL.canParse(match[0]) ? new URL(match[0]) : undefined))
    .filter((url) => url !== undefined);
  const matches = candidates.filter(
    (event) =>
      versions.includes(event.version) ||
      links.some((url) => {
        const segments = url.pathname.split("/").filter(Boolean);
        if (url.hostname === "events.purduehackers.com")
          return segments[0] === "events" && segments.at(-1) === event.slug;
        return ["/api/events/", "/admin/collections/events/"].some(
          (prefix) => url.pathname === `${prefix}${event.id}`,
        );
      }),
  );
  if (matches.length === 1) return matches[0];
  if (versions.length || links.length || matches.length) return undefined;
  return previous ?? (candidates.length === 1 ? candidates[0] : undefined);
}
