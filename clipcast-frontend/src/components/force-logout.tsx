"use client";

import { signOut } from "next-auth/react";
import { useEffect } from "react";

export function ForceLogout() {
  useEffect(() => {
    signOut({ callbackUrl: "/login" });
  }, []);

  return null;
}