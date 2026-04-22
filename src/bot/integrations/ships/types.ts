export interface ShipAttachmentInput {
  sourceUrl: string;
  type: string;
  filename: string;
  width?: number;
  height?: number;
}

export interface ShipAttachment {
  url: string;
  type: string;
  filename: string;
  width?: number;
  height?: number;
}

export interface CreateShipInput {
  userId: string;
  username: string;
  avatarUrl: string;
  messageId: string;
  title: string | null;
  content: string;
  attachments: ShipAttachmentInput[];
}

export interface CreateShipResponse {
  ok: true;
  id: string;
  alreadyExists?: boolean;
  attachments?: ShipAttachment[];
}

export interface DeleteShipResponse {
  deleted: boolean;
  id?: string;
  attachmentsRemoved: number;
}
