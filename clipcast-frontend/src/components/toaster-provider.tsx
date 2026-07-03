"use client";

// Isolated client wrapper for Toaster.
// Prevents `useContext` errors during static prerender of /_global-error,
// which renders its own <html> root and cannot share React context.
import { Toaster } from "sonner";

export function ToasterProvider() {
  return <Toaster richColors position="top-right" />;
}
