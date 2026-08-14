import { hsalsa, secretbox } from "@noble/ciphers/salsa.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { blake2b } from "@noble/hashes/blake2.js";
import { u32, u8 } from "@noble/hashes/utils.js";

/**
 * NaCl sealed-box encryption for the GitHub Actions secrets API.
 *
 * GitHub will not accept a secret in the clear. The value must arrive sealed
 * to the repository's or organization's public key — `crypto_box_seal` from
 * libsodium. Nothing in the runtime ships libsodium, so this module assembles
 * the three primitives behind `crypto_box_seal` — X25519, HSalsa20,
 * XSalsa20-Poly1305 — from `@noble`. This is the only place plaintext secret
 * material exists.
 */

// NaCl "expand 32-byte k" sigma constant
const SIGMA = new Uint32Array([1_634_760_805, 857_760_878, 2_036_477_234, 1_797_285_236]);
const ZEROS = new Uint32Array(4);

/**
 * NaCl crypto_box_beforenm: derive a shared key from X25519 shared secret
 * by running it through HSalsa20.
 */
function boxBeforenm(sharedSecret: Uint8Array) {
  const output = new Uint32Array(8);
  hsalsa(SIGMA, u32(sharedSecret), ZEROS, output);
  return u8(output);
}

/**
 * NaCl crypto_box_seal: sealed box encryption for the GitHub secrets API.
 * Ephemeral X25519 keypair → HSalsa20 key derivation → XSalsa20-Poly1305.
 */
export function encryptSecret(value: string, publicKeyBase64: string) {
  const recipientPub = Uint8Array.from(atob(publicKeyBase64), (c) => c.charCodeAt(0));
  const ephemeralPriv = x25519.utils.randomSecretKey();
  const ephemeralPub = x25519.getPublicKey(ephemeralPriv);

  // Derive encryption key: X25519 DH → HSalsa20
  const sharedSecret = x25519.getSharedSecret(ephemeralPriv, recipientPub);
  const key = boxBeforenm(sharedSecret);

  // Nonce = blake2b(ephemeralPub || recipientPub, 24 bytes)
  const nonceInput = new Uint8Array(64);
  nonceInput.set(ephemeralPub, 0);
  nonceInput.set(recipientPub, 32);
  const nonce = blake2b(nonceInput, { dkLen: 24 });

  // Encrypt with XSalsa20-Poly1305 using the derived key
  const plaintext = new TextEncoder().encode(value);
  const ciphertext = secretbox(key, nonce).seal(plaintext);

  // Sealed box = ephemeralPub (32) || ciphertext
  const sealed = new Uint8Array(32 + ciphertext.length);
  sealed.set(ephemeralPub, 0);
  sealed.set(ciphertext, 32);

  return btoa(String.fromCharCode(...sealed));
}
