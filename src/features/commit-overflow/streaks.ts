import { Effect } from "effect";

export interface StreakResult {
    currentStreak: number;
    longestStreak: number;
}

export const calculateStreaks = (commitDays: string[]): StreakResult => {
    const totalDays = commitDays.length;
    
    if (commitDays.length === 0) {
        return { currentStreak: 0, longestStreak: 0 };
    }

    const days = [...commitDays].sort();

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
