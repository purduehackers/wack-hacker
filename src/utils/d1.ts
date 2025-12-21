import { env } from "../env";

const D1_API_BASE = `https://api.cloudflare.com/client/v4/accounts/${env.D1_ACCOUNT_ID}/d1/database/${env.D1_DATABASE_ID}`;

interface D1QueryResult<T> {
	results: T[];
	success: boolean;
	meta: {
		duration: number;
		changes: number;
		last_row_id: number;
		rows_read: number;
		rows_written: number;
	};
}

interface D1ApiResponse<T> {
	result: D1QueryResult<T>[];
	success: boolean;
	errors: { code: number; message: string }[];
	messages: string[];
}

async function executeQuery<T>(
	sql: string,
	params?: (string | number | null)[],
): Promise<D1QueryResult<T>> {
	const response = await fetch(`${D1_API_BASE}/query`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${env.D1_API_TOKEN}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ sql, params }),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`D1 API error: ${response.status} ${text}`);
	}

	const data = (await response.json()) as D1ApiResponse<T>;

	if (!data.success) {
		throw new Error(`D1 query error: ${data.errors.map((e) => e.message).join(", ")}`);
	}

	return data.result[0];
}

export async function query<T>(
	sql: string,
	params?: (string | number | null)[],
): Promise<T[]> {
	const result = await executeQuery<T>(sql, params);
	return result.results;
}

export async function execute(
	sql: string,
	params?: (string | number | null)[],
): Promise<{ changes: number; lastRowId: number }> {
	const result = await executeQuery<unknown>(sql, params);
	return {
		changes: result.meta.changes,
		lastRowId: result.meta.last_row_id,
	};
}

export interface DbUser {
	id: string;
	discord_username: string;
	thread_id: string | null;
	created_at: string;
	updated_at: string;
}

export async function getUser(userId: string): Promise<DbUser | null> {
	const users = await query<DbUser>("SELECT * FROM users WHERE id = ?", [userId]);
	return users[0] ?? null;
}

export async function createUser(
	userId: string,
	discordUsername: string,
	threadId: string,
): Promise<void> {
	await execute(
		"INSERT INTO users (id, discord_username, thread_id) VALUES (?, ?, ?)",
		[userId, discordUsername, threadId],
	);
}

export async function updateUserThread(
	userId: string,
	threadId: string,
): Promise<void> {
	await execute(
		"UPDATE users SET thread_id = ?, updated_at = datetime('now') WHERE id = ?",
		[threadId, userId],
	);
}

export async function deleteUser(userId: string): Promise<void> {
	await execute("DELETE FROM users WHERE id = ?", [userId]);
}

export type CommitType = "github_url" | "image" | "progress_text";

export interface DbCommit {
	id: number;
	user_id: string;
	message_id: string;
	commit_type: CommitType;
	commit_day: string;
	approved_at: string | null;
	approved_by: string | null;
	created_at: string;
}

export async function getCommit(messageId: string): Promise<DbCommit | null> {
	const commits = await query<DbCommit>(
		"SELECT * FROM commits WHERE message_id = ?",
		[messageId],
	);
	return commits[0] ?? null;
}

export async function createCommit(
	userId: string,
	messageId: string,
	commitType: CommitType,
	commitDay: string,
	approvedBy: string,
): Promise<void> {
	await execute(
		`INSERT INTO commits (user_id, message_id, commit_type, commit_day, approved_at, approved_by)
		 VALUES (?, ?, ?, ?, datetime('now'), ?)`,
		[userId, messageId, commitType, commitDay, approvedBy],
	);
}

export async function getUserCommits(userId: string): Promise<DbCommit[]> {
	return query<DbCommit>(
		"SELECT * FROM commits WHERE user_id = ? AND approved_at IS NOT NULL ORDER BY commit_day DESC",
		[userId],
	);
}

export async function deleteUserCommits(userId: string): Promise<void> {
	await execute("DELETE FROM commits WHERE user_id = ?", [userId]);
}

export async function getApprovedCommitCount(userId: string): Promise<number> {
	const result = await query<{ count: number }>(
		"SELECT COUNT(*) as count FROM commits WHERE user_id = ? AND approved_at IS NOT NULL",
		[userId],
	);
	return result[0]?.count ?? 0;
}

export async function getDistinctCommitDays(userId: string): Promise<string[]> {
	const result = await query<{ commit_day: string }>(
		"SELECT DISTINCT commit_day FROM commits WHERE user_id = ? AND approved_at IS NOT NULL ORDER BY commit_day DESC",
		[userId],
	);
	return result.map((r) => r.commit_day);
}

export function calculateStreaks(commitDays: string[]): {
	currentStreak: number;
	longestStreak: number;
} {
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
}
