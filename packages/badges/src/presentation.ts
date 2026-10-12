import { contextHash, remainingCriteria, staticPassed } from "./contracts.ts";
import type { Check, Criterion, Review } from "./contracts.ts";

const unclearReply =
  "I couldn’t explain that clearly. Ask me again, or use the latest review card to continue.";

/** Final display boundary for model prose and reviewer notes, never SVG source or diagnostics. */
export function designerText(text: string, fallback = unclearReply): string {
  if (
    /```|`[^`]*[{}();=][^`]*`|<\/?[a-z][^>]*>|(?:^|\n)\s*(?:[[{]\s*"|(?:import|export|const|let|function|class)\s)|\b(?:readyToPublish|staticPassed|evidenceId|contextHash|rubrics?|criteria|criterion|stack trace)\b/iu.test(
      text,
    )
  )
    return fallback;
  const clean = text
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/\p{Extended_Pictographic}|\uFE0F|\u200D|[✓✔✕✖✗✘]/gu, "")
    .replace(/^\s*(?:\[[ xX]\]|[-*]\s+\[[ xX]\])\s*/gmu, "")
    .trim();
  return clean ? clean.slice(0, 1800) : fallback;
}

export function findingGuidance(finding: Pick<Check, "id" | "role">): string {
  switch (finding.id) {
    case "supported":
      return "Simplify effects and flatten the artwork into vector shapes, then export a new SVG.";
    case "palette":
      return finding.role === "stamp"
        ? "Use black and white for the stamp artwork. Keep pure red only for the cutting outline."
        : "Change colored artwork to grayscale. Keep pure red only for the cutting outline.";
    case "vectors":
      return "Replace any pasted images with vector artwork, then export a new SVG.";
    case "text":
      return "Convert the lettering to outlines in your design app, then export again.";
    case "fills":
      return "Outline the strokes in your artwork. Keep the red cutting outline as a stroke.";
    case "cut":
      return "Make the outside cutting line one closed red outline, with no fill, crossings or extra outlines.";
  }
}

export function failureGuidance(detail: string): string {
  if (/newer step|review changed|latest review|stale/iu.test(detail))
    return "This step has changed. Use the buttons on the latest card below.";
  if (/Only the author or an organizer/iu.test(detail))
    return "Ask the designer or an organizer to make this change.";
  if (/Only.*author/iu.test(detail))
    return "Ask the person who started this badge to upload the revision.";
  if (/organizer who completed/iu.test(detail))
    return "The organizer who finished the review needs to publish these files.";
  if (/organizer.*review|every criterion/iu.test(detail))
    return "An organizer needs to finish the remaining review before these files can be shared.";
  if (/Explain what needs/iu.test(detail))
    return "Add a short note about what needs changing or what is hard to see.";
  if (/different review thread|original server thread|p-badges thread/iu.test(detail))
    return "Open the original badge review thread and use its latest card.";
  if (/event.*changed|CMS.*changed/iu.test(detail))
    return "The Hack Night details have changed. Refresh the event before continuing.";
  if (/Attachment is unavailable|Reattach|expired/iu.test(detail))
    return "I couldn’t open that upload. Attach the SVG again and mention me.";
  if (/1 MB|too large/iu.test(detail))
    return "That file is too large. Simplify the design and export an SVG smaller than 1 MB.";
  if (/Attach both|Upload one|exactly.*SVG/iu.test(detail))
    return "Attach both SVGs to start, or one revised SVG to replace an existing design.";
  if (/raster|external|image element/iu.test(detail))
    return "Use vector artwork instead of pasted images, then export a new SVG.";
  if (/SVG|XML|DOCTYPE/iu.test(detail))
    return "I couldn’t read that design. Export a plain SVG from your design app and upload it again.";
  if (/time budget/iu.test(detail))
    return "Finding a layout took too long. Try a smaller range of badge sizes in Change setup.";
  if (/80|100|No.*layout|minimum.*dimension|1\.7.*inch/iu.test(detail))
    return "I couldn’t fit the requested batch at these sizes. Adjust the size range in Change setup, or ask an organizer for help.";
  if (/cut outline|geometry|clearance|overlap/iu.test(detail))
    return "I couldn’t prepare a safe cutting layout. Check the outside outline for crossings and narrow sections, then upload a revised SVG.";
  if (/Publication is locked|approval does not match/iu.test(detail))
    return "These files are already being published. Start a new review thread to change the design.";
  return "I couldn’t finish this step. Try again, or ask an organizer for help if it keeps happening.";
}

export function displayDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

export function dimensions(width: number, height: number): string {
  return `${Number(width.toFixed(2))} × ${Number(height.toFixed(2))} inches`;
}

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
    return `${designerText(correction.note, "Ask the reviewer what needs changing in this part of the design.").slice(0, 700)}\n\nUpload the updated SVG when you’re ready, or ask me for help.`;
  const previous = decisions.at(-1);
  const checked =
    previous?.verdict === "approve" ? `${reviewLabels[previous.criterion]} approved. ` : "";
  const layout = review.layouts.find((item) => item.id === review.selectedLayout);
  switch (step) {
    case "files":
      return review.uploads.length === 1
        ? "Which file should this replace?"
        : "Choose the badge below. I’ll use the other design as the stamp.";
    case "checking":
      return "I’m checking that both designs are ready for cutting and engraving.";
    case "fix": {
      const fixes = review.checks.filter((finding) => finding.status !== "pass");
      return [
        ...fixes
          .slice(0, 3)
          .map(
            (finding) =>
              `**${finding.role === "badge" ? "Badge" : "Stamp"}**\n${findingGuidance(finding)}`,
          ),
        fixes.length > 3 ? `${fixes.length - 3} more to check after these.` : "",
        "Upload the updated SVG when you’re ready.",
      ]
        .filter(Boolean)
        .join("\n\n");
    }
    case "event":
      return "Both files are ready for the next step. Which Hack Night are they for?";
    case "settings":
      return `What material and sizes would you like for ${review.event?.name}? I’ll find options for your two sheets.`;
    case "packing":
      return "I’m finding sizes that fit 80–100 badges on your two sheets.";
    case "layout":
      return "Choose the size and quantity you prefer. Each option fits your two sheets with room around the edges.";
    case "preparing":
      return `You chose ${layout?.count} badges. I’m preparing the previews for review.`;
    case "version":
      return `${checked}Can an organizer confirm the badge says **${review.event?.version}**? Open the full image and close-ups to check.`;
    case "date":
      return `${checked}Does the badge’s date match **${review.event ? displayDate(review.event.date) : "the Hack Night date"}**?`;
    case "physical":
      return `${checked}Will this look clear and stay sturdy at **${layout ? dimensions(layout.widthIn, layout.heightIn) : "the chosen size"}** in ${review.settings?.material}? Check small details and thin connections.`;
    case "stamp":
      return `${checked}Will the stamp be clear at **${review.settings?.stampSizeIn} inches**? Compare the original with the ${review.settings?.mirrorStamp ? "mirrored" : "unmirrored"} version that will be cut.`;
    case "archiving":
      return "Everything’s been reviewed. I’m getting the finished files ready.";
    case "publish":
      return "The finished files are ready. The organizer who completed the review can publish them when ready.";
    case "publishing":
      return "I’m saving the finished designs and creating their download link.";
    case "done":
      return "Your badge, stamp and cutting layouts are ready to download.";
    case "error":
      return failureGuidance(review.failure ?? "");
  }
}
