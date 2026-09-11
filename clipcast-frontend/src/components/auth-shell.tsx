import Link from "next/link";
import type { ReactNode } from "react";
import { LogoMark, Wordmark } from "~/components/brand";

/**
 * Split-panel layout shared by the login and signup pages: a marketing/brand
 * panel on the left (hidden on small screens) and the auth form (children) on
 * the right. Server component — no interactivity of its own.
 *
 * The left panel is a hand-coded, on-brand hero visual (pure inline SVG, no
 * raster image, no client JS): soft brand blobs, a flowing soundwave mesh, an
 * equalizer, and floating 9:16 clip frames with burned-in captions. It stays
 * behind subtle background-tinted overlays so the logo and blockquote stay
 * fully legible on top.
 */

/** Small glassy feature pill used in the hero. Server-safe, no interactivity. */
function FeatureChip({ label }: { label: string }) {
  return (
    <span className="border-border/60 bg-background/60 text-muted-foreground inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium backdrop-blur">
      <span className="bg-brand size-1.5 rounded-full" />
      {label}
    </span>
  );
}

/** Decorative, purely-visual hero art for the left auth panel. */
function AuthHeroArt() {
  return (
    <svg
      className="h-full w-full"
      viewBox="0 0 480 900"
      preserveAspectRatio="xMidYMid slice"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        {/* Soft brand blob (reused at several sizes for depth). */}
        <radialGradient id="ac-blob" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.42" />
          <stop offset="55%" stopColor="currentColor" stopOpacity="0.12" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </radialGradient>

        {/* Horizontal flow gradient for the soundwave mesh. */}
        <linearGradient
          id="ac-wave"
          gradientUnits="userSpaceOnUse"
          x1="0"
          y1="0"
          x2="480"
          y2="0"
        >
          <stop offset="0%" stopColor="currentColor" stopOpacity="0" />
          <stop offset="22%" stopColor="currentColor" stopOpacity="0.9" />
          <stop offset="60%" stopColor="currentColor" stopOpacity="0.55" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.05" />
        </linearGradient>

        {/* Glassy fill for the floating clip frames. */}
        <linearGradient id="ac-card" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.17" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.03" />
        </linearGradient>

        {/* Vertical fill for the equalizer bars. */}
        <linearGradient id="ac-eq" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.85" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.3" />
        </linearGradient>

        {/* Fine dot texture. */}
        <pattern
          id="ac-dots"
          width="26"
          height="26"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="1.5" cy="1.5" r="1.5" fill="currentColor" fillOpacity="0.07" />
        </pattern>

        {/* Soft drop shadow for the clip frames. */}
        <filter
          id="ac-shadow"
          x="-40%"
          y="-40%"
          width="180%"
          height="180%"
        >
          <feDropShadow
            dx="0"
            dy="18"
            stdDeviation="22"
            floodColor="#1e1b4b"
            floodOpacity="0.22"
          />
        </filter>

        {/* A single flowing contour reused to build the soundwave field. */}
        <path
          id="ac-flow"
          d="M-40 300 C 70 236 150 364 250 300 S 430 236 520 300"
          fill="none"
        />
      </defs>

      {/* Dot texture across the whole panel. */}
      <rect width="480" height="900" fill="url(#ac-dots)" />

      {/* Soft depth blobs in the brand hue. */}
      <g>
        <circle cx="86" cy="150" r="250" fill="url(#ac-blob)" opacity="0.9" />
        <circle cx="440" cy="760" r="270" fill="url(#ac-blob)" opacity="0.8" />
        <circle cx="420" cy="150" r="160" fill="url(#ac-blob)" opacity="0.7" />
      </g>

      {/* Flowing soundwave mesh — one contour reused, faded top/bottom. */}
      <g
        fill="none"
        stroke="url(#ac-wave)"
        strokeWidth="2"
        strokeLinecap="round"
      >
        {Array.from({ length: 16 }).map((_, i) => {
          const y = i * 30 - 200;
          const opacity = (0.5 - Math.abs(i - 7.5) * 0.05).toFixed(2);
          return (
            <use
              key={i}
              href="#ac-flow"
              transform={`translate(0 ${y})`}
              strokeOpacity={opacity}
            />
          );
        })}
      </g>

      {/* Equalizer cluster (Audio Studio). */}
      <g>
        {[46, 84, 132, 96, 168, 72, 120, 190, 104, 64].map((h, i) => (
          <rect
            key={i}
            x={56 + i * 18}
            y={430 - h}
            width="9"
            height={h}
            rx="4.5"
            fill="url(#ac-eq)"
          />
        ))}
      </g>

      {/* Floating 9:16 clip frames with burned-in captions. */}
      <g transform="rotate(8 295 400)" filter="url(#ac-shadow)">
        <rect
          x="236"
          y="298"
          width="118"
          height="210"
          rx="16"
          fill="url(#ac-card)"
          stroke="currentColor"
          strokeOpacity="0.22"
        />
      </g>
      <g transform="rotate(-7 320 380)" filter="url(#ac-shadow)">
        <rect
          x="300"
          y="250"
          width="146"
          height="260"
          rx="18"
          fill="url(#ac-card)"
          stroke="currentColor"
          strokeOpacity="0.38"
        />
        {/* Play affordance. */}
        <circle
          cx="373"
          cy="380"
          r="26"
          fill="currentColor"
          fillOpacity="0.16"
          stroke="currentColor"
          strokeOpacity="0.4"
        />
        <path
          d="M367 367 L391 380 L367 393 Z"
          fill="currentColor"
          fillOpacity="0.9"
        />
        {/* Caption bars. */}
        <rect
          x="316"
          y="466"
          width="114"
          height="9"
          rx="4.5"
          fill="currentColor"
          fillOpacity="0.85"
        />
        <rect
          x="316"
          y="482"
          width="74"
          height="9"
          rx="4.5"
          fill="currentColor"
          fillOpacity="0.4"
        />
      </g>

      {/* A few sparkle accents for polish. */}
      <g fill="currentColor">
        <circle cx="196" cy="128" r="3" fillOpacity="0.55" />
        <circle cx="250" cy="196" r="2" fillOpacity="0.4" />
        <circle cx="118" cy="470" r="2.5" fillOpacity="0.4" />
        <path
          d="M430 470 h12 M436 464 v12"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeOpacity="0.35"
        />
      </g>
    </svg>
  );
}

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="bg-background text-foreground min-h-screen">
      <div className="grid min-h-screen grid-cols-1 lg:grid-cols-2">
        {/* Left brand panel */}
        <div className="from-brand/10 via-background to-background relative hidden overflow-hidden bg-gradient-to-br lg:block">
          {/* Coded hero art (background layer). */}
          <div
            aria-hidden="true"
            className="text-brand pointer-events-none absolute inset-0"
          >
            <AuthHeroArt />
          </div>
          {/* Legibility overlays — theme-aware, so text stays readable in any mode. */}
          <div
            aria-hidden="true"
            className="from-background pointer-events-none absolute inset-x-0 top-0 h-36 bg-gradient-to-b to-transparent"
          />
          <div
            aria-hidden="true"
            className="from-background via-background/70 pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t to-transparent"
          />

          {/* Foreground content */}
          <div className="relative z-10 flex h-full flex-col justify-between p-10">
            <Link href="/" className="flex items-center gap-2.5">
              <LogoMark />
              <Wordmark className="text-base" />
            </Link>
            <div>
              <div className="mb-6 flex flex-wrap gap-2">
                <FeatureChip label="9:16 clips" />
                <FeatureChip label="Auto-captions" />
                <FeatureChip label="Audio Studio" />
              </div>
              <blockquote className="max-w-md text-2xl leading-snug font-medium tracking-tight">
                &ldquo;Turn every episode into a week of shareable clips —
                automatically.&rdquo;
              </blockquote>
              <div className="text-muted-foreground mt-4 text-sm">
                Trusted by creators, podcasters and studios.
              </div>
            </div>
          </div>
        </div>

        {/* Right form panel */}
        <div className="flex items-center justify-center px-6 py-12 sm:px-10">
          <div className="w-full max-w-md">
            <Link
              href="/"
              className="mb-8 inline-flex items-center gap-2 lg:hidden"
            >
              <LogoMark className="size-8" />
              <span className="text-sm font-semibold">ClipCast</span>
            </Link>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
