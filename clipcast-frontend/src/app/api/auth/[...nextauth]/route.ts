/**
 * NextAuth (Auth.js v5) catch-all route: /api/auth/*.
 *
 * `handlers` is the App Router adapter Auth.js builds from our config in
 * ~/server/auth — it implements every auth endpoint (sign-in/out, OAuth
 * callbacks, session, CSRF) under this one dynamic segment. We just re-export
 * its GET/POST so Next.js serves them.
 */
import { handlers } from "~/server/auth";

export const { GET, POST } = handlers;
