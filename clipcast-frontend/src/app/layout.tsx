/**
 * Root layout — wraps every route. Loads global styles and the two Google
 * fonts (exposed as CSS variables on <html> for Tailwind), and mounts app-wide
 * chrome: the route-change progress bar, offline banner, confirm-dialog
 * context, and the toast portal.
 */
import "~/styles/globals.css";

import { type Metadata } from "next";
import { DM_Sans, Space_Grotesk } from "next/font/google";
import { NetworkStatus } from "~/components/network-status";
import { ToasterProvider } from "~/components/toaster-provider";
import { TopLoader } from "~/components/top-loader";
import { ConfirmDialogProvider } from "~/components/ui/confirm-dialog";

export const metadata: Metadata = {
  title: "ClipCast — AI Podcast Clipper",
  description:
    "Turn long podcasts into viral short-form clips with AI. Upload a video or paste a YouTube link.",
  icons: [{ rel: "icon", url: "/favicon.ico" }],
};

// next/font/google self-hosts these at build time (no runtime request to
// Google) and exposes each as a CSS variable that Tailwind's font config reads.
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
});

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${dmSans.variable}`}>
      <body>
        {/* App-wide chrome, mounted once for every route */}
        <TopLoader />
        <NetworkStatus />
        <ConfirmDialogProvider>{children}</ConfirmDialogProvider>
        <ToasterProvider />
      </body>
    </html>
  );
}
