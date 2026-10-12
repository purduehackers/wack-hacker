import { contextHash, remainingCriteria, staticPassed } from "./contracts.ts";
import type { Criterion, Review } from "./contracts.ts";

export type ReviewStep =
  | "files"
  | "checking"
  | "fix"
  | "event"
  | "settings"
  | "packing"
  | "layout"
  | "preparing"
  | Criterion
  | "archiving"
  | "publish"
  | "publishing"
  | "done"
  | "error";

export const reviewLabels: Record<Criterion, string> = {
  version: "Version",
  date: "Date",
  physical: "Physical design",
  stamp: "Stamp",
};

export function currentDecisions(review: Review) {
  const context = contextHash(review);
  return review.decisions.filter((decision) => decision.context === context);
}

export function reviewStep(review: Review): ReviewStep {
  if (review.publication?.shortlink) return "done";
  if (review.failure) return "error";
  if (review.approval) return "publishing";
  if (!review.rolesConfirmed) return "files";
  if (!review.checks.length) return "checking";
  if (!staticPassed(review)) return "fix";
  if (!review.event) return "event";
  if (!review.settings) return "settings";
  if (!review.layouts.length) return "packing";
  if (!review.selectedLayout) return "layout";
  if (!review.manufacturing) return "preparing";
  return remainingCriteria(review)[0] ?? (review.pr ? "publish" : "archiving");
}

export function reviewPrompt(review: Review): string {
  const step = reviewStep(review);
  const decisions = currentDecisions(review);
  const correction = decisions.find((item) => item.criterion === step);
  if (correction && correction.verdict !== "approve")
    return `${reviewLabels[correction.criterion]} ${correction.verdict === "changes" ? "needs a fix" : "needs another look"}: ${correction.note.slice(0, 700)}\n\nUpload a revised SVG when it’s ready, or ask for help here.`;
  const previous = decisions.at(-1);
  const checked =
    previous?.verdict === "approve" ? `${reviewLabels[previous.criterion]} approved. ` : "";
  const layout = review.layouts.find((item) => item.id === review.selectedLayout);
  switch (step) {
    case "files":
      return review.uploads.length === 1
        ? "Which file should this replace?"
        : "Which one is the badge? A is the first image; B is the second.";
    case "checking":
      return "Checking the SVGs…";
    case "fix": {
      const fixes = review.checks.filter((finding) => finding.status !== "pass");
      return [
        "The SVGs need a few fixes:",
        ...fixes
          .slice(0, 3)
          .map(
            (finding) =>
              `${finding.role === "badge" ? "Badge" : "Stamp"}: ${finding.detail.slice(0, 250)}`,
          ),
        fixes.length > 3 ? `${fixes.length - 3} more to check after these.` : "",
        "Upload the corrected SVG when it’s ready.",
      ]
        .filter(Boolean)
        .join("\n");
    }
    case "event":
      return "SVG checks passed. Which Hack Night is this for?";
    case "settings":
      return `${review.event?.name}: what material and sizes are we using?`;
    case "packing":
      return "SVG checks passed. Finding layouts for your two sheets…";
    case "layout":
      return "Here are the layouts. Which size and count do you want?";
    case "preparing":
      return `${layout?.count} badges at ${layout?.widthIn} × ${layout?.heightIn} in. Preparing the previews…`;
    case "version":
      return `${checked}Can an organizer confirm the badge says **${review.event?.version}**? Check the full image and close-ups below.`;
    case "date":
      return `${checked}Does the badge’s date match **${review.event?.date}**?`;
    case "physical":
      return `${checked}Will this cut and engrave clearly at **${layout?.widthIn} × ${layout?.heightIn} in** in ${review.settings?.material}? Check the fine details and thin connections.`;
    case "stamp":
      return `${checked}Does the stamp look right at **${review.settings?.stampSizeIn} in**? The second image is the ${review.settings?.mirrorStamp ? "mirrored" : "unmirrored"} output.`;
    case "archiving":
      return "All reviews passed. Preparing the files for GitHub…";
    case "publish":
      return `Everything’s checked. [Review the files](${review.pr?.url}), then publish when ready.`;
    case "publishing":
      return "Publishing the approved files and creating the download link…";
    case "done":
      return `Done — ${review.publication?.shortlink}`;
    case "error":
      return `I couldn’t finish this step: ${review.failure?.slice(0, 700)}`;
  }
}
