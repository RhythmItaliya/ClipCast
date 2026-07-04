/** Where a signed-in user should land: admins go to the admin panel, everyone
 * else to their dashboard. Shared by `/` and `/post-login` so both routes
 * agree on the same answer. */
export function homePathForRole(role: "USER" | "ADMIN"): string {
  return role === "ADMIN" ? "/admin" : "/dashboard";
}
