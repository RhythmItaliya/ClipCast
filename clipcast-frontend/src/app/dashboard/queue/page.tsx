import { redirect } from "next/navigation";
import { QueueTable } from "~/components/dashboard/queue-table";
import { auth } from "~/server/auth";
import { getQueueFiles } from "~/server/queue";

export const metadata = {
  title: "Queue — ClipCast",
  description:
    "Track processing jobs, retries, and generated clips across your workspace.",
};

export default async function QueuePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const queueFiles = await getQueueFiles(session.user.id);

  return <QueueTable initialFiles={queueFiles} />;
}
