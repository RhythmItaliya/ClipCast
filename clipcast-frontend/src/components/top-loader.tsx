"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * A slim brand-coloured progress bar pinned to the very top of the
 * viewport, shown while a route transition is in flight — from the moment
 * an internal link is clicked until the destination page (and its
 * loading.tsx skeleton) actually lands. The App Router doesn't expose a
 * route-change-start event, so navigation start is detected via a
 * document-level click listener on internal <a> tags, and "done" is
 * detected by the pathname changing.
 */
export function TopLoader() {
  const pathname = usePathname();
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  const stepTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (stepTimer.current) clearTimeout(stepTimer.current);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  // Pathname changed -> the new route has landed, finish and hide the bar.
  useEffect(() => {
    if (stepTimer.current) clearTimeout(stepTimer.current);
    setProgress(100);
    hideTimer.current = setTimeout(() => {
      setVisible(false);
      setProgress(0);
    }, 250);
  }, [pathname]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      // Note: don't bail on e.defaultPrevented here — next/link always
      // calls preventDefault() itself for the client-side transitions we
      // most want to show the bar for, so checking it would skip the
      // primary case entirely.
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
        return;

      const anchor = (e.target as HTMLElement)?.closest("a");
      if (!anchor) return;

      const href = anchor.getAttribute("href");
      if (
        !href ||
        anchor.target === "_blank" ||
        anchor.hasAttribute("download") ||
        href.startsWith("#") ||
        href.startsWith("mailto:") ||
        href.startsWith("tel:")
      )
        return;

      const url = new URL(href, window.location.href);
      if (
        url.origin !== window.location.origin ||
        (url.pathname === window.location.pathname &&
          url.search === window.location.search)
      )
        return;

      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (stepTimer.current) clearTimeout(stepTimer.current);
      setVisible(true);
      setProgress(15);

      const step = (p: number) => {
        const next = p + (90 - p) * 0.15;
        setProgress(next);
        stepTimer.current = setTimeout(() => step(next), 180);
      };
      stepTimer.current = setTimeout(() => step(15), 180);
    };

    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-1.5 overflow-hidden transition-opacity duration-300"
      style={{ opacity: visible ? 1 : 0 }}
    >
      <div
        className="glow-brand bg-brand h-full transition-[width] duration-200 ease-out"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}
