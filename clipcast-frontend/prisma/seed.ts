/**
 * Full test seed — run after a from-scratch DB reset to stand up everything the
 * end-to-end test needs:
 *
 *   1. An ADMIN account (manage the panel, switch providers).
 *   2. A CLIENT (USER) account with credits (submit clip/audio jobs).
 *   3. The active LLM provider set to Claude (Anthropic), configured from the
 *      local `use-key.txt` gateway (endpoint + key), model claude-opus-4-8,
 *      effort "medium" — the same encrypted ProviderKey blob the admin panel
 *      writes (AES-256-GCM via SETTINGS_ENCRYPTION_KEY).
 *
 *   npx tsx prisma/seed.ts
 *
 * Overridable via env: ADMIN_EMAIL, ADMIN_PASSWORD, CLIENT_EMAIL,
 * CLIENT_PASSWORD, SEED_CREDITS, LLM_MODEL, LLM_EFFORT, USE_KEY_FILE.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { hash } from "bcryptjs";
import { loadRootEnv } from "./_load-env";

loadRootEnv();

const { PrismaClient } = await import("@prisma/client");
const db = new PrismaClient();

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@clipcast.local";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "Admin@1234";
const CLIENT_EMAIL = process.env.CLIENT_EMAIL ?? "client@clipcast.local";
const CLIENT_PASSWORD = process.env.CLIENT_PASSWORD ?? "Client@1234";
const CREDITS = Number(process.env.SEED_CREDITS ?? 1000);
const LLM_MODEL = process.env.LLM_MODEL ?? "claude-opus-4-8";
const LLM_EFFORT = process.env.LLM_EFFORT ?? "medium";

/** AES-256-GCM, identical shape to src/server/crypto.ts encryptSecret(). */
function encryptSecret(plaintext: string) {
  const raw = process.env.SETTINGS_ENCRYPTION_KEY;
  if (!raw) throw new Error("SETTINGS_ENCRYPTION_KEY is not set");
  const key = Buffer.from(raw, "hex");
  if (key.length !== 32)
    throw new Error("SETTINGS_ENCRYPTION_KEY must be 32 bytes (64 hex chars)");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
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

/** Parse use-key.txt: an sk_... key line + an https endpoint line (any order). */
function readGatewayKey(): { apiKey: string; baseUrl: string } {
  const file =
    process.env.USE_KEY_FILE ?? path.resolve(process.cwd(), "..", "use-key.txt");
  if (!fs.existsSync(file))
    throw new Error(`use-key.txt not found at ${file}`);
  const lines = fs
    .readFileSync(file, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const apiKey = lines.find((l) => /^sk[-_]/i.test(l));
  const baseUrl = lines.find((l) => /^https?:\/\//i.test(l));
  if (!apiKey) throw new Error("No API key (sk_...) line found in use-key.txt");
  if (!baseUrl) throw new Error("No endpoint (https://...) line found in use-key.txt");
  return { apiKey, baseUrl };
}

async function main() {
  // 1. Admin + client accounts (bcrypt 12 rounds, same as the signup flow).
  const [adminHash, clientHash] = await Promise.all([
    hash(ADMIN_PASSWORD, 12),
    hash(CLIENT_PASSWORD, 12),
  ]);

  const admin = await db.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: { role: "ADMIN", credits: CREDITS, banned: false, password: adminHash },
    create: {
      email: ADMIN_EMAIL,
      name: "ClipCast Admin",
      role: "ADMIN",
      credits: CREDITS,
      password: adminHash,
    },
    select: { id: true, email: true, role: true, credits: true },
  });

  const client = await db.user.upsert({
    where: { email: CLIENT_EMAIL },
    update: { role: "USER", credits: CREDITS, banned: false, password: clientHash },
    create: {
      email: CLIENT_EMAIL,
      name: "ClipCast Tester",
      role: "USER",
      credits: CREDITS,
      password: clientHash,
    },
    select: { id: true, email: true, role: true, credits: true },
  });

  // 2. Claude (Anthropic) provider config from the local gateway key.
  const { apiKey, baseUrl } = readGatewayKey();
  const blob = JSON.stringify({
    apiKey,
    model: LLM_MODEL,
    effort: LLM_EFFORT,
    baseUrl,
  });
  const enc = encryptSecret(blob);
  await db.providerKey.upsert({
    where: { provider: "claude" },
    update: { ...enc, last4: apiKey.slice(-4) },
    create: { provider: "claude", ...enc, last4: apiKey.slice(-4) },
  });

  // 3. Make Claude the active provider for the AI crew.
  await db.appSetting.upsert({
    where: { key: "llm_provider" },
    update: { value: "claude" },
    create: { key: "llm_provider", value: "claude" },
  });

  console.log("Seed complete:");
  console.log("  admin :", admin, `(password: ${ADMIN_PASSWORD})`);
  console.log("  client:", client, `(password: ${CLIENT_PASSWORD})`);
  console.log(
    `  provider: claude  model=${LLM_MODEL}  effort=${LLM_EFFORT}  endpoint=${baseUrl}  key=****${apiKey.slice(-4)}`,
  );
}

main()
  .catch((err) => {
    console.error("SEED FAILED:", err);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());
