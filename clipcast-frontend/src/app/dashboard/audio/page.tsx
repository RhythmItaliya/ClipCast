/**
 * Audio Studio page — auth-guards the route, then hands off to the client
 * component that drives music generation and mashups.
 */
import { redirect } from "next/navigation";
import { AudioStudioClient } from "~/components/dashboard/audio-studio-client";
import { auth } from "~/server/auth";

export default async function AudioStudioPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  // Audio Studio is the CREATE surface; generated mixes are viewed in the
  // Library (alongside clips, in their own table). The shell renders the title.
  return <AudioStudioClient />;
}
