/**
 * Load the repo-root single `.env` into process.env for standalone tsx scripts
 * (seed, probes). The app itself uses @next/env at runtime; these CLI scripts
 * run outside Next, so we parse the root .env directly. Existing process.env
 * values win (so `TEST_USER_EMAIL=... npx tsx ...` overrides still work).
 */
import fs from "node:fs";
import path from "node:path";

export function loadRootEnv(): string {
  // clipcast-frontend/prisma -> repo root is two levels up from prisma, i.e.
  // one level up from the frontend cwd. Try a couple of candidates.
  const candidates = [
    path.resolve(process.cwd(), "..", ".env"),
    path.resolve(process.cwd(), ".env"),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      // strip matching surrounding quotes
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
    return file;
  }
  throw new Error("Could not find repo-root .env (looked in ../ and ./)");
}
