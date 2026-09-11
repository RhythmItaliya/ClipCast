"use client";

// Client component: next-auth's signOut() is a browser-side call, so this must
// run on the client (hence "use client").
import { signOut } from "next-auth/react";
import { useEffect } from "react";

/**
 * Renders nothing; on mount it immediately signs the user out and redirects to
 * /login. Dropped into a page to force-clear a session (e.g. a banned or
 * deleted account whose stale JWT is still valid client-side).
 */
export function ForceLogout() {
  useEffect(() => {
    signOut({ callbackUrl: "/login" });
  }, []);

  return null;
}