import crypto from "node:crypto";
import { env } from "~/env";

/**
 * Symmetric encryption for secrets managed from the admin UI (provider API
 * keys). AES-256-GCM with a random 96-bit IV per value; the auth tag is stored
 * alongside so tampering is detected on decrypt. The key comes from
 * SETTINGS_ENCRYPTION_KEY (32 bytes as 64 hex chars).
 */
const ALGO = "aes-256-gcm";

function getKey(): Buffer {
  const raw = env.SETTINGS_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "SETTINGS_ENCRYPTION_KEY is not set — cannot encrypt/decrypt provider secrets. " +
        "Add a 32-byte hex key (e.g. `openssl rand -hex 32`) to .env.",
    );
  }
  const key = Buffer.from(raw, "hex");
  if (key.length !== 32) {
    throw new Error(
      "SETTINGS_ENCRYPTION_KEY must be 32 bytes encoded as 64 hex chars.",
    );
  }
  return key;
}

export type EncryptedSecret = {
  ciphertext: string;
  iv: string;
  authTag: string;
};

export function encryptSecret(plaintext: string): EncryptedSecret {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptSecret(secret: EncryptedSecret): string {
  const decipher = crypto.createDecipheriv(
    ALGO,
    getKey(),
    Buffer.from(secret.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(secret.authTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
