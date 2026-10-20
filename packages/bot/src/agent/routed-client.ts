/** Every accepted conversation stays on its verified execution deployment. */
import {
  EXECUTION_PROBE_ROUTE,
  executionProbeSchema,
  type ConversationStore,
  type ExecutionBinding,
} from "@repo/shared/conversations";
import { messageOf, UpstreamError } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import type {
  DeliveryPayload,
  InteractionPayload,
  ResetRequestPayload,
  SteerRequestPayload,
} from "@repo/shared/wire";

import { createAgentClient, type AgentClient, type AgentError } from "./client.ts";
import {
  originHash,
  targetForBinding,
  type ExecutionTarget,
  type ExecutionTargets,
} from "./execution-targets.ts";

export interface ExecutionAddress {
  readonly continuationKey: string;
  readonly dispatchId?: string;
}

export type ConversationAgentClient = Pick<
  AgentClient,
  "sendMessage" | "sendInteraction" | "sendReset" | "sendSteer"
> & {
  prepareContinuation(address: ExecutionAddress): Promise<Result<void, AgentError>>;
  supportsCancel(address: ExecutionAddress): Promise<boolean>;
  streamAccess(address: ExecutionAddress): Promise<Result<AgentClient, AgentError>>;
};

type RoutingStore = Pick<ConversationStore, "executions" | "execution" | "deliveries">;

function unavailable(cause: unknown): AgentError {
  return new UpstreamError({ service: "agent routing", status: 503, detail: messageOf(cause) });
}

