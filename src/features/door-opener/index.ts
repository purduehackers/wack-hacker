import { MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { Effect } from "effect";

import { ORGANIZER_ROLE_ID } from "../../constants";
import { structuredError } from "../../errors";
import { Phonebell } from "../../services";

export const doorOpenerCommand = new SlashCommandBuilder()
    .setName("door-opener")
    .setDescription("Door opener commands")
    .addSubcommand((subcommand) => subcommand.setName("open").setDescription("Open the door"));

type DoorOpenerResponseType =
    | "permission_denied"
    | "open_failed"
    | "open_success"
    | "unsupported_subcommand";

const sendEphemeralResponse = Effect.fn("DoorOpener.sendEphemeralResponse")(function* (
    interaction: ChatInputCommandInteraction,
    content: string,
    responseType: DoorOpenerResponseType,
) {
    const responseStartTime = Date.now();
    const responseAction = interaction.replied || interaction.deferred ? "follow_up" : "reply";

    const responseSent = yield* Effect.tryPromise({
        try: async () => {
            if (responseAction === "follow_up") {
                await interaction.followUp({
                    content,
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }

            await interaction.reply({
                content,
                flags: MessageFlags.Ephemeral,
            });
        },
        catch: (cause) =>
            new Error(
                `Failed to send interaction response: ${
                    cause instanceof Error ? cause.message : String(cause)
                }`,
            ),
    }).pipe(
        Effect.tap(() =>
            Effect.logDebug("door opener interaction response sent", {
                user_id: interaction.user.id,
                channel_id: interaction.channelId,
                guild_id: interaction.guildId ?? "dm",
                response_type: responseType,
                response_action: responseAction,
                duration_ms: Date.now() - responseStartTime,
            }),
        ),
        Effect.as(true as const),
        Effect.catchAll((error) =>
            Effect.logError("door opener interaction response failed", {
                ...structuredError(error),
                user_id: interaction.user.id,
                channel_id: interaction.channelId,
                guild_id: interaction.guildId ?? "dm",
                response_type: responseType,
                response_action: responseAction,
                duration_ms: Date.now() - responseStartTime,
            }).pipe(Effect.as(false as const)),
        ),
    );

    return responseSent;
});

export const handleDoorOpenerCommand = Effect.fn("DoorOpener.handleCommand")(
    function* (interaction: ChatInputCommandInteraction) {
        const startTime = Date.now();
        const subcommand = interaction.options.getSubcommand();
        const userId = interaction.user.id;
        const guildId = interaction.guildId ?? "dm";

        yield* Effect.annotateCurrentSpan({
            user_id: userId,
            channel_id: interaction.channelId,
            guild_id: guildId,
            subcommand,
        });

        yield* Effect.logInfo("door opener command invoked", {
            user_id: userId,
            username: interaction.user.username,
            channel_id: interaction.channelId,
            guild_id: guildId,
            subcommand,
        });

        if (subcommand !== "open") {
            const duration_ms = Date.now() - startTime;
            yield* Effect.annotateCurrentSpan({
                status: "unsupported_subcommand",
                duration_ms,
            });
            yield* Effect.logWarning("door opener unsupported subcommand", {
                user_id: userId,
                channel_id: interaction.channelId,
                guild_id: guildId,
                subcommand,
                duration_ms,
            });
            yield* sendEphemeralResponse(
                interaction,
                "Unknown door opener subcommand.",
                "unsupported_subcommand",
            );
            return;
        }

        const member = interaction.member;
        const memberRoles = member && "cache" in member.roles ? member.roles.cache : null;
        const isOrganizer = memberRoles?.has(ORGANIZER_ROLE_ID) ?? false;

        yield* Effect.annotateCurrentSpan({
            is_organizer: isOrganizer,
        });

        if (!isOrganizer) {
            const duration_ms = Date.now() - startTime;
            yield* Effect.annotateCurrentSpan({
                status: "permission_denied",
                duration_ms,
            });
            yield* Effect.logWarning("door opener permission denied", {
                user_id: userId,
                username: interaction.user.username,
                channel_id: interaction.channelId,
                guild_id: guildId,
                required_role_id: ORGANIZER_ROLE_ID,
                is_organizer: false,
                duration_ms,
            });
            yield* sendEphemeralResponse(
                interaction,
                "You don't have permission to use this command.",
                "permission_denied",
            );
            return;
        }

        const phonebell = yield* Phonebell;

        const openedSuccessfully = yield* phonebell.openDoor(userId).pipe(
            Effect.map(() => true as const),
            Effect.catchAll((error) =>
                Effect.gen(function* () {
                    const duration_ms = Date.now() - startTime;
                    yield* Effect.annotateCurrentSpan({
                        status: "open_failed",
                        duration_ms,
                    });
                    yield* Effect.logError("door opener request failed", {
                        ...structuredError(error),
                        user_id: userId,
                        username: interaction.user.username,
                        channel_id: interaction.channelId,
                        guild_id: guildId,
                        subcommand,
                        duration_ms,
                    });
                    yield* sendEphemeralResponse(
                        interaction,
                        "Failed to open the door.",
                        "open_failed",
                    );
                    return false as const;
                }),
            ),
        );

        if (!openedSuccessfully) {
            return;
        }

        const responseSent = yield* sendEphemeralResponse(
            interaction,
            "Door opened!",
            "open_success",
        );

        const duration_ms = Date.now() - startTime;
        yield* Effect.annotateCurrentSpan({
            status: responseSent ? "success" : "success_response_failed",
            duration_ms,
        });

        if (!responseSent) {
            yield* Effect.logWarning("door opener command completed but response failed", {
                user_id: userId,
                username: interaction.user.username,
                channel_id: interaction.channelId,
                guild_id: guildId,
                subcommand,
                status: "success_response_failed",
                duration_ms,
            });
            return;
        }

        yield* Effect.logInfo("door opener command completed", {
            user_id: userId,
            username: interaction.user.username,
            channel_id: interaction.channelId,
            guild_id: guildId,
            subcommand,
            status: "success",
            duration_ms,
        });
    },
    Effect.annotateLogs({ feature: "door_opener" }),
);
