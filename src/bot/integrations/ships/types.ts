export interface ShipAttachment {
  key: string;
  type: string;
  filename: string;
  width?: number;
  height?: number;
}

export interface ShipRecord {
  userId: string;
  username: string;
  avatarUrl: string;
  messageId: string;
  title: string | null;
  content: string;
  attachments: ShipAttachment[];
}
