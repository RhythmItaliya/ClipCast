/**
 * The app's single NextAuth (Auth.js v5) entry point. Instantiates the config
 * from ./config once and re-exports the pieces the rest of the app uses:
 * `auth()` (read the session), `handlers` (the route handler), and
 * `signIn`/`signOut`.
 */
import NextAuth from "next-auth";
import { cache } from "react";

import { authConfig } from "./config";

const { auth: uncachedAuth, handlers, signIn, signOut } = NextAuth(authConfig);

// React's cache() dedupes auth() within a single server request, so the many
// server actions/components that each call auth() share one session lookup
// (and its DB hit) instead of repeating it per call.
const auth = cache(uncachedAuth);

export { auth, handlers, signIn, signOut };
