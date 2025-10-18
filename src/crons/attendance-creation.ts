import { type Client, ThreadAutoArchiveDuration } from "discord.js";
import { schedule } from "node-cron";

import {
    HACK_NIGHT_ATTENDANCE_CHANNEL_ID,
    HACK_NIGHT_ATTENDANCE_ROLE_ID,
} from "../utils/consts";

export default async function startTask(client: Client) {
    const task = schedule("0 20 * * 5", handler(client));
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
            console.error("Cannot send messages channel");
            return;
        }

        const message = await channel.send({
            content: `<@&${HACK_NIGHT_ATTENDANCE_ROLE_ID}>: Put attendance for the night here! Please rename the thread to tonight's version number.`,
        });

        if (!message) {
            console.error("Could not create Hack Night attendance thread");
            return;
        }

        await message.pin();

        const dateObj = new Date();
        const date = `${`${1 + dateObj.getMonth()}`.padStart(2, "0")}/${`${dateObj.getDate()}`.padStart(2, "0")}`;

        await message.startThread({
            name: `Hack Night Attendance - ${date}`,
            autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
        });

        const pinnedMessage = await channel.messages.fetch({ limit: 1 });

        if (!pinnedMessage) {
            console.error("Could not fetch last message");
            return;
        }

        const systemMessage = pinnedMessage.first();

        if (!systemMessage) {
            console.error("Could not find last message");
            return;
        }

        await systemMessage.delete();

        console.log("Created Hack Night attendance thread");
    };
}
