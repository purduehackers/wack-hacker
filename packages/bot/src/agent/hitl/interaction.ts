import type { ConversationStore } from "@repo/shared/conversations";
import { roleAtLeast, roleFromMemberRoles, UserRole } from "@repo/shared/discord";
import { messageOf, tagOf } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import type { Reporter } from "@repo/shared/result/observe";
import { sliceText } from "@repo/shared/text";
import type {
  AuthorizationChallenge,
  InteractionPayload,
  Principal,
  RenderAuthorization,
  RenderInputRequest,
  RenderTarget,
} from "@repo/shared/wire";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import type { GuildMember, Interaction } from "discord.js";

import { activeTraceparent } from "../../framework/observability.ts";
import type { ConversationFlow } from "../../utils/conversation/index.ts";
import { modalCustomId, parseLocator } from "./components.ts";
import type { HitlLocator } from "./components.ts";

const ANSWER_FIELD_ID = "answer";

interface HitlInteractionDeps {
  readonly flow: ConversationFlow;
  readonly renders: ConversationStore["renders"];
  readonly challenges: ConversationStore["authorizationChallenges"];
  readonly reporter: Reporter;
  readonly guildId: string;
}

function report(deps: HitlInteractionDeps, operation: string, error: unknown): void {
  deps.reporter.emit({
    op: operation,
    status: "error",
    errorTag: tagOf(error),
    errorMessage: messageOf(error),
  });
}

function memberRoles(member: GuildMember | undefined, guildId: string): string[] {
  return [...(member?.roles.cache.keys() ?? [])].filter((roleId) => roleId !== guildId);
}

async function principalOf(interaction: Interaction, guildId: string): Promise<Principal> {
  const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => undefined);
  return {
    userId: interaction.user.id,
    username: interaction.user.username,
    nickname: member?.displayName ?? interaction.user.username,
    memberRoles: memberRoles(member, guildId),
  };
}

async function ephemeral(interaction: Interaction, content: string): Promise<void> {
  if (!interaction.isRepliable()) return;
  await interaction.editReply({ content, components: [], allowedMentions: { parse: [] } });
}

function modalFor(locator: Extract<HitlLocator, { readonly kind: "input" }>): ModalBuilder {
  const input = new TextInputBuilder()
    .setCustomId(ANSWER_FIELD_ID)
    .setLabel("Your answer")
    .setStyle(TextInputStyle.Paragraph)
    .setMinLength(1)
    .setMaxLength(4_000)
    .setRequired(true);
  return new ModalBuilder()
    .setCustomId(modalCustomId(locator))
    .setTitle("Answer the agent")
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
}

