import { COMMIT_OVERFLOW_DAY_RESET_HOUR } from "../../constants";

export interface StreakResult {
    currentStreak: number;
    longestStreak: number;
}

export const getCommitDayFromTimestamp = (
    timestamp: string,
    timezone: string,
    dayResetHour: number,
): string => {
    const date = new Date(timestamp);

    const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "numeric",
        hour12: false,
    });

    const parts = formatter.formatToParts(date);
    const year = parts.find((p) => p.type === "year")?.value ?? "1970";
    const month = parts.find((p) => p.type === "month")?.value ?? "01";
    const day = parts.find((p) => p.type === "day")?.value ?? "01";
    const hour = Number.parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);

    const commitDate = new Date(`${year}-${month}-${day}T00:00:00`);

    if (hour < dayResetHour) {
        commitDate.setDate(commitDate.getDate() - 1);
    }

    return commitDate.toISOString().split("T")[0];
};

export const calculateStreaks = (commitTimestamps: string[], timezone: string): StreakResult => {
    if (commitTimestamps.length === 0) {
        return { currentStreak: 0, longestStreak: 0 };
    }

    const dayResetHour = COMMIT_OVERFLOW_DAY_RESET_HOUR;

    const commitDaysSet = new Set<string>();
    for (const ts of commitTimestamps) {
        commitDaysSet.add(getCommitDayFromTimestamp(ts, timezone, dayResetHour));
    }

    const days = [...commitDaysSet].sort();

    if (days.length === 0) {
        return { currentStreak: 0, longestStreak: 0 };
    }

    let longestStreak = 1;
    let currentStreakLength = 1;

    for (let i = 1; i < days.length; i++) {
        const prevDate = new Date(days[i - 1]);
        const currDate = new Date(days[i]);

        const diffMs = currDate.getTime() - prevDate.getTime();
        const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

        if (diffDays === 1) {
            currentStreakLength++;
        } else {
            currentStreakLength = 1;
        }

        longestStreak = Math.max(longestStreak, currentStreakLength);
    }

    let streakEndingAtMostRecent = 1;
    for (let i = days.length - 1; i > 0; i--) {
        const currDate = new Date(days[i]);
        const prevDate = new Date(days[i - 1]);

        const diffMs = currDate.getTime() - prevDate.getTime();
        const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

        if (diffDays === 1) {
            streakEndingAtMostRecent++;
        } else {
            break;
        }
    }

    return {
        currentStreak: streakEndingAtMostRecent,
        longestStreak,
    };
};

export const getDistinctCommitDays = (commitTimestamps: string[], timezone: string): string[] => {
    const dayResetHour = COMMIT_OVERFLOW_DAY_RESET_HOUR;

    const commitDaysSet = new Set<string>();
    for (const ts of commitTimestamps) {
        commitDaysSet.add(getCommitDayFromTimestamp(ts, timezone, dayResetHour));
    }

    return [...commitDaysSet].sort();
};
