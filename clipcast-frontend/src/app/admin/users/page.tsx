import { Users } from "lucide-react";
import { getAdminUsers } from "~/actions/admin";
import { UsersTable } from "~/components/admin/users-table";

/**
 * Admin users — paginated table of every account, with credit, role, and
 * ban management handled inside UsersTable.
 */
export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);

  const { users, total, pageSize } = await getAdminUsers(page);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Users</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Manage every ClipCast account — credits, roles, and bans.
          </p>
        </div>
        <div className="bg-brand-soft text-brand flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold">
          <Users className="size-4" />
          {total.toLocaleString()} total
        </div>
      </div>

      {/* Table */}
      <UsersTable
        users={users.map((u) => ({ ...u, createdAt: u.createdAt }))}
        total={total}
        page={page}
        pageSize={pageSize}
      />
    </div>
  );
}
