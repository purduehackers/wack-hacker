"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import type {
  SimChatRequest,
  VirtualChannel,
  VirtualGuildSnapshot,
  VirtualMember,
} from "@/lib/simulator/types";

import { UserRole } from "@/lib/ai/constants";
import {
  SIM_BOT_ID,
  SIM_DEFAULT_CHANNEL,
  SIM_REVIEWER_ID,
  SIM_USER_ID,
} from "@/lib/simulator/constants";

import type { MentionResolver, SimConfig } from "./types.ts";

import { ChatColumn } from "./components/ChatColumn.tsx";
import { InspectorPanel } from "./components/InspectorPanel.tsx";
import { messagesForChannel } from "./message-store.ts";
import styles from "./simulator.module.css";
import { useSimulatorStream } from "./use-simulator-stream.ts";

const PENDING_CHANNEL = "__pending__";

// Built from the fallback-aware member/channel lists (not just `state.guild`)
// so @/# autocomplete works even before the first turn populates the guild.
function buildResolver(
  members: VirtualMember[],
  channels: VirtualChannel[],
  guild: VirtualGuildSnapshot | undefined,
): MentionResolver {
  const resolver: MentionResolver = { members: {}, channels: {}, roles: {}, emojis: {} };
  for (const member of members) resolver.members[member.id] = member;
  for (const channel of channels) resolver.channels[channel.id] = channel;
  for (const role of guild?.roles ?? []) resolver.roles[role.id] = role;
  for (const emoji of guild?.emojis ?? []) resolver.emojis[emoji.id] = emoji;
  return resolver;
}

function initialConfig(): SimConfig {
  return {
    role: UserRole.Organizer,
    username: "ray",
    nickname: "Ray",
    channelName: SIM_DEFAULT_CHANNEL,
    openThread: true,
    approveAsSecond: false,
  };
}

export default function SimulatorPage() {
  const sessionRef = useRef<string>(crypto.randomUUID());
  const sessionId = sessionRef.current;
  const [config, setConfig] = useState<SimConfig>(initialConfig);
  const { state, status, startTurn, decideApproval, selectChannel } = useSimulatorStream(sessionId);

  // The chat shows whichever channel/thread is active; before the first turn we
  // synthesize a single placeholder channel so the composer has somewhere to post.
  const channels: VirtualChannel[] = useMemo(() => {
    if (state.channelOrder.length > 0) return state.channelOrder.map((id) => state.channels[id]);
    return [
      { id: PENDING_CHANNEL, name: config.channelName || SIM_DEFAULT_CHANNEL, kind: "channel" },
    ];
  }, [state.channelOrder, state.channels, config.channelName]);

  const activeChannelId = state.activeChannelId ?? channels[0].id;
  const activeChannel =
    state.channels[activeChannelId] ??
    channels.find((c) => c.id === activeChannelId) ??
    channels[0];
  const isThread = activeChannel.kind === "thread";
  const parentName =
    isThread && activeChannel.parentId ? state.channels[activeChannel.parentId]?.name : undefined;

  const messages = useMemo(
    () => messagesForChannel(state, activeChannelId),
    [state, activeChannelId],
  );

  const members: VirtualMember[] = useMemo(() => {
    if (state.guild && state.guild.members.length > 0) return state.guild.members;
    return [
      { id: SIM_BOT_ID, username: "wack-hacker", displayName: "Wack Hacker", bot: true, roles: [] },
      {
        id: SIM_USER_ID,
        username: config.username || "ray",
        displayName: config.nickname || config.username || "Ray",
        roles: [],
      },
    ];
  }, [state.guild, config.username, config.nickname]);

  const resolver = useMemo(
    () => buildResolver(members, channels, state.guild),
    [members, channels, state.guild],
  );

  const patchConfig = useCallback((patch: Partial<SimConfig>) => {
    setConfig((prev) => ({ ...prev, ...patch }));
  }, []);

  const handleSend = useCallback(
    (content: string) => {
      const inThreadView = activeChannel.kind === "thread";
      const req: SimChatRequest = {
        sessionId,
        content,
        role: config.role,
        username: config.username || undefined,
        nickname: config.nickname || undefined,
        channelName: config.channelName || undefined,
        // In a thread → keep replying there; in a channel → open a thread per config.
        ...(inThreadView ? { threadId: activeChannel.id } : { openThread: config.openThread }),
      };
      void startTurn(req);
    },
    [config, sessionId, startTurn, activeChannel],
  );

  const handleDecide = useCallback(
    (decision: "approve" | "deny", approvalId: string) => {
      const opts = config.approveAsSecond ? { asUserId: SIM_REVIEWER_ID } : undefined;
      void decideApproval(approvalId, decision, opts);
    },
    [config.approveAsSecond, decideApproval],
  );

  return (
    <div className={styles.app}>
      <ChatColumn
        channelName={activeChannel.name}
        isThread={isThread}
        parentName={parentName}
        parentId={activeChannel.parentId}
        messages={messages}
        resolver={resolver}
        busy={status === "streaming"}
        onSend={handleSend}
        onDecide={handleDecide}
        onSelectChannel={selectChannel}
      />
      <InspectorPanel
        config={config}
        status={status}
        onChange={patchConfig}
        snapshot={state.contextSnapshot}
        trace={state.trace}
      />
    </div>
  );
}
