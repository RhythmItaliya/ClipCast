"use client";

import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react"; // offline glyph for the sticky banner
import { toast } from "sonner"; // app-wide toast host lives in the root layout

/**
 * Global connectivity watcher. Shows a sticky banner while offline and a
 * short toast when the connection comes back.
 */
export function NetworkStatus() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    setOffline(!navigator.onLine);

    // Both toasts share one id ("network-status") so the "back online" toast
    // replaces the persistent offline one instead of stacking a second toast.
    const handleOffline = () => {
      setOffline(true);
      toast.error("You're offline", {
        description: "Uploads and processing are paused until you reconnect.",
        id: "network-status",
        duration: Infinity, // stays until reconnect (handleOnline replaces it)
      });
    };
    const handleOnline = () => {
      setOffline(false);
      toast.success("Back online", {
        description: "Your connection was restored.",
        id: "network-status",
        duration: 3000,
      });
    };

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  if (!offline) return null;

  return (
    <div className="bg-destructive text-destructive-foreground sticky top-0 z-50 flex items-center justify-center gap-2 px-4 py-1.5 text-sm font-medium">
      <WifiOff className="h-4 w-4" />
      No internet connection — some actions are disabled
    </div>
  );
}
