import { redirect } from "next/navigation";
import { QueueTable } from "~/components/dashboard/queue-table";
import { auth } from "~/server/auth";

export const metadata = {
  title: "Queue — ClipCast",
  description:
    "Track processing jobs, retries, and generated clips across your workspace.",
};

// Queue data comes from the dashboard-wide usage store, seeded once in
// dashboard/layout.tsx — fetching it again here would duplicate the same
// DB query on every navigation.
export default async function QueuePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  // The shell top bar already renders the "Queue" title + description, so hide
  // the table's own heading here to avoid showing it twice.
  return <QueueTable hideHeading />;
}
