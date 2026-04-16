import { createClient } from "@libsql/client";

import type { ShipRecord } from "./types";

export class ShipDatabase {
  private db;

  constructor(url: string, authToken: string) {
    this.db = createClient({ url, authToken });
  }

  async insertShip(ship: ShipRecord): Promise<string> {
    const id = crypto.randomUUID();
    await this.db.execute({
      sql: `INSERT INTO ship (id, user_id, username, avatar_url, message_id, title, content, attachments, shipped_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      args: [
        id,
        ship.userId,
        ship.username,
        ship.avatarUrl,
        ship.messageId,
        ship.title,
        ship.content,
        JSON.stringify(ship.attachments),
      ],
    });
    return id;
  }

  async deleteByMessageId(messageId: string): Promise<string | null> {
    const result = await this.db.execute({
      sql: "DELETE FROM ship WHERE message_id = ? RETURNING id",
      args: [messageId],
    });
    const row = result.rows[0];
    return row ? (row.id as string) : null;
  }
}
