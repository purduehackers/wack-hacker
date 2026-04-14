import { verifyKey } from "discord-interactions";

export async function verifyInteraction(
  request: Request,
  publicKey: string,
): Promise<{ valid: true; body: unknown } | { valid: false }> {
  const signature = request.headers.get("X-Signature-Ed25519");
  const timestamp = request.headers.get("X-Signature-Timestamp");
  const rawBody = await request.text();

  if (!signature || !timestamp) return { valid: false };

  const isValid = await verifyKey(rawBody, signature, timestamp, publicKey);
  if (!isValid) return { valid: false };

  return { valid: true, body: JSON.parse(rawBody) };
}
