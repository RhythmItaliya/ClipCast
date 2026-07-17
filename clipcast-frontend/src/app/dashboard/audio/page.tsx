import { redirect } from "next/navigation";
import { AudioStudioClient } from "~/components/dashboard/audio-studio-client";
import { auth } from "~/server/auth";

export default async function AudioStudioPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  // The dashboard shell already renders the page title + description in the top
  // bar (see the nav table in shell.tsx), same as Clips/Queue — so this page
  // renders only its content, with no second heading of its own.
  return <AudioStudioClient />;
}
