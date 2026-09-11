import { notFound, redirect } from "next/navigation";
import { getProductionLog } from "~/actions/production";
import { ProductionRoom } from "~/components/dashboard/production-room";
import { auth } from "~/server/auth";

export const metadata = {
  title: "Production Room — ClipCast",
  description: "How the AI production crew decided this job.",
};

export default async function ProductionRoomPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { id } = await params;
  const log = await getProductionLog(id);
  if (!log) notFound();

  return <ProductionRoom title={log.title} entries={log.entries} />;
}
