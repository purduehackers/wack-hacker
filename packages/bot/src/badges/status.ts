import type { Review } from "@repo/badges/contracts";
import {
  correctionFor,
  currentDecisions,
  reviewLabels,
  reviewStep,
} from "@repo/badges/presentation";
import type { Action } from "@repo/badges/wire";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } from "discord.js";
import type { Message } from "discord.js";

import { badgeColors } from "./messages.ts";
import type { BadgeStatus } from "./messages.ts";

interface StepResult {
  status: BadgeStatus;
  label: string;
  pending?: "publish" | "retry" | "repack";
}
type CardMessage = Pick<Message, "embeds" | "components">;
const continued: StepResult = { status: "warning", label: "Continued below" };

export function reviewStatus(review: Review): BadgeStatus {
  const step = reviewStep(review);
  if (
    step === "error" ||
    correctionFor(review)?.verdict === "changes" ||
    (step === "fix" && review.checks.some((check) => check.status === "fail"))
  )
    return "error";
  return step === "done" ? "success" : "warning";
}

export function actionResult(action: Action, review: Review): StepResult {
  if (review.failure || review.contextChanged) return { status: "error", label: "Needs attention" };
  switch (action.kind) {
    case "decision":
      return action.verdict === "approve"
        ? { status: "success", label: `${reviewLabels[action.criterion]} confirmed` }
        : {
            status: action.verdict === "changes" ? "error" : "warning",
            label: "Check your design",
          };
    case "material":
      return { status: "success", label: "Acrylic selected" };
    case "event":
      return { status: "success", label: "Hack Night selected" };
    case "roles":
    case "replace":
      return { status: "success", label: "Files identified" };
    case "upload":
      return { status: "warning", label: `New ${action.role} uploaded` };
    case "publish":
      return pendingResult("publish", review);
    case "repack":
      return { status: "warning", label: "Arranging badges…", pending: "repack" };
    case "quantity":
      return {
        status: "warning",
        label: action.count ? `Target: ${action.count} badges` : "Choosing quantity",
      };
    case "retry":
      return { status: "warning", label: "Trying again…", pending: "retry" };
    case "choose-material":
      return { status: "warning", label: "Choosing another acrylic" };
    case "refresh":
    case "keep-design":
      return continued;
  }
}

function pendingResult(kind: string, review: Review): StepResult {
  if (review.failure || review.contextChanged) return { status: "error", label: "Needs attention" };
  if (kind === "publish")
    return review.publication?.shortlink
      ? { status: "success", label: "Files published" }
      : { status: "warning", label: "Saving files…", pending: "publish" };
  return kind === "retry" ? { status: "success", label: "Resolved" } : continued;
}

function messageComponents(message: CardMessage) {
  return message.components.flatMap((row) =>
    row.type === ComponentType.ActionRow ? row.components : [],
  );
}

/** Recover completion after a restart or an upload sent directly in the thread. */
export function deliveredResult(message: CardMessage, review: Review): StepResult {
  const items = messageComponents(message);
  const result = items.find(
    (component) =>
      component.type === ComponentType.Button && component.customId?.startsWith("badge-result:"),
  );
  if (result?.type === ComponentType.Button) {
    const kind = result.customId?.slice("badge-result:".length) ?? "complete";
    if (kind !== "complete") return pendingResult(kind, review);
    const color = message.embeds.at(-1)?.color;
    return {
      status:
        color === badgeColors.success
          ? "success"
          : color === badgeColors.error
            ? "error"
            : "warning",
      label: result.label ?? continued.label,
    };
  }
  const commands = items.flatMap((component) =>
    "customId" in component && component.customId?.startsWith(`badge:${review.id}:`)
      ? [component.customId.split(":")[3] ?? ""]
      : [],
  );
  for (const role of ["badge", "stamp"] as const) {
    if (commands.includes(`review.${role}.approve`))
      return currentDecisions(review).some(
        (decision) => decision.criterion === role && decision.verdict === "approve",
      )
        ? { status: "success", label: `${reviewLabels[role]} confirmed` }
        : continued;
  }
  if (commands.some((action) => action.startsWith("material.")) && review.material)
    return { status: "success", label: "Acrylic selected" };
  if (commands.includes("event") && review.event)
    return { status: "success", label: "Hack Night selected" };
  if (commands.some((action) => /^(?:roles|replace)\./u.test(action)) && review.rolesConfirmed)
    return { status: "success", label: "Files identified" };
  if (commands.includes("publish") && review.approval) return pendingResult("publish", review);
  if (commands.includes("retry")) return pendingResult("retry", review);
  return continued;
}

/** Preserve verification evidence; update the final embed and replace its action controls. */
export function settledCard(message: CardMessage, result: StepResult, nextUrl?: string) {
  const links = messageComponents(message).flatMap((component) =>
    component.type === ComponentType.Button &&
    component.style === ButtonStyle.Link &&
    component.label !== "Next step"
      ? [new ButtonBuilder(component.toJSON())]
      : [],
  );
  const styles = {
    success: ButtonStyle.Success,
    warning: ButtonStyle.Secondary,
    error: ButtonStyle.Danger,
  };
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`badge-result:${result.pending ?? "complete"}`)
      .setLabel(result.label)
      .setStyle(styles[result.status])
      .setDisabled(true),
    ...links.slice(0, 3),
  );
  if (nextUrl)
    row.addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Next step").setURL(nextUrl),
    );
  return {
    embeds: message.embeds.map((embed, index) =>
      index === message.embeds.length - 1
        ? { ...embed.toJSON(), color: badgeColors[result.status] }
        : embed.toJSON(),
    ),
    components: [row],
    allowedMentions: { parse: [] },
  };
}
