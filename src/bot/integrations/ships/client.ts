import { createClient } from "@libsql/client";

import type { ShipRecord } from "./types";

export class ShipDatabase {
  private db;

  constructor(url: string, authToken: string) {
    this.db = createClient({ url, authToken });
  }

  async insertShip(ship: ShipRecord): Promise<string> {
    const result = await this.db.execute({
      sql: `INSERT INTO ship (user_id, username, avatar_url, message_id, title, content, attachments, shipped_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      args: [
        ship.userId,
        ship.username,
        ship.avatarUrl,
        ship.messageId,
        ship.title,
        ship.content,
        JSON.stringify(ship.attachments),
      ],
    });
    return String(result.lastInsertRowid);
  }

  async deleteByMessageId(messageId: string): Promise<void> {
    await this.db.execute({
      sql: "DELETE FROM ship WHERE message_id = ?",
      args: [messageId],
    });
  }
}
