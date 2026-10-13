import { designHash, remainingCriteria, staticPassed } from "./contracts.ts";
import type { Check, Criterion, Review } from "./contracts.ts";

const unclearReply = "Ask me again, or use the latest card to continue.";

/** Final display boundary for model prose and design notes, never SVG source or diagnostics. */
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
      return "Flatten effects into vector shapes, then export a new SVG.";
    case "palette":
      return finding.role === "stamp"
        ? "Use black and white for your stamp. Use pure red only for the cutting outline."
        : "Change colored artwork to grayscale. Use pure red only for the cutting outline.";
    case "vectors":
      return "Replace pasted images with vector artwork, then export a new SVG.";
    case "text":
      return "Convert your lettering to outlines, then export a new SVG.";
    case "fills":
      return "Outline the strokes in your artwork. Keep the red cutting outline as a stroke.";
    case "cut":
      return "Join the outside cutting line into 1 closed red outline. Remove its fill, crossings and extra outlines.";
  }
}

export function failureGuidance(detail: string): string {
  if (/newer step|review changed|latest review|stale/iu.test(detail))
    return "Use the latest message to continue.";
  if (/Only the author or/iu.test(detail))
    return "Ask the designer or an organizer to make this change.";
  if (/Only.*author/iu.test(detail))
    return "Only the designer who uploaded these files can confirm, replace, or publish them.";
  if (/Explain what needs/iu.test(detail)) return "Add a short note about what needs changing.";
  if (/different review thread|p-badges thread/iu.test(detail))
    return "Open the original thread and use its latest message.";
  if (/event.*changed|production settings changed/iu.test(detail))
    return "The Hack Night details or design size changed. Select Check again to continue.";
  if (/Attachment is unavailable|Reattach|expired/iu.test(detail))
    return "I couldn’t open that upload. Upload the SVG again.";
  if (/1 MB|too large/iu.test(detail))
    return "Your file exceeds 1 MB. Reduce its size in your design app, then upload it again.";
  if (/Attach one|Upload one/iu.test(detail)) return "Upload your badge or stamp as an SVG.";
  if (/raster|external|image element/iu.test(detail))
    return "Use vector artwork instead of pasted images, then export a new SVG.";
  if (/SVG|XML|DOCTYPE/iu.test(detail))
    return "I couldn’t read that design. Export a plain SVG from your design app and upload it again.";
  if (/layout search found/iu.test(detail)) return detail;
  if (/time budget/iu.test(detail))
    return "The layout search timed out. Select Try another layout to keep the same badge size.";
  if (/cut outline|geometry|clearance|overlap/iu.test(detail))
    return "I couldn’t prepare the cutting layout. Ask an organizer to check the outside outline.";
  if (/Publication is locked|approval does not match/iu.test(detail))
    return "I’m saving your files. Wait for the download link before uploading a revision.";
  return "I couldn’t finish this step. Try again. If it fails again, ask an organizer for help.";
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
  | "missing"
  | "checking"
  | "fix"
  | "event"
  | "packing"
  | "layout"
  | "preparing"
  | Criterion
  | "publishing"
  | "done"
  | "error";
export const reviewLabels: Record<Criterion, string> = { badge: "Badge", stamp: "Stamp" };
export function currentDecisions(review: Review) {
  return review.decisions.filter(
    (decision) => decision.context === designHash(review, decision.criterion),
  );
}
export function correctionFor(review: Review) {
  const step = reviewStep(review);
  return currentDecisions(review).find(
    (decision) => decision.criterion === step && decision.verdict !== "approve",
  );
}
export function fixRole(review: Review): Criterion {
  return review.checks.find((check) => check.status !== "pass")?.role ?? "badge";
}
export function reviewStep(review: Review): ReviewStep {
  if (review.contextChanged || review.failure) return "error";
  if (review.publication?.shortlink) return "done";
  if (review.approval) return "publishing";
  if (!review.rolesConfirmed) return "files";
  if (!review.badge || !review.stamp) return "missing";
  if (!review.checks.length) return "checking";
  if (!staticPassed(review)) return "fix";
  if (!review.event) return "event";
  if (!review.manufacturing) return "preparing";
  const remaining = remainingCriteria(review)[0];
  if (remaining) return remaining;
  return review.selectedLayout ? "layout" : "packing";
}
export function actionable(review: Review): boolean {
  return !["checking", "preparing", "packing", "publishing"].includes(reviewStep(review));
}
export function reviewPrompt(review: Review): string {
  const correction = correctionFor(review);
  if (correction) {
    const note = designerText(correction.note, "Check your design before continuing.").slice(
      0,
      700,
    );
    return correction.verdict === "unclear"
      ? `${note}\n\nOpen the full image to check the details.`
      : `${note}\n\nUpload your updated ${correction.criterion} when it’s ready.`;
  }
  switch (reviewStep(review)) {
    case "files":
      return review.uploads.length === 1
        ? "Is this your badge or your stamp?"
        : "Which design is the badge? I’ll use the other one as the stamp.";
    case "missing":
      return `Upload your ${review.badge ? "stamp" : "badge"} SVG to continue.`;
    case "checking":
      return "Checking your files…";
    case "fix": {
      const role = fixRole(review);
      const fixes = [
        ...new Set(
          review.checks
            .filter((check) => check.role === role && check.status !== "pass")
            .map(findingGuidance),
        ),
      ];
      return `${fixes.join("\n\n")}\n\nUpload your updated ${role} when it’s ready.`;
    }
    case "event":
      return "Which Hack Night are these designs for?";
    case "preparing":
      return "Preparing the previews…";
    case "badge":
      return "Your file checks passed. Double-check the version, date, and small details at this size.";
    case "stamp":
      return "You confirmed your badge. Check that your stamp will leave a clear impression.";
    case "packing":
      return "Arranging your badges…";
    case "layout":
      return `You confirmed both designs. This layout fits ${review.layouts.find((layout) => layout.id === review.selectedLayout)?.count} badges across your two sheets.`;
    case "publishing":
      return "Saving your files…";
    case "done":
      return "Your badge, stamp, and cutting sheets are saved.";
    case "error":
      return review.publication && !review.publication.shortlink
        ? "Your files are saved. I couldn’t create the short link. Retry to finish."
        : failureGuidance(review.failure ?? "");
  }
}
