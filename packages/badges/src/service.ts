import { randomUUID } from "node:crypto";

import { DISCORD_GUILD_ID, roleAtLeast, roleFromMemberRoles, UserRole } from "@repo/shared/discord";
import { Result } from "@repo/shared/result";
import { decodeMessagePayload } from "@repo/shared/wire";
import type { MessagePayload, Principal } from "@repo/shared/wire";

import {
  BADGES_CHANNEL_ID,
  contextHash,
  invalidate,
  MAX_SVG_BYTES,
  ready,
  remainingCriteria,
  reviewable,
  RUBRIC_VERSION,
} from "./contracts.ts";
import type { BadgeEvent, JobKind, Person, Review, StoredReview } from "./contracts.ts";
import { StaleReview } from "./store.ts";
import type { BadgeStore } from "./store.ts";
import { parseSvg } from "./svg.ts";

export type { Action } from "./wire.ts";
import type { Action } from "./wire.ts";

export interface Actor {
  person: Person;
  memberRoles: string[];
  threadId: string;
  guildId: string;
}
export interface Cms {
  events(): Promise<BadgeEvent[]>;
  event(id: string): Promise<BadgeEvent>;
}

export function assertScope(payload: MessagePayload): string {
  if (
    payload.channel.id !== BADGES_CHANNEL_ID ||
    payload.thread?.parentId !== BADGES_CHANNEL_ID ||
    payload.kind === "scheduled"
  )
    throw new Error("Badge reviews must run in a #p-badges thread.");
  return payload.thread.id;
}
export function personOf(principal: Principal): Person {
  return { id: principal.userId, username: principal.username };
}
export function organizer(actor: Actor): boolean {
  return roleAtLeast(roleFromMemberRoles(actor.memberRoles), UserRole.Organizer);
}

class BadgeService {
  private readonly repository: BadgeStore;
  private readonly cms: Cms;
  constructor(repository: BadgeStore, cms: Cms) {
    this.repository = repository;
    this.cms = cms;
  }
  async read(threadId: string): Promise<StoredReview> {
    const stored = await this.repository.forThread(threadId);
    if (!stored) throw new Error("No badge review exists in this thread yet.");
    return stored;
  }
  async submit(messageId: string, threadId: string) {
    const encoded = await this.repository.inbox(messageId, threadId);
    if (!encoded)
      throw new Error(
        "No bot-verified submission is attached to this message. Ping wack hacker with the SVG files.",
      );
    const decoded = decodeMessagePayload(JSON.parse(encoded));
    if (Result.isError(decoded)) throw new Error("Invalid submission record.");
    const payload = decoded.value;
    assertScope(payload);
    const previous = await this.repository.forThread(threadId);
    if (previous?.review.sourceMessageId === messageId) return previous;
    if (previous && previous.review.author.id !== payload.principal.userId)
      throw new Error("Only the original badge author can upload a revision in this thread.");
    if (previous?.review.approval || previous?.review.publication)
      throw new Error(
        "This review is being published or is already published. Start a new review thread for a revision.",
      );
    const attachments = payload.attachments ?? [];
    if (
      attachments.length < 1 ||
      attachments.length > 2 ||
      attachments.some((a) => a.size > MAX_SVG_BYTES)
    )
      throw new Error(
        "Attach one replacement SVG, or exactly two SVGs for badge and stamp (under 1 MB each).",
      );
    if (!previous && attachments.length !== 2)
      throw new Error("Attach both the badge and stamp SVG to start a review.");
    const uploads = [];
    for (const file of attachments) {
      const source = await downloadSvg(file.url);
      parseSvg(source);
      uploads.push({
        hash: await this.repository.putAsset(Buffer.from(source), "image/svg+xml"),
        name: file.filename,
      });
    }
    const review: Review = previous
      ? { ...invalidate(previous.review), uploads, sourceMessageId: messageId }
      : {
          id: randomUUID(),
          threadId,
          sourceMessageId: messageId,
          author: personOf(payload.principal),
          generation: 0,
          rubric: RUBRIC_VERSION,
          uploads,
          rolesConfirmed: false,
          checks: [],
          previews: [],
          layouts: [],
          decisions: [],
        };
    // New uploads remain unassigned until the author identifies them from previews.
    const { badge: _badge, stamp: _stamp, ...unassigned } = review;
    const next = previous && uploads.length === 1 ? review : unassigned;
    await this.repository.save({
      review: { ...next, rolesConfirmed: false },
      ...(previous ? { expected: previous.version } : {}),
      eventId: `submission:${messageId}`,
      actorId: payload.principal.userId,
      jobs: [],
    });
    return this.read(threadId);
  }
  async act(
    stored: StoredReview,
    actor: Actor,
    action: Action,
    eventId: string,
  ): Promise<StoredReview> {
    const { review, version } = stored;
    if (actor.guildId !== DISCORD_GUILD_ID || actor.threadId !== review.threadId)
      throw new Error("This control belongs to a different review thread.");
    const isReviewer = organizer(actor);
    if (actor.person.id !== review.author.id && !isReviewer)
      throw new Error("Only the author or an organizer can update this review.");
    if (action.kind === "retry") {
      if (review.publication?.shortlink) return stored;
      await this.repository.retry(review.id, review.generation);
      const { failure: _failure, ...clean } = review;
      await this.repository.save({
        review: clean,
        expected: version,
        actorId: actor.person.id,
        eventId,
        jobs: [],
      });
      return this.read(review.threadId);
    }
    if (review.approval || review.publication)
      throw new Error(
        "Publication is locked to the approved revision. Retry a failed job, or start a new review thread.",
      );
    let next = review;
    let jobs: JobKind[] = [];
    if (action.kind === "decision") {
      next = recordDecision(review, actor, action);
      jobs = remainingCriteria(next).length === 0 ? ["archive"] : [];
    } else if (action.kind === "publish") {
      next = await approvePublication(review, actor, this.cms);
      jobs = ["publish"];
    } else if (action.kind === "layout") {
      if (!review.layouts.some((layout) => layout.id === action.id && layout.audited))
        throw new Error("Select a current, audited layout.");
      const { pr: _pr, manufacturing: _manufacturing, ...withoutPr } = review;
      next = { ...withoutPr, selectedLayout: action.id, decisions: [] };
      jobs = ["prepare"];
    } else {
      next = await configure(review, action, this.cms);
      jobs = next.rolesConfirmed && next.badge && next.stamp ? ["inspect"] : [];
    }
    await this.repository.save({
      review: next,
      expected: version,
      eventId,
      actorId: actor.person.id,
      jobs,
    });
    return this.read(review.threadId);
  }
  async action(id: string, version: number, actor: Actor, action: Action, eventId: string) {
    const saved = await this.repository.get(id);
    if (!saved || saved.version !== version) throw new StaleReview();
    return this.act(saved, actor, action, eventId);
  }
}
export function createBadgeService(repository: BadgeStore, cms: Cms) {
  return new BadgeService(repository, cms);
}

