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
