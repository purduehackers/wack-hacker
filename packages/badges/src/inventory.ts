import { createHash } from "node:crypto";

import { badgeStock, badgeStockChanges } from "@repo/shared/db";
import type { Db } from "@repo/shared/db";
import { DISCORD_GUILD_ID, roleAtLeast, roleFromMemberRoles, UserRole } from "@repo/shared/discord";
import { and, asc, count, desc, eq, gt } from "drizzle-orm";

import { stockChangeSchema, stockItemSchema, stockLabel } from "./inventory-contracts.ts";
import type {
  InventoryRequest,
  InventoryResponse,
  StockItem,
  StockSpec,
} from "./inventory-contracts.ts";

const PAGE_SIZE = 10;
type Mutation = Extract<InventoryRequest["action"], { kind: "add" | "use" | "set" }>;

export class InventoryError extends Error {}

function canonicalSpec(spec: StockSpec): StockSpec {
  return {
    materialId: spec.materialId,
    widthIn: Math.min(spec.widthIn, spec.heightIn),
    heightIn: Math.max(spec.widthIn, spec.heightIn),
    thicknessMm: spec.thicknessMm,
  };
}

function itemId(spec: StockSpec): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalSpec(spec)))
    .digest("hex")
    .slice(0, 24);
}

class BadgeInventory {
  private readonly db: Db;
  constructor(db: Db) {
    this.db = db;
  }

  async available(): Promise<StockItem[]> {
    const records = await this.db
      .select()
      .from(badgeStock)
      .where(gt(badgeStock.quantity, 0))
      .orderBy(asc(badgeStock.materialId), asc(badgeStock.widthIn), asc(badgeStock.heightIn));
    return records.map((entry) => stockItemSchema.parse(entry));
  }

  async execute(request: InventoryRequest): Promise<InventoryResponse> {
    if (request.guildId !== DISCORD_GUILD_ID)
      throw new InventoryError("Use this command in the Purdue Hackers server.");
    const { action } = request;
    if (action.kind === "list") return this.list(action.page);
    if (action.kind === "suggest") {
      const records = await this.db.select().from(badgeStock).orderBy(asc(badgeStock.materialId));
      return {
        items: records
          .map((entry) => stockItemSchema.parse(entry))
          .filter((item) => stockLabel(item).toLowerCase().includes(action.query.toLowerCase()))
          .slice(0, 25),
      };
    }
    if (action.kind === "history") {
      const records = await this.db
        .select()
        .from(badgeStock)
        .where(eq(badgeStock.id, action.itemId));
      const changes = await this.db
        .select()
        .from(badgeStockChanges)
        .where(eq(badgeStockChanges.itemId, action.itemId))
        .orderBy(desc(badgeStockChanges.createdAt), desc(badgeStockChanges.id))
        .limit(10);
      return {
        items: records.map((entry) => stockItemSchema.parse(entry)),
        changes: changes.map((row) => stockChangeSchema.parse(row)),
      };
    }
    if (!roleAtLeast(roleFromMemberRoles(request.memberRoles), UserRole.Organizer))
      throw new InventoryError("Ask an organizer to update the material count.");
    return this.change(request, action);
  }

  private async list(requestedPage: number): Promise<InventoryResponse> {
    const [total] = await this.db.select({ value: count() }).from(badgeStock);
    const pageCount = Math.max(1, Math.ceil((total?.value ?? 0) / PAGE_SIZE));
    const currentPage = Math.min(requestedPage, pageCount);
    const records = await this.db
      .select()
      .from(badgeStock)
      .orderBy(
        asc(badgeStock.materialId),
        asc(badgeStock.widthIn),
        asc(badgeStock.heightIn),
        asc(badgeStock.id),
      )
      .limit(PAGE_SIZE)
      .offset((currentPage - 1) * PAGE_SIZE);
    return {
      items: records.map((entry) => stockItemSchema.parse(entry)),
      page: currentPage,
      pages: pageCount,
    };
  }

  private async change(request: InventoryRequest, action: Mutation): Promise<InventoryResponse> {
    return this.db.transaction(async (tx) => {
      const [receipt] = await tx
        .select()
        .from(badgeStockChanges)
        .where(eq(badgeStockChanges.id, request.interactionId))
        .limit(1);
      if (receipt) {
        const [item] = await tx.select().from(badgeStock).where(eq(badgeStock.id, receipt.itemId));
        if (!item)
          throw new InventoryError(
            "This material is unavailable. Run the inventory command again.",
          );
        return {
          items: [stockItemSchema.parse({ ...item, quantity: receipt.after })],
          changes: [stockChangeSchema.parse(receipt)],
        };
      }
      const id = action.kind === "add" ? itemId(action) : action.itemId;
      const now = Date.now();
      if (action.kind === "add")
        await tx
          .insert(badgeStock)
          .values({ id, ...canonicalSpec(action), quantity: 0, updatedAt: now })
          .onConflictDoNothing();
      const [item] = await tx.select().from(badgeStock).where(eq(badgeStock.id, id));
      if (!item) throw new InventoryError("Choose a material from the inventory suggestions.");
      const after =
        action.kind === "set"
          ? action.quantity
          : item.quantity + (action.kind === "use" ? -action.quantity : action.quantity);
      if (after < 0)
        throw new InventoryError(
          `You have ${item.quantity} sheets of this material. Check the count before recording more use.`,
        );
      if (after > 10_000)
        throw new InventoryError("The count cannot exceed 10,000 sheets. Check the quantity.");
      const [changed] = await tx
        .update(badgeStock)
        .set({ quantity: after, updatedAt: now })
        .where(and(eq(badgeStock.id, id), eq(badgeStock.quantity, item.quantity)))
        .returning();
      if (!changed)
        throw new InventoryError("Someone changed this count. Check inventory and try again.");
      const change = {
        id: request.interactionId,
        itemId: id,
        operation: action.kind,
        before: item.quantity,
        after,
        actorId: request.actor.id,
        username: request.actor.username,
        note: action.note,
        createdAt: now,
      };
      await tx.insert(badgeStockChanges).values(change);
      return {
        items: [stockItemSchema.parse(changed)],
        changes: [stockChangeSchema.parse(change)],
      };
    });
  }
}

export function createBadgeInventory(db: Db) {
  return new BadgeInventory(db);
}