function createRouteResolver(deps: {
  readonly store: RoutingStore;
  readonly config: ExecutionTargets;
  readonly secret: string;
}) {
  const configured = (id: string): ExecutionTarget => {
    const target = deps.config.targets.find((item) => item.identity.id === id);
    if (!target?.enabled) throw new Error("execution target is unavailable");
    return target;
  };

  async function probe(target: ExecutionTarget, continuationKey: string) {
    const response = await fetch(new URL(EXECUTION_PROBE_ROUTE, target.origin), {
      method: "POST",
      headers: { Authorization: `Bearer ${deps.secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ continuationKey }),
      signal: AbortSignal.timeout(10_000),
      redirect: "manual",
    });
    if (!response.ok) throw new Error(`execution ownership lookup failed (${response.status})`);
    const parsed = executionProbeSchema.safeParse(await response.json());
    if (
      !parsed.success ||
      JSON.stringify(parsed.data.identity) !== JSON.stringify(target.identity)
    ) {
      throw new Error("execution deployment identity did not match the configured target");
    }
    return parsed.data;
  }

  async function bindingFor(
    address: ExecutionAddress,
    establish: boolean,
  ): Promise<ExecutionBinding> {
    const existing = await deps.store.executions.read(address.continuationKey);
    if (Result.isError(existing)) throw existing.error;
    if (existing.value !== undefined) return existing.value;
    if (!establish) throw new Error("task execution binding is missing");
    const legacy = configured(deps.config.legacy);
    // The retained bridge resolves ownership without starting/resuming any session.
    // A timeout, 404 or malformed body is never evidence that an address is new.
    const previous = await probe(legacy, address.continuationKey);
    const held = await deps.store.deliveries.readStrict(address.continuationKey);
    if (Result.isError(held)) throw held.error;
    const queued = await deps.store.deliveries.queueDepth(address.continuationKey);
    // Pending/claimed work predating this bot was accepted against the legacy
    // runtime even when it had not created an Eve session yet.
    const target =
      previous.sessionId === undefined && held.value === undefined && queued === 0
        ? configured(deps.config.current)
        : legacy;
    if (target !== legacy) {
      const current = await probe(target, address.continuationKey);
      if (current.sessionId !== undefined) {
        throw new Error("execution deployments disagree about continuation ownership");
      }
    }
    const candidate: ExecutionBinding = {
      version: 1,
      generation: crypto.randomUUID(),
      identity: target.identity,
      originHash: originHash(target.origin),
      ...(previous.sessionId === undefined ? {} : { sessionId: previous.sessionId }),
    };
    const bound = await deps.store.execution.bind(address.continuationKey, candidate);
    if (Result.isError(bound)) throw bound.error;
    if (bound.value === undefined) throw new Error("execution binding was not persisted");
    // A concurrent bot/configuration may have won. Its binding always wins.
    return bound.value;
  }

  async function route(address: ExecutionAddress, establish: boolean) {
    const binding = await bindingFor(address, establish);
    let pinned = binding;
    if (address.dispatchId !== undefined) {
      const result = establish
        ? await deps.store.execution.pinDispatch(address.continuationKey, address.dispatchId)
        : await deps.store.executions.dispatch(address.dispatchId);
      if (Result.isError(result)) throw result.error;
      if (result.value === undefined) throw new Error("dispatch execution binding is missing");
      pinned = result.value;
      if (pinned.generation !== binding.generation)
        throw new Error("task execution generation is stale");
    }
    const target = targetForBinding(deps.config, pinned);
    const client = createAgentClient({
      baseUrl: target.origin,
      secret: deps.secret,
      execution: { continuationKey: address.continuationKey, generation: pinned.generation },
    });
    return { client, binding: pinned, target };
  }

  return route;
}

export function createRoutedAgentClient(deps: {
  readonly store: RoutingStore;
  readonly config: ExecutionTargets;
  readonly secret: string;
}): ConversationAgentClient {
  const route = createRouteResolver(deps);
  const safely = <T>(operation: () => Promise<T>) =>
    Result.tryPromise({ try: operation, catch: unavailable });

  async function dispatch(
    payload: DeliveryPayload | InteractionPayload,
    deliver: (client: AgentClient) => ReturnType<AgentClient["sendMessage"]>,
  ) {
    const selected = await safely(() => route(payload, true));
    if (Result.isError(selected)) return selected;
    const { client, binding } = selected.value;
    const sent = await deliver(client);
    if (Result.isError(sent)) return sent;
    const confirmed = await safely(() =>
      deps.store.execution.confirmSession(
        payload.continuationKey,
        payload.dispatchId,
        binding.generation,
        sent.value.sessionId,
      ),
    );
    if (Result.isError(confirmed)) return confirmed;
    if (!confirmed.value)
      return Result.err(
        unavailable(new Error("execution session acknowledgement lost its binding")),
      );
    return sent;
  }

  return {
    prepareContinuation: async (address) => {
      const selected = await safely(() => route(address, true));
      return Result.isError(selected) ? selected : Result.ok(undefined);
    },
    sendMessage: (payload) => dispatch(payload, (client) => client.sendMessage(payload)),
    sendInteraction: (payload) => dispatch(payload, (client) => client.sendInteraction(payload)),
    sendSteer: async (payload: SteerRequestPayload) => {
      const selected = await safely(() => route(payload, true));
      return Result.isError(selected) ? selected : selected.value.client.sendSteer(payload);
    },
    sendReset: async (payload: ResetRequestPayload) => {
      const selected = await safely(() => route(payload, true));
      if (Result.isError(selected)) return selected;
      const reset = await selected.value.client.sendReset(payload);
      if (Result.isError(reset)) return reset;
      const retired = await safely(() =>
        deps.store.execution.retireSession(
          payload.continuationKey,
          payload.resetId,
          selected.value.binding.generation,
        ),
      );
      if (Result.isError(retired)) return retired;
      return retired.value
        ? reset
        : Result.err(unavailable(new Error("reset execution binding fence was lost")));
    },
    supportsCancel: async (address) => {
      const selected = await safely(() => route(address, false));
      return (
        Result.isOk(selected) && selected.value.target.capabilities.includes("exact-turn-cancel-v1")
      );
    },
    streamAccess: async (address) => {
      const selected = await safely(() => route(address, true));
      return Result.isError(selected) ? selected : Result.ok(selected.value.client);
    },
  };
}
