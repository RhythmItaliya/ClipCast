/** Where a signed-in user should land: admins go to the admin panel, everyone
 * else to their dashboard. Used by `/` (the OAuth landing target) and the
 * `resolveHomePath` action (the credentials/OTP forms) so both agree. */
export function homePathForRole(role: "USER" | "ADMIN"): string {
  return role === "ADMIN" ? "/admin" : "/dashboard";
}
