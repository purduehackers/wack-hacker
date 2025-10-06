import { ChannelType, type Client } from "discord.js";
import { schedule } from "node-cron";

import {
    HACK_NIGHT_ATTENDANCE_CHANNEL_ID,
    HACK_NIGHT_ATTENDANCE_ROLE_ID,
} from "../utils/consts";

// Every 15 Minutes until 2am
export default async function startTask(client: Client) {
    const task = schedule("*/15 0-2 * * 6", handler(client));
    return task.start();
}

function handler(client: Client) {
    return async () => {
        const channel = client.channels.cache.get(
            HACK_NIGHT_ATTENDANCE_CHANNEL_ID,
        );

        if (!channel) {
            console.error("Could not find channel");
            return;
        }

        if (!channel.isSendable()) {
            console.error("Cannot send messages to channel");
            return;
        }

        if (channel.type !== ChannelType.GuildText) {
            console.error("Cannot create threads in channel");
            return;
        }

        const threads = await channel.threads.fetchActive();

        if (!threads) {
            console.error("Could not fetch active threads");
            return;
        }

        const hackNightAttendanceThread = threads.threads
            .filter((t) => {
                return t.name.startsWith("");
            })
            .sorted((a, b) => {
                if (!a.createdTimestamp || !b.createdTimestamp) return 0;
                return b.createdTimestamp - a.createdTimestamp;
            })
            .first();

        if (!hackNightAttendanceThread) {
            console.error("Could not find latest thread");
            return;
        }

        const lastMessage = channel.lastMessage;

        if (lastMessage) {
            const timeSent = lastMessage.createdAt;

            // If most recent message was sent more than 1.5 hours ago
            if (
                new Date().getTime() - timeSent.getTime() >
                1.5 * 60 * 60 * 1000
            ) {
            }
        }

        hackNightAttendanceThread.send({
            content: `<@&${HACK_NIGHT_ATTENDANCE_ROLE_ID}>: Last attendance taken was more than an hour and a half ago!`,
        });
    };
}
