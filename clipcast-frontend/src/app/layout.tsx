import "~/styles/globals.css";

import { type Metadata } from "next";
import { DM_Sans, Space_Grotesk } from "next/font/google";
import { NetworkStatus } from "~/components/network-status";
import { ToasterProvider } from "~/components/toaster-provider";

export const metadata: Metadata = {
  title: "ClipCast — AI Podcast Clipper",
  description:
    "Turn long podcasts into viral short-form clips with AI. Upload a video or paste a YouTube link.",
  icons: [{ rel: "icon", url: "/favicon.ico" }],
};

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
        <NetworkStatus />
        {children}
        <ToasterProvider />
      </body>
    </html>
  );
}
