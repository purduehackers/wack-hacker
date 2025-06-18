import { env } from "../env";

const ENDPOINT = "wss://api.purduehackers.com/discord/bot";

export async function connectToApi(timeout = 3000) {
  return new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(ENDPOINT);

    const fail = (reason: string) => {
      cleanup();
      if (ws.readyState === WebSocket.OPEN) ws.close();
      reject(new Error(reason));
    };

    const cleanup = () => {
      clearTimeout(killTimer);
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
    };

    const killTimer = setTimeout(
      () => fail("Auth timeout – no reply from server"),
      timeout,
    );

    ws.onerror = () => fail("WebSocket error during handshake");
    ws.onclose = () => fail("Socket closed before auth completed");

    ws.onopen = () => {
      ws.send(JSON.stringify({ token: env.PHACK_API_TOKEN }));
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string);
          if (msg?.auth === "complete") {
            cleanup();
            resolve(ws);
          } else if (msg?.auth === "rejected") {
            fail("Auth rejected by server");
          }
        } catch {
          /* ignore non-JSON frames until auth finishes */
        }
      };
    };
  });
}

export interface DiscordMessage {
  image: string | null;
  timestamp: string;
  username: string;
  content: string;
  attachments?: string[];
}

export async function sendDashboardMessage(
  client: WebSocket,
  message: DiscordMessage,
) {
  if (client.readyState !== WebSocket.OPEN) {
    throw new Error("WebSocket is not open");
  }

  client.send(JSON.stringify(message));
}