function isExpired(challenge: AuthorizationChallenge): boolean {
  if (challenge.expiresAt === undefined) return false;
  const expiresAt = Date.parse(challenge.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt <= Date.now();
}

async function revealAuthorization(
  interaction: Interaction,
  authorization: RenderAuthorization,
  challenge: AuthorizationChallenge,
): Promise<void> {
  if (isExpired(challenge)) {
    await ephemeral(interaction, "This authorization challenge has expired.");
    return;
  }

  const name = authorization.displayName ?? authorization.name;
  const sections = [`Connect **${sliceText(name, 128)}** to continue.`];
  if (challenge.userCode !== undefined) {
    sections.push(`Code: \`${challenge.userCode.replaceAll("`", "")}\``);
  }
  if (challenge.expiresAt !== undefined) sections.push(`Expires: ${challenge.expiresAt}`);
  if (challenge.instructions !== undefined) sections.push(challenge.instructions);
  if (challenge.description !== "") sections.push(challenge.description);

  const components =
    challenge.url === undefined
      ? []
      : [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setStyle(ButtonStyle.Link)
              .setLabel(sliceText(`Open ${name}`, 80))
              .setURL(challenge.url),
          ),
        ];
  if (!interaction.isRepliable()) return;
  await interaction.editReply({
    content: sliceText(sections.join("\n\n"), 1_900),
    components,
    allowedMentions: { parse: [] },
  });
}

function selectedOptionIndex(
  interaction: Interaction,
  locator: Extract<HitlLocator, { readonly kind: "input" }>,
): number | undefined {
  if (locator.action === "option" && interaction.isButton()) return locator.index;
  if (locator.action !== "select" || !interaction.isStringSelectMenu()) return undefined;
  const selected =
    interaction.values.length === 1 ? /^o(\d+)$/u.exec(interaction.values[0] ?? "") : undefined;
  const index = selected === null || selected === undefined ? undefined : Number(selected[1]);
  if (index === undefined || !Number.isSafeInteger(index)) return undefined;
  const chunkStart = locator.index;
  return chunkStart !== undefined && index >= chunkStart && index < chunkStart + 25
    ? index
    : undefined;
}

function freeformAnswer(
  interaction: Interaction,
  locator: Extract<HitlLocator, { readonly kind: "input" }>,
): string | undefined {
  if (locator.action !== "modal" || !interaction.isModalSubmit()) return undefined;
  const answer = interaction.fields.getTextInputValue(ANSWER_FIELD_ID).trim();
  return answer === "" ? undefined : answer;
}

function messageIdOf(interaction: Interaction): string | undefined {
  if (interaction.isButton() || interaction.isStringSelectMenu()) return interaction.message.id;
  return undefined;
}

interface LoadedInput {
  readonly request: RenderInputRequest;
  readonly continuationKey: string;
  readonly authChannelId: string;
  readonly authThreadId?: string;
  readonly principal: Principal;
  readonly approvalRequester?: InteractionPayload["approvalRequester"];
}

/** Either the admitted request or the ephemeral message explaining the refusal. */
type LoadInputOutcome =
  | { readonly ok: true; readonly input: LoadedInput }
  | { readonly ok: false; readonly rejection: string };

function rejectInput(rejection: string): LoadInputOutcome {
  return { ok: false, rejection };
}

/** Either the approver context to record, or the ephemeral message explaining the refusal. */
type ApproverOutcome =
  | { readonly ok: true; readonly approvalRequester: LoadedInput["approvalRequester"] }
  | { readonly ok: false; readonly rejection: string };

/**
 * Decides whether this interaction's user is allowed to answer the request.
 *
 * A second-party approval needs two distinct people who both still hold the
 * minimum role — the original requester's authority is re-checked here, because
 * it may have been revoked since the request was raised. Every other request is
 * answerable only by the person it was addressed to.
 */
async function resolveApprover(
  deps: HitlInteractionDeps,
  interaction: Interaction,
  request: RenderInputRequest,
  target: RenderTarget,
  principal: Principal,
): Promise<ApproverOutcome> {
  if (request.approvalMode === "second-party") {
    const minimum = request.approverMinRole === "admin" ? UserRole.Admin : UserRole.Organizer;
    const requesterMember = await interaction.guild?.members
      .fetch(target.requesterUserId)
      .catch(() => undefined);
    const requesterRoles = memberRoles(requesterMember, deps.guildId);
    if (!roleAtLeast(roleFromMemberRoles(requesterRoles), minimum)) {
      return { ok: false, rejection: "The requester is no longer authorized for this action." };
    }
    if (
      interaction.user.id === target.requesterUserId ||
      !roleAtLeast(roleFromMemberRoles(principal.memberRoles), minimum)
    ) {
      return { ok: false, rejection: `A different ${minimum} must answer this approval request.` };
    }
    return {
      ok: true,
      approvalRequester: { userId: target.requesterUserId, memberRoles: requesterRoles },
    };
  }

  if (
    interaction.user.id !== target.requesterUserId ||
    interaction.user.id !== request.recipientUserId
  ) {
    return {
      ok: false,
      rejection: "Only the person who started this turn can answer this request.",
    };
  }
  return { ok: true, approvalRequester: undefined };
}

/**
 * Confirms the interaction came from the message that currently carries the
 * render, so a click on a superseded message cannot answer a live request.
 */
async function checkSourceMessage(
  deps: HitlInteractionDeps,
  interaction: Interaction,
  locator: Extract<HitlLocator, { readonly kind: "input" }>,
  target: RenderTarget,
): Promise<string | undefined> {
  const sourceMessageId = messageIdOf(interaction);
  if (sourceMessageId === undefined) return undefined;

  const projection = await deps.renders.projection(locator.dispatchId, target.anchorMessageId);
  if (Result.isError(projection)) {
    report(deps, "agent.hitl.decode-projection", projection.error);
    return "This input request is temporarily unavailable.";
  }
  // The request now lives on its own message so its mention actually notifies.
  // Older projections have no `hitlMessageId` and still carry their buttons on
  // the anchor, so both are accepted rather than invalidating a live request
  // that was rendered before this shipped.
  const carrier = projection.value.hitlMessageId ?? projection.value.anchorMessageId;
  if (carrier !== sourceMessageId) {
    return "This input request is no longer active.";
  }
  return undefined;
}

async function loadInput(
  deps: HitlInteractionDeps,
  interaction: Interaction,
  locator: Extract<HitlLocator, { readonly kind: "input" }>,
): Promise<LoadInputOutcome> {
  const [intentResult, targetResult] = await Promise.all([
    deps.renders.intent(locator.dispatchId),
    deps.renders.target(locator.dispatchId),
  ]);
  if (Result.isError(intentResult)) {
    report(deps, "agent.hitl.decode-intent", intentResult.error);
    return rejectInput("This input request is temporarily unavailable.");
  }
  if (Result.isError(targetResult)) {
    report(deps, "agent.hitl.decode-target", targetResult.error);
    return rejectInput("This input request is temporarily unavailable.");
  }
  const intent = intentResult.value;
  const target = targetResult.value;
  if (
    intent === undefined ||
    target === undefined ||
    intent.phase !== "streaming" ||
    intent.dispatchId !== target.dispatchId ||
    intent.continuationKey !== target.continuationKey ||
    intent.revision !== locator.revision
  ) {
    return rejectInput("This input request is stale or has already been handled.");
  }
  const request = intent.inputRequests?.[locator.requestIndex];
  if (request === undefined) {
    return rejectInput("This input request is stale or has already been handled.");
  }
  if (interaction.guildId !== deps.guildId || interaction.channelId !== target.channelId) {
    return rejectInput("This input request is not valid in this channel.");
  }

  const principal = await principalOf(interaction, deps.guildId);
  const approver = await resolveApprover(deps, interaction, request, target, principal);
  if (!approver.ok) return rejectInput(approver.rejection);
  const { approvalRequester } = approver;

  const staleSource = await checkSourceMessage(deps, interaction, locator, target);
  if (staleSource !== undefined) return rejectInput(staleSource);
  return {
    ok: true,
    input: {
      request,
      continuationKey: intent.continuationKey,
      authChannelId: target.authChannelId,
      ...(target.authThreadId === undefined ? {} : { authThreadId: target.authThreadId }),
      principal,
      ...(approvalRequester === undefined ? {} : { approvalRequester }),
    },
  };
}

async function handleInput(
  deps: HitlInteractionDeps,
  interaction: Interaction,
  locator: Extract<HitlLocator, { readonly kind: "input" }>,
): Promise<void> {
  const outcome = await loadInput(deps, interaction, locator);
  if (!outcome.ok) {
    await ephemeral(interaction, outcome.rejection);
    return;
  }

  const loaded = outcome.input;
  const { request } = loaded;
  const optionIndex = selectedOptionIndex(interaction, locator);
  const freeform = freeformAnswer(interaction, locator);
  const options = request.options ?? [];
  const optionId = optionIndex === undefined ? undefined : options[optionIndex]?.id;
  const freeformAllowed =
    request.kind === "question" && (request.allowFreeform || options.length === 0);
  if (
    (optionId === undefined && freeform === undefined) ||
    (optionId !== undefined && freeform !== undefined) ||
    (freeform !== undefined && !freeformAllowed)
  ) {
    await ephemeral(interaction, "That answer is not valid for this request.");
    return;
  }

  const traceparent = activeTraceparent();
  const answered = await deps.flow.answer({
    claim: {
      dispatchId: locator.dispatchId,
      continuationKey: loaded.continuationKey,
      revision: locator.revision,
      requestIndex: locator.requestIndex,
      requestId: request.requestId,
      recipientUserId: request.recipientUserId,
      interactionId: interaction.id,
    },
    payload: {
      continuationKey: loaded.continuationKey,
      interactionId: interaction.id,
      dispatchId: locator.dispatchId,
      renderRevision: locator.revision,
      requestId: request.requestId,
      authChannelId: loaded.authChannelId,
      ...(loaded.authThreadId === undefined ? {} : { authThreadId: loaded.authThreadId }),
      ...(optionId === undefined ? { freeform } : { optionId }),
      principal: loaded.principal,
      ...(loaded.approvalRequester === undefined
        ? {}
        : { approvalRequester: loaded.approvalRequester }),
      ...(traceparent === undefined ? {} : { traceparent }),
    },
  });
  if (answered.status === "taken" || answered.status === "stale") {
    await ephemeral(
      interaction,
      answered.status === "taken"
        ? "An answer is already being processed for this request."
        : "This input request is stale or has already been handled.",
    );
    return;
  }
  if (answered.status === "failed") {
    report(deps, "agent.hitl.forward", answered.error);
    await ephemeral(
      interaction,
      "I couldn't confirm whether that answer was received, so this request is paused safely.",
    );
    return;
  }
  await settleRequestMessage(interaction, request, optionId, freeform);
}

/**
 * Turn the request into a record of what was decided.
 *
 * The prompt stays, the controls go, and a line naming the answer and who gave
 * it is appended. Previously the message kept its live buttons and the only
 * feedback was an ephemeral "Your answer was sent." that nobody else could see
 * and that vanished on dismiss, so the thread was left showing an open question
 * that had already been answered.
 *
 * The source message is edited directly rather than through `editReply`: the
 * interaction is deferred as an ephemeral reply before the locator is even
 * parsed, so `editReply` addresses that hidden reply. Deleting it afterwards is
 * what removes the receipt.
 */
async function settleRequestMessage(
  interaction: Interaction,
  request: RenderInputRequest,
  optionId: string | undefined,
  freeform: string | undefined,
): Promise<void> {
  if (!interaction.isRepliable()) return;
  const source = interaction.isMessageComponent()
    ? interaction.message
    : interaction.isModalSubmit()
      ? (interaction.message ?? undefined)
      : undefined;
  if (source === undefined) {
    await ephemeral(interaction, "Your answer was sent.");
    return;
  }
  const chosen = (request.options ?? []).find((option) => option.id === optionId);
  const answer =
    chosen === undefined
      ? freeform === undefined
        ? "answered"
        : `answered: ${sliceText(freeform, 200)}`
      : chosen.label;
  await source.edit({
    content: `${source.content}\n-# ${answer} — <@${interaction.user.id}>`,
    components: [],
    allowedMentions: { parse: [] },
  });
  await interaction.deleteReply();
}

async function handleAuthorization(
  deps: HitlInteractionDeps,
  interaction: Interaction,
  locator: Extract<HitlLocator, { readonly kind: "authorization" }>,
): Promise<void> {
  const [intentResult, targetResult] = await Promise.all([
    deps.renders.intent(locator.dispatchId),
    deps.renders.target(locator.dispatchId),
  ]);
  if (Result.isError(intentResult)) {
    report(deps, "agent.hitl.decode-authorization-intent", intentResult.error);
    await ephemeral(interaction, "This authorization challenge is temporarily unavailable.");
    return;
  }
  if (Result.isError(targetResult)) {
    report(deps, "agent.hitl.decode-authorization-target", targetResult.error);
    await ephemeral(interaction, "This authorization challenge is temporarily unavailable.");
    return;
  }
  const intent = intentResult.value;
  const target = targetResult.value;
  const authorization = intent?.authorizations?.[locator.authorizationIndex];
  if (
    intent === undefined ||
    target === undefined ||
    intent.phase !== "streaming" ||
    intent.revision !== locator.revision ||
    intent.dispatchId !== target.dispatchId ||
    intent.continuationKey !== target.continuationKey ||
    authorization === undefined
  ) {
    await ephemeral(interaction, "This authorization challenge has expired or completed.");
    return;
  }
  const sourceMessageId = messageIdOf(interaction);
  if (
    interaction.guildId !== deps.guildId ||
    interaction.channelId !== target.channelId ||
    interaction.user.id !== target.requesterUserId ||
    interaction.user.id !== authorization.recipientUserId ||
    sourceMessageId === undefined
  ) {
    await ephemeral(interaction, "Only the person who started this turn can open this connection.");
    return;
  }
  const projection = await deps.renders.projection(locator.dispatchId, target.anchorMessageId);
  if (Result.isError(projection)) {
    report(deps, "agent.hitl.decode-authorization-projection", projection.error);
    await ephemeral(interaction, "This authorization challenge is temporarily unavailable.");
    return;
  }
  // The same carrier rule as an input request: the anchor is written with no
  // components at all, so a Connect button is always on the HITL message.
  // Comparing against the anchor refused every click.
  const carrier = projection.value.hitlMessageId ?? projection.value.anchorMessageId;
  if (carrier !== sourceMessageId) {
    await ephemeral(interaction, "This authorization challenge is no longer active.");
    return;
  }
  const challenge = await deps.challenges.challenge(locator.dispatchId, authorization.id);
  if (Result.isError(challenge)) {
    report(deps, "agent.hitl.decode-authorization-challenge", challenge.error);
    await ephemeral(interaction, "This authorization challenge is temporarily unavailable.");
    return;
  }
  if (challenge.value === undefined) {
    await ephemeral(interaction, "This authorization challenge has expired or completed.");
    return;
  }
  await revealAuthorization(interaction, authorization, challenge.value);
}

export function createHitlInteractionHandler(deps: HitlInteractionDeps) {
  return async (interaction: Interaction): Promise<boolean> => {
    const customId =
      interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()
        ? interaction.customId
        : undefined;
    if (customId === undefined || !customId.startsWith("eve-hitl:")) return false;
    const locator = parseLocator(customId);

    if (locator?.kind === "input" && locator.action === "freeform" && interaction.isButton()) {
      await interaction.showModal(modalFor(locator));
      return true;
    }

    if (!interaction.isRepliable()) return true;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (locator === undefined) {
      await ephemeral(interaction, "This agent control is malformed or no longer supported.");
      return true;
    }

    try {
      if (locator.kind === "authorization") {
        await handleAuthorization(deps, interaction, locator);
      } else {
        await handleInput(deps, interaction, locator);
      }
    } catch (error) {
      report(deps, "agent.hitl.handle", error);
      await ephemeral(interaction, "This request is temporarily unavailable.").catch(
        () => undefined,
      );
    }
    return true;
  };
}

export type HitlInteractionHandler = ReturnType<typeof createHitlInteractionHandler>;
