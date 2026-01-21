import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { Effect } from "effect";

import { IntervalParseError } from "../errors";

dayjs.extend(relativeTime);

const DISCORD_EPOCH = 1420070400000n;

export const dateToSnowflake = Effect.fn("dateToSnowflake")(function* (date: Date) {
    const startMs = Date.now();
    const timestamp = BigInt(date.valueOf());
    const snowflake = (timestamp - DISCORD_EPOCH) << 22n;
    const result = snowflake.toString();
    const durationMs = Date.now() - startMs;

    yield* Effect.logInfo("converted date to discord snowflake", {
        operation: "date_to_snowflake",
        input_date: date.toISOString(),
        input_timestamp_ms: date.valueOf(),
        output_snowflake: result,
        discord_epoch_ms: Number(DISCORD_EPOCH),
        duration_ms: durationMs,
    });

    return result;
});

export const snowflakeToDate = Effect.fn("snowflakeToDate")(function* (snowflake: string) {
    const startMs = Date.now();
    const timestamp = (BigInt(snowflake) >> 22n) + DISCORD_EPOCH;
    const result = new Date(Number(timestamp));
    const durationMs = Date.now() - startMs;

    yield* Effect.logInfo("converted discord snowflake to date", {
        operation: "snowflake_to_date",
        input_snowflake: snowflake,
        output_date: result.toISOString(),
        output_timestamp_ms: result.valueOf(),
        discord_epoch_ms: Number(DISCORD_EPOCH),
        duration_ms: durationMs,
    });

    return result;
});

export const formatRelative = Effect.fn("formatRelative")(function* (date: Date) {
    const startMs = Date.now();
    const result = dayjs(date).fromNow();
    const durationMs = Date.now() - startMs;

    yield* Effect.logDebug("formatted date as relative time", {
        operation: "format_relative",
        input_date: date.toISOString(),
        output_relative: result,
        duration_ms: durationMs,
    });

    return result;
});

export const formatISO = Effect.fn("formatISO")(function* (date: Date) {
    const startMs = Date.now();
    const result = date.toISOString();
    const durationMs = Date.now() - startMs;

    yield* Effect.logDebug("formatted date as iso string", {
        operation: "format_iso",
        input_date: date.toISOString(),
        output_iso: result,
        duration_ms: durationMs,
    });

    return result;
});

export const getCurrentDay = Effect.fn("getCurrentDay")(function* (timezone: string) {
    const startMs = Date.now();
    const now = new Date();
    const result = now.toLocaleDateString("en-CA", { timeZone: timezone });
    const durationMs = Date.now() - startMs;

    yield* Effect.logInfo("retrieved current day for timezone", {
        operation: "get_current_day",
        timezone,
        current_date: result,
        timestamp_ms: now.valueOf(),
        duration_ms: durationMs,
    });

    return result;
});

/**
 * Pure helper function to calculate commit day from a timestamp.
 * Uses UTC construction to avoid timezone ambiguity during date manipulation.
 */
export const getCommitDayFromTimestamp = (
    timestamp: Date,
    timezone: string,
    dayResetHour: number,
): string => {
    const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "numeric",
        hour12: false,
    });

    const parts = formatter.formatToParts(timestamp);
    const year = Number.parseInt(parts.find((p) => p.type === "year")?.value ?? "1970", 10);
    const month = Number.parseInt(parts.find((p) => p.type === "month")?.value ?? "01", 10);
    const day = Number.parseInt(parts.find((p) => p.type === "day")?.value ?? "01", 10);
    const hour = Number.parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);

    // Construct date in UTC to avoid local timezone interference during manipulation
    const commitDate = new Date(Date.UTC(year, month - 1, day));

    if (hour < dayResetHour) {
        commitDate.setUTCDate(commitDate.getUTCDate() - 1);
    }

    return commitDate.toISOString().split("T")[0];
};

export const getCommitDay = Effect.fn("getCommitDay")(function* (
    timestamp: Date,
    timezone: string,
    dayResetHour: number,
) {
    const startMs = Date.now();

    const result = getCommitDayFromTimestamp(timestamp, timezone, dayResetHour);

    const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hour: "numeric",
        hour12: false,
    });
    const parts = formatter.formatToParts(timestamp);
    const hour = Number.parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);

    const durationMs = Date.now() - startMs;

    yield* Effect.logDebug("calculated commit day from timestamp", {
        operation: "get_commit_day",
        input_timestamp: timestamp.toISOString(),
        timezone,
        day_reset_hour: dayResetHour,
        local_hour: hour,
        adjusted_for_reset: hour < dayResetHour,
        commit_day: result,
        duration_ms: durationMs,
    });

    return result;
});

export const generateEventSlug = Effect.fn("generateEventSlug")(function* (date: Date) {
    const startMs = Date.now();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const result = `hack-night-${year}-${month}-${day}`;
    const durationMs = Date.now() - startMs;

    yield* Effect.logInfo("generated event slug from date", {
        operation: "generate_event_slug",
        input_date: date.toISOString(),
        year,
        month,
        day,
        output_slug: result,
        duration_ms: durationMs,
    });

    return result;
});

export const parseInterval = Effect.fn("parseInterval")(function* (interval: string) {
    const startMs = Date.now();

    const result = yield* Effect.tryPromise({
        try: async () => {
            const human = await import("human-interval");
            return human.default(interval);
        },
        catch: (cause) => new IntervalParseError({ interval, cause }),
    });

    const durationMs = Date.now() - startMs;

    yield* Effect.logInfo("parsed human interval to milliseconds", {
        operation: "parse_interval",
        input_interval: interval,
        output_ms: result ?? null,
        parsed_successfully: result !== undefined,
        duration_ms: durationMs,
    });

    return result;
});

export const isHackNightTime = Effect.fn("isHackNightTime")(function* (timezone: string) {
    const startMs = Date.now();
    const now = new Date();
    const options: Intl.DateTimeFormatOptions = {
        timeZone: timezone,
        weekday: "long",
        hour: "numeric",
        hour12: false,
    };

    const formatter = new Intl.DateTimeFormat("en-US", options);
    const parts = formatter.formatToParts(now);

    const weekday = parts.find((p) => p.type === "weekday")?.value;
    const hour = Number.parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);

    let result = false;
    if (weekday === "Friday" && hour >= 18) {
        result = true;
    } else if (weekday === "Saturday" && hour < 6) {
        result = true;
    }

    const durationMs = Date.now() - startMs;

    yield* Effect.logInfo("checked if current time is hack night", {
        operation: "is_hack_night_time",
        timezone,
        current_time: now.toISOString(),
        weekday: weekday ?? "unknown",
        hour,
        is_hack_night: result,
        check_friday_evening: weekday === "Friday" && hour >= 18,
        check_saturday_morning: weekday === "Saturday" && hour < 6,
        duration_ms: durationMs,
    });

    return result;
});
