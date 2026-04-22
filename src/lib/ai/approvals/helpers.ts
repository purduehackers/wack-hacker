import type {
  APIActionRowComponent,
  APIComponentInMessageActionRow,
  APIEmbed,
} from "discord-api-types/v10";

import { ButtonStyle, ComponentType } from "discord-api-types/v10";

import type { ApprovalState, BuildApprovalEmbedArgs } from "./types.ts";

const COLOR_AMBER = 0xffaa00;
const COLOR_GREEN = 0x34d399;
const COLOR_RED = 0xef4444;
const COLOR_GREY = 0x9ca3af;

const MAX_VALUE_LEN = 200;

type DecidedStatus = Exclude<ApprovalState["status"], "pending">;

const STATUS_STYLE: Record<DecidedStatus, { color: number; label: string; icon: string }> = {
  approved: { color: COLOR_GREEN, label: "Approved", icon: "✅" },
  denied: { color: COLOR_RED, label: "Denied", icon: "❌" },
  timeout: { color: COLOR_GREY, label: "Timed Out", icon: "⏱" },
};

function formatValue(v: unknown): string {
  if (v === undefined) return "undefined";
  let s: string;
  try {
    s = JSON.stringify(v);
  } catch {
    s = String(v);
  }
  if (s.length <= MAX_VALUE_LEN) return s;
  const wrapped = s.at(0) === '"';
  const body = wrapped ? s.slice(1, MAX_VALUE_LEN - 2) : s.slice(0, MAX_VALUE_LEN - 1);
  return wrapped ? `"${body}…"` : `${body}…`;
}

/**
 * Render a python-style dot-notation call for display in the approval prompt.
 * Strips the wrapper-injected `_reason` field so the agent's justification
 * doesn't clutter the visible parameters.
 *
 * - With `delegateName`: `delegate_<name>.<tool>(\n    k=v,\n)`.
 * - Without: `<tool>(\n    k=v,\n)`.
 * - Empty params: `<tool>()`.
 */
export function formatToolCall(
  delegateName: string | undefined,
  toolName: string,
  input: unknown,
): string {
  const obj =
    input && typeof input === "object" && !Array.isArray(input)
      ? { ...(input as Record<string, unknown>) }
      : {};
  delete obj._reason;

  const prefix = delegateName ? `delegate_${delegateName}.${toolName}` : toolName;
  const entries = Object.entries(obj);
  if (entries.length === 0) return `${prefix}()`;

  const lines = entries.map(([k, v]) => `    ${k}=${formatValue(v)},`).join("\n");
  return `${prefix}(\n${lines}\n)`;
}

export function buildApprovalEmbed(args: BuildApprovalEmbedArgs): APIEmbed {
  const callStr = formatToolCall(args.delegateName, args.toolName, args.input);
  const minutes = Math.max(1, Math.round(args.timeoutMs / 60_000));
  return {
    color: COLOR_AMBER,
    author: { name: "🛂 Wack Hack · Permission Requested" },
    description: `\`\`\`py\n${callStr}\n\`\`\``,
    fields: [{ name: "Reason", value: args.reason || "(not provided)" }],
    footer: { text: `Only the requester can approve · auto-denies in ${minutes}m` },
    timestamp: new Date().toISOString(),
  };
}

export function buildApprovalComponents(
  approvalId: string,
): APIActionRowComponent<APIComponentInMessageActionRow>[] {
  return [
    {
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.Button,
          style: ButtonStyle.Success,
          label: "Approve",
          emoji: { name: "✅" },
          custom_id: `tool-approval:approve:${approvalId}`,
        },
        {
          type: ComponentType.Button,
          style: ButtonStyle.Danger,
          label: "Deny",
          emoji: { name: "❌" },
          custom_id: `tool-approval:deny:${approvalId}`,
        },
      ],
    },
  ];
}

export function buildDecisionEmbed(
  state: ApprovalState,
  action: DecidedStatus,
  decidedByUserId: string | null,
): APIEmbed {
  const style = STATUS_STYLE[action];
  const callStr = formatToolCall(state.delegateName, state.toolName, state.input);

  const fields: APIEmbed["fields"] = [{ name: "Reason", value: state.reason || "(not provided)" }];
  if (action !== "timeout" && decidedByUserId) {
    fields.push({ name: "Decided by", value: `<@${decidedByUserId}>` });
  }

  const footerText =
    action === "timeout"
      ? `${style.icon} ${style.label} · auto-expired`
      : `${style.icon} ${style.label}`;

  return {
    color: style.color,
    author: { name: `Wack Hack · Permission ${style.label}` },
    description: `\`\`\`py\n${callStr}\n\`\`\``,
    fields,
    footer: { text: footerText },
    timestamp: state.decidedAt ?? new Date().toISOString(),
  };
}
