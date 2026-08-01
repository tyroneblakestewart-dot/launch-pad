import { cookies } from "next/headers";
import { AdminDashboard } from "@/components/admin-dashboard";
import { AdminLoginScreen } from "@/components/admin-login-screen";
import { ADMIN_SESSION_COOKIE, hashAdminSessionToken } from "@/lib/server/admin-auth";
import { isAdminSessionValid } from "@/lib/server/admin-session-store";

export const dynamic = "force-dynamic";

/** Pure gate for which screen renders — extracted so it's testable without a live Next.js request scope. */
export function isAdminSessionTokenAuthenticated(token: string | undefined): boolean {
  return Boolean(token && isAdminSessionValid(hashAdminSessionToken(token)));
}

export default async function AdminPage() {
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;
  return isAdminSessionTokenAuthenticated(token) ? <AdminDashboard /> : <AdminLoginScreen />;
}
