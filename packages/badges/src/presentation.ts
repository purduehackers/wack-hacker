import { checkIds, designHash, remainingCriteria, staticPassed } from "./contracts.ts";
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

/** Only evidence from the current uploaded design can establish a check's result. */
export function verificationChecks(review: Review, role: Criterion) {
  const labels: Record<Check["id"], string> = {
    supported: "No unsupported effects or linked artwork",
    palette:
      role === "badge"
        ? "Grayscale artwork with red only for cutting"
        : "Black-and-white artwork with red only for cutting",
    vectors: "Vector artwork with no embedded images",
    text: "No editable text",
    fills: "Engraving uses filled shapes",
    cut: "One closed, unfilled red cutting outline without crossings",
  };
  return checkIds.map((id) => {
    const check = review[role]
      ? review.checks.find(
          (check) =>
            check.role === role && check.id === id && check.evidenceId === review[role]?.hash,
        )
      : undefined;
    return { label: labels[id], status: check?.status ?? "unknown" };
  });
}

export function verifiedChecks(review: Review, role: Criterion): string[] {
  return verificationChecks(review, role)
    .filter((check) => check.status === "pass")
    .map((check) => check.label);
}

export function failureGuidance(detail: string): string {
  if (detail === "Choose a Hack Night before choosing acrylic.") return detail;
  if (
    /^Ask an organizer to add matching|^The selected sheets are no longer available|^The selected acrylic is unavailable|^That acrylic is no longer available/iu.test(
      detail,
    )
  )
    return detail;
  if (/material inventory|reserved sheet|material receipt|sheets reserved/iu.test(detail))
    return "Ask an organizer to check the material inventory, then try again.";
  if (/newer step|review changed|latest review|stale/iu.test(detail))
    return "Use the latest message to continue.";
  if (/Only the author or/iu.test(detail))
    return "Ask the designer or an organizer to make this change.";
  if (/Only.*author/iu.test(detail))
    return "Only the designer who uploaded these files can confirm, replace, or publish them.";
  if (/Explain what needs/iu.test(detail)) return "Add a short note about what needs changing.";
  if (/^Enter a whole number/iu.test(detail)) return detail;
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
  if (/time budget/iu.test(detail)) return "The layout search timed out. Try again.";
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
  | "upload"
  | "material"
  | "checking"
  | "fix"
  | "event"
  | "packing"
  | "layout"
  | "quantity"
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
  return (
    (["badge", "stamp"] as const).find((role) =>
      verificationChecks(review, role).some((check) => check.status !== "pass"),
    ) ?? "badge"
  );
}
export function reviewStep(review: Review): ReviewStep {
  if (review.contextChanged || review.failure) return "error";
  // A requested upload must not hide the findings that explain the revision.
  if (
    review.rolesConfirmed &&
    review.badge &&
    review.stamp &&
    review.event &&
    review.material &&
    review.checks.length &&
    !staticPassed(review)
  )
    return "fix";
  if (review.pendingRole) return "upload";
  if (review.publication?.shortlink) return "done";
  if (review.approval) return "publishing";
  if (!review.rolesConfirmed) return "files";
  if (!review.badge || !review.stamp) return "missing";
  if (!review.event) return "event";
  if (!review.material) return "material";
  if (!review.checks.length) return "checking";
  if (!staticPassed(review)) return "fix";
  if (!review.manufacturing) return "preparing";
  const remaining = remainingCriteria(review)[0];
  if (remaining) return remaining;
  if (review.selectedLayout) return "layout";
  return review.layouts.length && (!review.targetCount || review.quantityShortfall)
    ? "quantity"
    : "packing";
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
    case "upload":
      return `Attach your updated ${review.pendingRole} SVG in this thread.`;
    case "material":
      return "Choose acrylic for your badges. I’ll use it for the 3D preview and cutting sheets.";
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
      return `${review.fittedSizeIn ? "The badge size changed. " : ""}Double-check your badge’s version, date, readability, and thin connections at this size.`;
    case "stamp":
      return "You confirmed your badge. Check that your stamp will leave a clear impression.";
    case "packing":
      return "Arranging your badges…";
    case "quantity": {
      const shortfall = review.quantityShortfall;
      return shortfall
        ? `I found room for ${shortfall.count} badges at ${shortfall.sizeIn} inches, short of your target of ${review.targetCount}. Choose a quantity below at your confirmed size, or enter another target.`
        : "Choose how many badges to make, or enter your own target. These counts use your confirmed badge size.";
    }
    case "layout": {
      const layout = review.layouts.find((candidate) => candidate.id === review.selectedLayout);
      const sheets = new Set(layout?.placements.map((placement) => placement.sheet)).size;
      return `You confirmed both designs. This layout fits ${layout?.count} badges on ${sheets === 1 ? "one sheet" : "two sheets"}.`;
    }
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

export function quantityOptions(review: Review) {
  const capacity = [...review.layouts].sort((a, b) => b.count - a.count)[0];
  if (!capacity) return [];
  const firstSheet = capacity.placements.filter((placement) => placement.sheet === 0).length;
  return [...new Set([...(capacity.count < 80 ? [firstSheet] : [80, 100]), capacity.count])]
    .filter((count) => count > 0 && count <= capacity.count)
    .sort((a, b) => a - b)
    .map((count) => ({
      count,
      small: Math.min(firstSheet, count),
      large: Math.max(0, count - firstSheet),
    }));
}