async function configure(
  review: Review,
  action: Exclude<Action, { kind: "decision" | "layout" }>,
  cms: Cms,
): Promise<Review> {
  const next = invalidate(review);
  if (action.kind === "roles") {
    const badge = review.uploads[action.badge],
      stamp = review.uploads[1 - action.badge];
    if (!badge || !stamp) throw new Error("Select which of the two previews is the badge.");
    return { ...next, badge, stamp, rolesConfirmed: true };
  }
  if (action.kind === "replace") {
    const asset = review.uploads[0];
    if (review.uploads.length !== 1 || !asset)
      throw new Error("Upload one SVG to replace either the badge or stamp.");
    return { ...next, [action.role]: asset, rolesConfirmed: true };
  }
  if (action.kind === "event") return { ...next, event: await cms.event(action.id) };
  if (action.kind === "settings") return { ...next, settings: action.value };
  if (action.kind === "refresh" && review.event)
    return { ...next, event: await cms.event(review.event.id) };
  return next;
}

export class CmsEventChanged extends Error {
  constructor() {
    super("The CMS event changed. Refresh the event and review the new expected version/date.");
  }
}

export async function assertCurrentEvent(review: Review, cms: Cms): Promise<void> {
  if (
    !review.event ||
    JSON.stringify(await cms.event(review.event.id)) !== JSON.stringify(review.event)
  )
    throw new CmsEventChanged();
}

async function downloadSvg(value: string): Promise<string> {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !["cdn.discordapp.com", "media.discordapp.net"].includes(url.hostname) ||
    !url.pathname.startsWith("/attachments/") ||
    url.username ||
    url.password
  )
    throw new Error("Only bot-observed Discord attachment URLs are accepted.");
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!response.ok || !response.body)
    throw new Error("Attachment is unavailable. Reattach the SVG and ping wack hacker again.");
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_SVG_BYTES) throw new Error("SVG exceeds 1 MB.");
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks).toString("utf8");
}

function recordDecision(
  review: Review,
  actor: Actor,
  action: Extract<Action, { kind: "decision" }>,
): Review {
  const isReviewer = organizer(actor);
  if (!isReviewer || !reviewable(review))
    throw new Error(
      "An organizer can review criteria after static checks, event, settings, and layout selection are complete.",
    );
  if (action.verdict !== "approve" && !action.note)
    throw new Error("Explain what needs fixing or what is unclear.");
  const decisions = review.decisions.filter(
    (d) => !(d.criterion === action.criterion && d.context === contextHash(review)),
  );
  const next = {
    ...review,
    decisions: [
      ...decisions,
      {
        criterion: action.criterion,
        verdict: action.verdict,
        note: action.note,
        context: contextHash(review),
        reviewer: actor.person,
        at: new Date().toISOString(),
      },
    ],
  };
  // A fresh archive commit records the reviewer; final publication compares its exact head.
  const { pr: _pr, ...withoutPr } = next;
  return withoutPr;
}

async function approvePublication(review: Review, actor: Actor, cms: Cms): Promise<Review> {
  const isReviewer = organizer(actor);
  if (!isReviewer || !ready(review) || !review.pr)
    throw new Error("Complete every criterion and wait for the reviewed GitHub revision first.");
  const finalReviewer = review.decisions.at(-1)?.reviewer;
  if (finalReviewer?.id !== actor.person.id)
    throw new Error(
      "The organizer who completed the last criterion must approve publication, so repository metadata names the final reviewer.",
    );
  await assertCurrentEvent(review, cms);
  return {
    ...review,
    approval: { context: contextHash(review), head: review.pr.head, reviewer: actor.person },
  };
}
