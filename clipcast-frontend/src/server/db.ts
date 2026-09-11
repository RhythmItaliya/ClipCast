/**
 * The shared Prisma client — the single DB handle every server module imports
 * as `db`. Prisma is the typed query builder / ORM over the Supabase Postgres.
 *
 * It's cached on `globalThis` so Next.js dev hot-reloads reuse one client
 * instead of spawning a new one per reload, which would quickly exhaust the
 * database connection pool. In production a fresh module instance is fine, so
 * the global is only set outside production.
 */
import { PrismaClient } from "@prisma/client";

import { env } from "~/env";

// Verbose query logging in dev only; production logs errors alone.
const createPrismaClient = () =>
  new PrismaClient({
    log:
      env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createPrismaClient> | undefined;
};

export const db = globalForPrisma.prisma ?? createPrismaClient();

if (env.NODE_ENV !== "production") globalForPrisma.prisma = db;
