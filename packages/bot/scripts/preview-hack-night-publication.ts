/** Read-only CMS preview. The optional argument simulates a scheduler instant. */

import { InvalidInput } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";

import { createCmsClient } from "../src/integrations/cms.ts";
import { thisWeeksHackNight } from "../src/schedules/hack-night-calendar.ts";
import { publicationCandidate } from "../src/schedules/hack-night-publication.ts";

const now = new Date(process.argv[2] ?? Date.now());
if (!Number.isFinite(now.getTime())) {
  throw new InvalidInput({
    subject: "preview time",
    issues: ["use an ISO timestamp with an offset"],
  });
}
const slot = thisWeeksHackNight(now);
if (slot === undefined) {
  console.info("No approved Hack Night this week; no publication.");
} else {
  const apiKey = process.env.PAYLOAD_CMS_API_KEY;
  if (!apiKey) {
    throw new InvalidInput({
      subject: "preview environment",
      issues: ["PAYLOAD_CMS_API_KEY is required"],
    });
  }
  const listed = await createCmsClient({ apiKey }).listUpcomingEvents(now);
  if (Result.isError(listed)) throw listed.error;
  const selected = publicationCandidate(listed.value, now);
  if (Result.isError(selected)) throw selected.error;
  console.info(
    JSON.stringify(
      {
        checkedAt: now.toISOString(),
        slot,
        wouldPublish: selected.value !== undefined,
        reason:
          selected.value === undefined
            ? "already published or event has started"
            : "matches approved schedule",
      },
      undefined,
      2,
    ),
  );
}
