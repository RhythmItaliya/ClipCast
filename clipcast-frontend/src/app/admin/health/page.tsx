import { getServiceStatuses } from "~/actions/health";
import { ServiceHealthPanel } from "~/components/admin/service-health-panel";

export default async function AdminHealthPage() {
  const statuses = await getServiceStatuses();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Services</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Every external service ClipCast depends on, its configuration status,
          and an on-demand connection test.
        </p>
      </div>
      <ServiceHealthPanel statuses={statuses} />
    </div>
  );
}
