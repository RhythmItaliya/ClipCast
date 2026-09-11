// Brand primitives: logo, wordmark, and the OAuth/YouTube brand icons reused
// across auth pages, headers and buttons. Kept in one place so the visual
// identity stays consistent. Server-safe (no client hooks).
import { cn } from "~/lib/utils"; // Tailwind class merge helper

/**
 * ClipCast logo mark — a self-contained, icon-only SVG. A brand-indigo gradient
 * rounded square holds a crisp white glyph that fuses a broadcast/play signal
 * with rising audio-waveform bars (the "clip → cast" idea). No wordmark; reads
 * cleanly down to favicon scale and sits well on light or dark surfaces.
 * Default size stays ~size-9 and remains overridable via `className` (twMerge).
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="ClipCast"
      focusable="false"
      className={cn("size-9", className)}
    >
      <defs>
        <linearGradient
          id="clipcast-logo-gradient"
          gradientUnits="userSpaceOnUse"
          x1="6"
          y1="3"
          x2="34"
          y2="38"
        >
          <stop offset="0" stopColor="oklch(0.64 0.18 262)" />
          <stop offset="0.55" stopColor="oklch(0.55 0.19 260)" />
          <stop offset="1" stopColor="oklch(0.46 0.2 266)" />
        </linearGradient>
      </defs>

      {/* Brand gradient badge + a crisp inset edge-light for depth */}
      <rect width="40" height="40" rx="13" fill="url(#clipcast-logo-gradient)" />
      <rect
        x="1"
        y="1"
        width="38"
        height="38"
        rx="12"
        fill="none"
        stroke="#ffffff"
        strokeOpacity="0.16"
      />

      {/* Play / broadcast signal */}
      <path
        d="M12 13.5 12 26.5 20.5 20 Z"
        fill="#ffffff"
        stroke="#ffffff"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* Rising audio-waveform bars — sound being "cast" outward */}
      <g fill="#ffffff" fillOpacity="0.92">
        <rect x="21.6" y="16.5" width="1.9" height="7" rx="0.95" />
        <rect x="25" y="14.5" width="1.9" height="11" rx="0.95" />
        <rect x="28.4" y="12.5" width="1.9" height="15" rx="0.95" />
      </g>
    </svg>
  );
}

/** ClipCast wordmark with "Podcast Clipper" tag. */
export function Wordmark({
  className,
  withTag = true,
}: {
  className?: string;
  withTag?: boolean;
}) {
  return (
    <span className={cn("min-w-0", className)}>
      <span className="block font-semibold tracking-tight">ClipCast</span>
      {withTag && (
        <span className="text-muted-foreground block text-[10px] tracking-widest uppercase">
          Podcast Clipper
        </span>
      )}
    </span>
  );
}

/** YouTube outline icon (lucide dropped brand icons). */
export function YoutubeIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("h-4 w-4", className)}
    >
      <path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17" />
      <path d="m10 15 5-3-5-3z" />
    </svg>
  );
}

/** Google "G" mark (inline multi-colour SVG) for the Google OAuth button. */
export function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("h-4 w-4", className)}>
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47a5.57 5.57 0 0 1-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A11.99 11.99 0 0 0 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29A7.13 7.13 0 0 1 4.9 12c0-.8.14-1.57.37-2.29V6.62H1.29a11.99 11.99 0 0 0 0 10.76l3.98-3.09z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.69 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z"
      />
    </svg>
  );
}

/** Discord mark (inline SVG) for the Discord OAuth button. */
export function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 127.14 96.36"
      fill="#5865F2"
      className={cn("h-4 w-4", className)}
    >
      <path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.31,60,73.31,53s5-12.74,11.43-12.74S96.3,46,96.19,53,91.08,65.69,84.69,65.69Z" />
    </svg>
  );
}
