import { generateKeyPairSync, sign } from "node:crypto";

const testKeyPair = generateKeyPairSync("ed25519");
const publicKeyDer = testKeyPair.publicKey.export({ type: "spki", format: "der" });
export const TEST_PUBLIC_KEY = (publicKeyDer as Buffer).subarray(12).toString("hex");

export function signedRequest(body: string, path = "/interactions"): Request {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const sig = sign(null, Buffer.from(timestamp + body), testKeyPair.privateKey).toString("hex");
  return new Request(`http://localhost${path}`, {
    method: "POST",
    body,
    headers: {
      "X-Signature-Ed25519": sig,
      "X-Signature-Timestamp": timestamp,
      "Content-Type": "application/json",
    },
  });
}
