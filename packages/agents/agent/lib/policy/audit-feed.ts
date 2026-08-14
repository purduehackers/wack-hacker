/**
 * Mirrors every audited action into Discord, one embed per decision.
 *
 * The audit table is the record. This is the feed. A row in Turso answers
 * "what happened" only if somebody thinks to look, and nobody looks until
 * something has already gone wrong. An embed in a channel reaches whoever is
 * around.
 *
 * Best-effort by construction. The caller writes the audit row first and runs
 * this after it, so a Discord outage costs the notification and never the
 * record. A failure here goes to the log rather than the caller. An action
 * that already happened must not surface as failed on account of its own
 * announcement.
 */

import { AuditDecision } from "@repo/shared/db/enums";
import { DISCORD_IDS } from "@repo/shared/discord";
import { serializeError } from "@repo/shared/errors";
import { sliceText } from "@repo/shared/text";

import { discordRest } from "../../subagents/discord/lib/client.ts";
import type { RiskLevel } from "./types.ts";

/** Read at a glance from the embed's left bar, before any of the text. */
const COLORS = {
  [AuditDecision.Requested]: 0x58_65_f2,
  [AuditDecision.Approved]: 0x58_65_f2,
  [AuditDecision.Executed]: 0x57_f2_87,
  [AuditDecision.Denied]: 0xed_42_45,
  [AuditDecision.Failed]: 0xfe_e7_5c,
  [AuditDecision.Timeout]: 0xfe_e7_5c,
  [AuditDecision.PromptFailed]: 0xfe_e7_5c,
} satisfies Record<AuditDecision, number>;

const TITLES = {
  [AuditDecision.Requested]: "Action requested",
  [AuditDecision.Approved]: "Action approved",
  [AuditDecision.Executed]: "Action executed",
  [AuditDecision.Denied]: "Action denied",
  [AuditDecision.Failed]: "Action failed",
  [AuditDecision.Timeout]: "Approval timed out",
  /** The prompt never reached anyone, so the agent attempted nothing. */
  [AuditDecision.PromptFailed]: "Approval undeliverable",
} satisfies Record<AuditDecision, string>;

export interface AuditFeedEntry {
  readonly tool: string;
  readonly risk: RiskLevel;
  readonly decision: AuditDecision;
  readonly actorId: string;
  readonly actorName: string;
  readonly role: string;
  /** Already redacted by the audit store's own rules before it reaches here. */
  readonly input: string | undefined;
}

/**
 * Discord rejects an embed over 6000 characters across all fields, and a tool
 * input is the only part with no natural bound. Cut well short of the limit:
 * the feed exists to say what happened, and the table holds the whole of it.
 */
const INPUT_CHARS = 1_000;

function describe(entry: AuditFeedEntry): string {
  const lines = [
    `**Tool:** \`${entry.tool}\``,
    `**Risk:** ${entry.risk}`,
    `**Actor:** <@${entry.actorId}> (\`${entry.actorName}\`, ${entry.role})`,
  ];
  if (entry.input !== undefined && entry.input !== "") {
    lines.push(`**Input:**\n\`\`\`json\n${sliceText(entry.input, INPUT_CHARS)}\n\`\`\``);
  }
  return lines.join("\n");
}

/**
 * Posts one decision embed to the audit channel. Failure never propagates.
 * The audit row already exists, so this logs the miss and returns, because
 * the announcement must not fail the action it announces.
 */
export async function publishAuditEntry(entry: AuditFeedEntry): Promise<void> {
  try {
    await discordRest().post(`/channels/${DISCORD_IDS.channels.AGENT_AUDIT}/messages`, {
      body: {
        embeds: [
          {
            title: TITLES[entry.decision],
            description: describe(entry),
            color: COLORS[entry.decision],
            timestamp: new Date().toISOString(),
          },
        ],
        // The embed names the actor so a reader can tell who acted, never to
        // ping them. An audit feed that notifies people is one they mute.
        allowed_mentions: { parse: [] },
      },
    });
  } catch (cause) {
    console.warn(
      JSON.stringify({
        event: "audit.feed_failed",
        tool: entry.tool,
        decision: entry.decision,
        ...serializeError(cause instanceof Error ? cause : new Error(String(cause))),
      }),
    );
  }
}
