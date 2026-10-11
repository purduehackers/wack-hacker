/** Publish this week's approved CMS event before Monday's Discord event sync. */

import { InvalidInput } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";

import type { Schedule } from "../framework/schedules.ts";
import type { CmsClient, CmsError, CmsSyncEvent } from "../integrations/cms.ts";
import { hackNightLocalTime, thisWeeksHackNight } from "./hack-night-calendar.ts";
import type { HackNightSlot } from "./hack-night-calendar.ts";

function isHackNight(event: CmsSyncEvent): boolean {
  return event.eventType === "hack-night" || /^Hack (?:Night|Lite)\b/i.test(event.name ?? "");
}

function mismatch(event: CmsSyncEvent, slot: HackNightSlot): readonly string[] {
  const issues: string[] = [];
  if (String(event.id) !== String(slot.id)) issues.push("CMS event ID changed");
  if (event.slug !== slot.slug || event.name !== slot.name) issues.push("version or name changed");
  if (event.eventType !== slot.eventType) issues.push("event type changed");
  if (event.location_name !== "HIVE (BHEE 270/280)") issues.push("venue changed");
  if (event.published === undefined) issues.push("publication state is missing");
  if (!Number.isFinite(Date.parse(event.updatedAt ?? "")))
    issues.push("revision timestamp is missing");
  if (hackNightLocalTime(event.start) !== `${slot.date}T20:00:00`) {
    issues.push("start must be the approved Friday at 8 PM Eastern");
  }
  const nextDay = new Date(`${slot.date}T12:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  if (hackNightLocalTime(event.end) !== `${nextDay.toISOString().slice(0, 10)}T02:00:00`) {
    issues.push("end must be the following Saturday at 2 AM Eastern");
  }
  return issues;
}

/** Pure selection is also the operator's read-only preview. */
export function publicationCandidate(
  records: readonly CmsSyncEvent[],
  now: Date,
): Result<CmsSyncEvent | undefined, InvalidInput> {
  const slot = thisWeeksHackNight(now);
  if (slot === undefined) return Result.ok(undefined);
  const candidates = records.filter(
    (event) =>
      String(event.id) === String(slot.id) ||
      (isHackNight(event) && hackNightLocalTime(event.start)?.slice(0, 10) === slot.date),
  );
  const event = candidates[0];
  if (candidates.length !== 1 || event === undefined) {
    return Result.err(
      new InvalidInput({
        subject: `Hack Night publication for ${slot.date}`,
        issues: [`expected one approved event; found ${candidates.length}`],
      }),
    );
  }
  const issues = mismatch(event, slot);
  if (issues.length > 0) {
    return Result.err(new InvalidInput({ subject: slot.name, issues }));
  }
  // Weekend/manual reruns cannot publish a past event or jump to next Friday.
  if (Date.parse(event.start ?? "") <= now.getTime() || event.published) {
    return Result.ok(undefined);
  }
  return Result.ok(event);
}

export interface HackNightPublicationDeps {
  readonly cms: Pick<CmsClient, "listUpcomingEvents" | "publishEventIfUnchanged">;
}

export async function publishThisWeeksHackNight(
  deps: HackNightPublicationDeps,
  now = new Date(),
): Promise<Result<void, CmsError | InvalidInput>> {
  if (thisWeeksHackNight(now) === undefined) return Result.ok(undefined);
  const listed = await deps.cms.listUpcomingEvents(now);
  if (Result.isError(listed)) return Result.err(listed.error);
  const selected = publicationCandidate(listed.value, now);
  if (Result.isError(selected)) return Result.err(selected.error);
  if (selected.value === undefined) return Result.ok(undefined);
  const published = await deps.cms.publishEventIfUnchanged(selected.value);
  if (Result.isError(published)) return Result.err(published.error);
  console.info(
    `hack-night-publication: ${selected.value.slug} ${published.value ? "published" : "already published"}`,
  );
  return Result.ok(undefined);
}

export function hackNightPublication(deps: HackNightPublicationDeps) {
  return {
    name: "hack-night-publication",
    cron: "55 8 * * 1",
    run: async () => publishThisWeeksHackNight(deps),
  } satisfies Schedule;
}
