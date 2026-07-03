/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import nextEnv from "@next/env";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
nextEnv.loadEnvConfig(
  path.resolve(__dirname, ".."),
  process.env.NODE_ENV !== "production",
);

await import("./src/env.js");

/** @type {import("next").NextConfig} */
const config = {
  experimental: {
    // Keep builds responsive on a development laptop instead of spawning one
    // worker per logical CPU (this machine previously spawned 15 workers).
    cpus: 4,
    staticGenerationMaxConcurrency: 4,
    // Reuse Turbopack artifacts across production-build verification runs.
    turbopackFileSystemCacheForBuild: true,
  },
};

export default config;
