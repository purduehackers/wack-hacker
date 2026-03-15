/** @jsxImportSource chat */
import { Card, CardText, Button, Actions, Fields, Field } from "chat";
import { createHook } from "workflow";

/**
 * Request approval via a Chat SDK Card + workflow hook.
 *
 * Posts a card with Approve/Deny buttons, then suspends the workflow
 * until resumed by the `bot.onAction` handler in handlers.ts.
 * Must be called from workflow context (not a step) for `createHook`.
 */
export async function requestApproval(opts: {
  thread: { post: (msg: any) => Promise<any> };
  description: string;
  reason: string;
  token: string;
}) {
  const hook = createHook<{ approved: boolean; userId?: string }>({
    token: `approval:${opts.token}`,
  });

  await postApprovalCard(opts.thread, opts.description, opts.reason, opts.token);

  // Workflow suspends here until the onAction handler resumes the hook
  return hook;
}

// Separate step because createHook (above) must run at workflow level,
// while thread.post requires a step for I/O.
async function postApprovalCard(
  thread: { post: (msg: any) => Promise<any> },
  description: string,
  reason: string,
  token: string,
) {
  "use step";
  const { bot } = await import("../../lib/bot");
  await bot.initialize();

  await thread.post(
    <Card title="Approval Required">
      <CardText>{description}</CardText>
      <Fields>
        <Field label="Reason" value={reason} />
      </Fields>
      <Actions>
        <Button id={`approval:approve:${token}`} style="primary">
          Approve
        </Button>
        <Button id={`approval:deny:${token}`} style="danger">
          Deny
        </Button>
      </Actions>
    </Card>,
  );
}

/**
 * Wrap an AI SDK tool so it requires button approval before executing.
 *
 * Adds a `reason` field the model must fill in, shows an approval card,
 * and suspends until a user clicks Approve or Deny.
 * Must be called from workflow context (not a step) since it uses hooks.
 */
export function withApproval<T extends { execute: (...args: any[]) => any }>(
  baseTool: T,
  opts: {
    thread: { post: (msg: any) => Promise<any> };
    formatCommand: (input: Record<string, unknown>) => string;
    token: string;
  },
): T {
  return {
    ...baseTool,
    execute: async (
      args: {
        reason?: string;
        [key: string]: unknown;
      },
      execCtx: unknown,
    ) => {
      const { reason, ...originalArgs } = args;
      const command = opts.formatCommand(originalArgs);

      const result = await requestApproval({
        thread: opts.thread,
        description: command,
        reason: reason ?? "No reason provided",
        token: opts.token,
      });

      if (!result.approved) {
        return JSON.stringify({
          denied: true,
          reason: result.userId ? "Denied by user" : "Timed out",
        });
      }

      return (baseTool.execute as Function)(originalArgs, execCtx);
    },
  };
}
