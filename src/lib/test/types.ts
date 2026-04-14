export interface MockCall {
  method: string;
  args: unknown[];
}

export interface MockDiscord {
  channels: Record<string, (...args: any[]) => Promise<any>>;
  guilds: Record<string, (...args: any[]) => Promise<any>>;
  users: Record<string, (...args: any[]) => Promise<any>>;
  interactions: Record<string, (...args: any[]) => Promise<any>>;
  _calls: MockCall[];
  callsTo(method: string): unknown[][];
}
